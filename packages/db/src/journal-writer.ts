import type { Prisma, PrismaClient } from "../generated/prisma/client";

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

/**
 * True only for a P2002 on the journal's `(sourceType, sourceId)` unique. Detected by shape, never
 * `instanceof`: apps/web bundles the Prisma runtime into several server chunks, so an error thrown
 * by one copy fails `instanceof` against another's class. The MariaDB driver
 * adapter reports the index name (`Journal_sourceType_sourceId_key`) in
 * `meta.driverAdapterError.cause.constraint` rather than `meta.target`, so the whole error is
 * searched for both column names. A P2002 on any other index, or naming none, is not this one.
 */
function isSourceCollision(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown; meta?: unknown } | null;
  if (err?.code !== "P2002") return false;
  const text = `${String(err.message ?? "")} ${JSON.stringify(err.meta ?? {})}`;
  return text.includes("sourceType") && text.includes("sourceId");
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

  const cents = (n: number): number => Math.round((Number(n) || 0) * 100);
  let drCents = 0,
    crCents = 0;
  const rounded = lines.map((l) => {
    const dC = cents(l.debit),
      cC = cents(l.credit);
    if ((dC > 0) === (cC > 0)) throw new JournalError("BAD_LINE", "line must be exactly one of debit/credit");
    drCents += dC;
    crCents += cC;
    return { chartAccountId: l.chartAccountId, debit: dC / 100, credit: cC / 100, memo: l.memo ?? null };
  });
  if (drCents !== crCents) throw new JournalError("UNBALANCED", `dr=${drCents / 100} cr=${crCents / 100}`);

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
          create: rounded.map((l) => ({
            chartAccountId: l.chartAccountId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo,
          })),
        },
      },
      select: { id: true },
    });
    return { journalId: j.id, created: true };
  };

  /*
   * Two concurrent posts for one source both pass the existence read, and the loser's create dies
   * on the unique. That is an idempotent success, not a failure: re-read the winner's row and
   * return it. That success applies to the PrismaClient path: the loser's own transaction has
   * already rolled back, so the re-read runs on a clean client and sees the winner. Inside a
   * caller's transaction (REPEATABLE READ) the re-read on that same tx reads the earlier snapshot
   * and will not see the winner, so `existing` is null and the P2002 is rethrown.
   */
  try {
    return await (hasTx(client) ? client.$transaction(run) : run(client as Prisma.TransactionClient));
  } catch (e) {
    if (!input.source || !isSourceCollision(e)) throw e;
    const existing = await client.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: input.source.type, sourceId: input.source.id } },
      select: { id: true },
    });
    if (!existing) throw e;
    return { journalId: existing.id, created: false };
  }
}
