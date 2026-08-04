import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { splitMarketplaceFees, type MarketplaceFeeRole } from "./fee-split";

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

/**
 * Falls back to the legacy lumped `MARKETPLACE_FEE` account when a per-category
 * role is not mapped yet, so settlements keep posting on an existing chart of
 * accounts instead of failing until an admin wires five new mappings.
 */
async function resolveFeeAccount(role: MarketplaceFeeRole, client: AnyClient): Promise<string> {
  try {
    return await resolveAccount(role, client);
  } catch (e) {
    if (e instanceof UnmappedRoleError) return await resolveAccount("MARKETPLACE_FEE", client);
    throw e;
  }
}

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

  const feeTotals = await client.settlementLine.aggregate({
    where: { settlementId: s.id },
    _sum: {
      biayaAdministrasi: true,
      biayaLayanan: true,
      biayaKomisiAms: true,
      biayaProsesPesanan: true,
    },
  });

  const feeSplit = splitMarketplaceFees(
    {
      admin: Number(feeTotals._sum.biayaAdministrasi ?? 0),
      service: Number(feeTotals._sum.biayaLayanan ?? 0),
      commission: Number(feeTotals._sum.biayaKomisiAms ?? 0),
      processing: Number(feeTotals._sum.biayaProsesPesanan ?? 0),
    },
    Number(s.totalPengeluaran),
  );

  let bank: string, ar: string;
  const feeAccounts = new Map<MarketplaceFeeRole, string>();
  try {
    bank = await resolveAccount("BANK", client);
    ar = await resolveAccount("AR", client);
    for (const split of feeSplit) {
      feeAccounts.set(split.role, await resolveFeeAccount(split.role, client));
    }
  } catch (e) {
    if (e instanceof UnmappedRoleError) return { ok: false, code: "UNMAPPED_ROLE", role: e.role };
    throw e;
  }

  const lines = [
    { chartAccountId: bank, debit: Number(s.totalDilepas), credit: 0 },
    ...feeSplit.map((split) => ({
      chartAccountId: feeAccounts.get(split.role)!,
      debit: split.debit,
      credit: split.credit,
    })),
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
