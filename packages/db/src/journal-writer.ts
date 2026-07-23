import { Prisma, type PrismaClient } from "../generated/prisma/client";

type AnyClient = PrismaClient | Prisma.TransactionClient;

function hasTx(client: AnyClient): client is PrismaClient {
  return typeof (client as PrismaClient).$transaction === "function";
}

export class JournalError extends Error {
  constructor(
    public code: "UNBALANCED" | "TOO_FEW_LINES" | "BAD_LINE" | "NON_POSTABLE_ACCOUNT",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "JournalError";
  }
}

export type JournalLineInput = { chartAccountId: string; debit: number; credit: number; memo?: string };

export type PostJournalInput = {
  date: Date;
  description: string;
  postedById: string;
  source?: { type: string; id: string };
  isManual?: boolean;
  lines: JournalLineInput[];
};

export async function postJournal(
  client: AnyClient,
  input: PostJournalInput,
): Promise<{ journalId: string; created: boolean }> {
  const { lines } = input;
  if (lines.length < 2) throw new JournalError("TOO_FEW_LINES");

  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    const d = Number(l.debit) || 0;
    const c = Number(l.credit) || 0;
    if ((d > 0) === (c > 0)) throw new JournalError("BAD_LINE", "line must be exactly one of debit/credit");
    dr += d;
    cr += c;
  }
  if (Math.abs(dr - cr) >= 0.01) throw new JournalError("UNBALANCED", `dr=${dr} cr=${cr}`);

  const run = async (tx: Prisma.TransactionClient) => {
    if (input.source) {
      const existing = await tx.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: input.source.type, sourceId: input.source.id } },
        select: { id: true },
      });
      if (existing) return { journalId: existing.id, created: false };
    }

    // Postable check: every line account must be an active leaf (isActive AND no children).
    const ids = Array.from(new Set(lines.map((l) => l.chartAccountId)));
    const accts = await tx.chartAccount.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } });
    if (accts.length !== ids.length || accts.some((a) => !a.isActive)) throw new JournalError("NON_POSTABLE_ACCOUNT");
    const parents = await tx.chartAccount.findMany({ where: { parentId: { in: ids } }, select: { parentId: true } });
    const parentSet = new Set(parents.map((p) => p.parentId));
    if (ids.some((id) => parentSet.has(id))) throw new JournalError("NON_POSTABLE_ACCOUNT");

    const j = await tx.journal.create({
      data: {
        date: input.date,
        description: input.description,
        postedById: input.postedById,
        sourceType: input.source?.type ?? null,
        sourceId: input.source?.id ?? null,
        isManual: input.isManual ?? false,
        lines: {
          create: lines.map((l) => ({
            chartAccountId: l.chartAccountId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            memo: l.memo ?? null,
          })),
        },
      },
      select: { id: true },
    });
    return { journalId: j.id, created: true };
  };

  return hasTx(client) ? client.$transaction(run) : run(client as Prisma.TransactionClient);
}
