"use server";

import { revalidatePath } from "next/cache";
import { prisma, postJournal, JournalError } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

export type ManualJournalLineInput = {
  chartAccountId: string;
  debit: number;
  credit: number;
  memo?: string;
};

export type CreateManualJournalInput = {
  date: string;
  description: string;
  lines: ManualJournalLineInput[];
};

export type CreateManualJournalResult =
  | { ok: true; journalId: string }
  | { ok: false; code: string };

export async function createManualJournalAction(
  input: CreateManualJournalInput,
): Promise<CreateManualJournalResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  try {
    const { journalId } = await postJournal(prisma, {
      isManual: true,
      postedById: session.user.id,
      date: new Date(input.date),
      description: input.description,
      lines: input.lines.map((l) => ({
        chartAccountId: l.chartAccountId,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        memo: l.memo,
      })),
    });

    revalidatePath("/backoffice/finance/journals");
    return { ok: true, journalId };
  } catch (e) {
    if (e instanceof JournalError) return { ok: false, code: e.code };
    throw e;
  }
}
