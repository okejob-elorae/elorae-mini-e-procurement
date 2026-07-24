import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import type { PostingRole } from "@/lib/constants/journal-roles";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export type AutoJournalLine = { role: PostingRole; debit: number; credit: number };

export type GenerateAutoJournalResult =
  | { ok: true; journalId: string; created: boolean }
  | { ok: false; code: "UNMAPPED_ROLE" | "UNBALANCED" | "NOTHING_TO_POST"; role?: string };

export async function generateAutoJournal(
  client: AnyClient = prisma,
  sourceType: string,
  sourceId: string,
  lines: AutoJournalLine[],
  meta: { date: Date; description: string; postedById: string },
): Promise<GenerateAutoJournalResult> {
  if (lines.length === 0) return { ok: false, code: "NOTHING_TO_POST" };

  const roleToId = new Map<PostingRole, string>();
  try {
    for (const role of new Set(lines.map((l) => l.role))) roleToId.set(role, await resolveAccount(role, client));
  } catch (e) {
    if (e instanceof UnmappedRoleError) return { ok: false, code: "UNMAPPED_ROLE", role: e.role };
    throw e;
  }

  try {
    const res = await postJournal(client, {
      source: { type: sourceType, id: sourceId },
      date: meta.date,
      description: meta.description,
      postedById: meta.postedById,
      lines: lines.map((l) => ({ chartAccountId: roleToId.get(l.role)!, debit: l.debit, credit: l.credit })),
    });
    return { ok: true, journalId: res.journalId, created: res.created };
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    throw e;
  }
}
