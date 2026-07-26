import { prisma, Prisma } from "@elorae/db";

const toNum = (v: Prisma.Decimal | number): number => Number(v);

export type SettlementListRow = {
  id: string;
  marketplace: string;
  seller: string;
  periodFromIso: string;
  periodToIso: string;
  status: string;
  checksumOk: boolean;
  checksumVariance: number;
  lineCount: number;
  matchedCount: number;
  createdAtIso: string;
};

export async function listSettlements(paging: {
  page: number;
  pageSize: number;
}): Promise<{ items: SettlementListRow[]; totalCount: number }> {
  const [rows, totalCount] = await Promise.all([
    prisma.settlement.findMany({
      orderBy: { createdAt: "desc" },
      skip: (paging.page - 1) * paging.pageSize,
      take: paging.pageSize,
      select: {
        id: true,
        marketplace: true,
        seller: true,
        periodFrom: true,
        periodTo: true,
        status: true,
        checksumOk: true,
        checksumVariance: true,
        createdAt: true,
        _count: { select: { lines: true } },
      },
    }),
    prisma.settlement.count(),
  ]);

  const settlementIds = rows.map((r) => r.id);
  const matchedGroups = settlementIds.length
    ? await prisma.settlementLine.groupBy({
        by: ["settlementId"],
        where: { settlementId: { in: settlementIds }, matchStatus: "MATCHED" },
        _count: { _all: true },
      })
    : [];
  const matchedCountBySettlementId = new Map(matchedGroups.map((g) => [g.settlementId, g._count._all]));

  const items: SettlementListRow[] = rows.map((r) => ({
    id: r.id,
    marketplace: r.marketplace,
    seller: r.seller,
    periodFromIso: r.periodFrom.toISOString(),
    periodToIso: r.periodTo.toISOString(),
    status: r.status,
    checksumOk: r.checksumOk,
    checksumVariance: toNum(r.checksumVariance),
    lineCount: r._count.lines,
    matchedCount: matchedCountBySettlementId.get(r.id) ?? 0,
    createdAtIso: r.createdAt.toISOString(),
  }));

  return { items, totalCount };
}

export type SettlementDetailLine = {
  id: string;
  orderNo: string;
  netIncome: number;
  cogsSnapshot: number | null;
  profit: number | null;
  matchStatus: string;
  matchedSalesOrderId: string | null;
  hargaAsliProduk: number;
  totalDiskonProduk: number;
  biayaAdministrasi: number;
  biayaLayanan: number;
  biayaKomisiAms: number;
  biayaProsesPesanan: number;
  raw: Record<string, unknown>;
  jubelioNet: number | null;
  netDelta: number | null;
  matches: boolean;
};

/**
 * Jubelio-side "net income" comparable to the excel's `netIncome`: the
 * matched SalesOrder's `feeBreakdown.escrow_amount` — "the value to be paid
 * to the seller from the MP after deducting the admin fee" (Jubelio API
 * docs), which is the same economic figure as Shopee's "Total Penghasilan".
 * `escrow_amount` is persisted as a string and defaults to "0" when Jubelio
 * never sent a value (see `buildFeeBreakdown`'s `dec()`), so a literal "0"
 * is treated as absent data, not a real zero-value escrow — mirrors the
 * `v !== "0"` filter `SalesOrderDetailClient` already applies to fee entries.
 */
export function deriveJubelioComparison(
  netIncome: number,
  feeBreakdown: Record<string, string> | null,
): { jubelioNet: number | null; netDelta: number | null; matches: boolean } {
  const escrowRaw = feeBreakdown?.escrow_amount;
  if (escrowRaw === undefined || escrowRaw === null || escrowRaw === "" || escrowRaw === "0") {
    return { jubelioNet: null, netDelta: null, matches: false };
  }
  const jubelioNet = Number(escrowRaw);
  if (!Number.isFinite(jubelioNet)) {
    return { jubelioNet: null, netDelta: null, matches: false };
  }
  const netDelta = Math.round((netIncome - jubelioNet) * 100) / 100;
  return { jubelioNet, netDelta, matches: Math.abs(netDelta) < 1 };
}

export type SettlementDetail = {
  id: string;
  marketplace: string;
  seller: string;
  periodFromIso: string;
  periodToIso: string;
  status: string;
  checksumOk: boolean;
  checksumVariance: number;
  totalDilepas: number;
  parsedNetTotal: number;
  createdAtIso: string;
  lines: SettlementDetailLine[];
  totalNetIncome: number;
  matchedNetIncome: number;
  totalCogs: number;
  totalProfit: number;
  matchedCount: number;
  unmatchedCount: number;
  profitPendingCount: number;
  matchRatePct: number;
  journalId: string | null;
  differCount: number;
};

