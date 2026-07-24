import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";

type AnyClient = PrismaClient | Prisma.TransactionClient;

function hasTx(client: AnyClient): client is PrismaClient {
  return typeof (client as PrismaClient).$transaction === "function";
}

export type PostSettlementJournalResult =
  | { ok: true; journalId: string; created: boolean }
  | {
      ok: false;
      code: "CHECKSUM_BLOCKED" | "UNMAPPED_ROLE" | "UNBALANCED" | "ALREADY_RECONCILED_DIFF";
      role?: string;
    };

export async function postSettlementJournal(
  settlementId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<PostSettlementJournalResult> {
  const s = await client.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: {
      id: true,
      checksumOk: true,
      totalDilepas: true,
      totalPengeluaran: true,
      totalPendapatan: true,
      seller: true,
      periodTo: true,
    },
  });

  if (!s.checksumOk) return { ok: false, code: "CHECKSUM_BLOCKED" };

  let bank: string, fee: string, ar: string;
  try {
    bank = await resolveAccount("BANK", client);
    fee = await resolveAccount("MARKETPLACE_FEE", client);
    ar = await resolveAccount("AR", client);
  } catch (e) {
    if (e instanceof UnmappedRoleError) return { ok: false, code: "UNMAPPED_ROLE", role: e.role };
    throw e;
  }

  const lines = [
    { chartAccountId: bank, debit: Number(s.totalDilepas), credit: 0 },
    { chartAccountId: fee, debit: Number(s.totalPengeluaran), credit: 0 },
    { chartAccountId: ar, debit: 0, credit: Number(s.totalPendapatan) },
  ];

  const run = async (tx: Prisma.TransactionClient) => {
    const res = await postJournal(tx, {
      source: { type: "SETTLEMENT", id: s.id },
      date: s.periodTo,
      description: `Marketplace settlement — ${s.seller}`,
      postedById,
      lines,
    });
    await tx.settlement.update({ where: { id: s.id }, data: { status: "RECONCILED" } });
    return { ok: true as const, journalId: res.journalId, created: res.created };
  };

  try {
    return hasTx(client) ? await client.$transaction(run) : await run(client as Prisma.TransactionClient);
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    throw e;
  }
}