export async function getSettlementById(id: string): Promise<SettlementDetail | null> {
  const row = await prisma.settlement.findUnique({
    where: { id },
    select: {
      id: true,
      marketplace: true,
      seller: true,
      periodFrom: true,
      periodTo: true,
      status: true,
      checksumOk: true,
      checksumVariance: true,
      totalDilepas: true,
      parsedNetTotal: true,
      createdAt: true,
      lines: {
        select: {
          id: true,
          orderNo: true,
          netIncome: true,
          cogsSnapshot: true,
          profit: true,
          matchStatus: true,
          matchedSalesOrderId: true,
          hargaAsliProduk: true,
          totalDiskonProduk: true,
          biayaAdministrasi: true,
          biayaLayanan: true,
          biayaKomisiAms: true,
          biayaProsesPesanan: true,
          raw: true,
        },
      },
    },
  });
  if (!row) return null;

  const journal = await prisma.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: id } },
    select: { id: true },
  });

  const matchedSalesOrderIds = Array.from(
    new Set(row.lines.map((l) => l.matchedSalesOrderId).filter((v): v is string => v !== null)),
  );
  const matchedOrders = matchedSalesOrderIds.length
    ? await prisma.salesOrder.findMany({
        where: { id: { in: matchedSalesOrderIds } },
        select: { id: true, feeBreakdown: true },
      })
    : [];
  const feeBreakdownByOrderId = new Map(
    matchedOrders.map((o) => [o.id, o.feeBreakdown as Record<string, string> | null]),
  );

  const lines: SettlementDetailLine[] = row.lines.map((l) => {
    const netIncome = toNum(l.netIncome);
    const feeBreakdown = l.matchedSalesOrderId
      ? (feeBreakdownByOrderId.get(l.matchedSalesOrderId) ?? null)
      : null;
    const comparison = deriveJubelioComparison(netIncome, feeBreakdown);
    return {
      id: l.id,
      orderNo: l.orderNo,
      netIncome,
      cogsSnapshot: l.cogsSnapshot === null ? null : toNum(l.cogsSnapshot),
      profit: l.profit === null ? null : toNum(l.profit),
      matchStatus: l.matchStatus,
      matchedSalesOrderId: l.matchedSalesOrderId,
      hargaAsliProduk: toNum(l.hargaAsliProduk),
      totalDiskonProduk: toNum(l.totalDiskonProduk),
      biayaAdministrasi: toNum(l.biayaAdministrasi),
      biayaLayanan: toNum(l.biayaLayanan),
      biayaKomisiAms: toNum(l.biayaKomisiAms),
      biayaProsesPesanan: toNum(l.biayaProsesPesanan),
      raw: l.raw as Record<string, unknown>,
      ...comparison,
    };
  });

  const totalNetIncome = lines.reduce((s, l) => s + l.netIncome, 0);
  // Same population as totalCogs/totalProfit (lines with a computed profit) so the
  // reconciling trio ties out exactly: matchedNetIncome - totalCogs === totalProfit.
  const linesWithProfit = lines.filter((l) => l.profit !== null);
  const matchedNetIncome = linesWithProfit.reduce((s, l) => s + l.netIncome, 0);
  const totalCogs = linesWithProfit.reduce((s, l) => s + (l.cogsSnapshot ?? 0), 0);
  const totalProfit = linesWithProfit.reduce((s, l) => s + (l.profit ?? 0), 0);
  const matchedCount = lines.filter((l) => l.matchStatus === "MATCHED").length;
  const unmatchedCount = lines.filter((l) => l.matchStatus === "UNMATCHED").length;
  const profitPendingCount = lines.filter((l) => l.matchStatus === "MATCHED" && l.profit === null).length;
  const matchRatePct = lines.length === 0 ? 0 : Math.round((matchedCount / lines.length) * 1000) / 10;
  const differCount = lines.filter(
    (l) => l.matchStatus === "MATCHED" && l.netDelta !== null && !l.matches,
  ).length;

  return {
    id: row.id,
    marketplace: row.marketplace,
    seller: row.seller,
    periodFromIso: row.periodFrom.toISOString(),
    periodToIso: row.periodTo.toISOString(),
    status: row.status,
    checksumOk: row.checksumOk,
    checksumVariance: toNum(row.checksumVariance),
    totalDilepas: toNum(row.totalDilepas),
    parsedNetTotal: toNum(row.parsedNetTotal),
    createdAtIso: row.createdAt.toISOString(),
    lines,
    totalNetIncome,
    matchedNetIncome,
    totalCogs,
    totalProfit,
    matchedCount,
    unmatchedCount,
    profitPendingCount,
    matchRatePct,
    journalId: journal?.id ?? null,
    differCount,
  };
}
