import { prisma } from "@elorae/db";
import { variantDetailForSku } from "@/lib/items/variants";
import { reconcileSplit } from "./van-journal-values";
import { findPostableJournalDocIds } from "./journal-pending";

export type VanReconcileRow = { itemId: string; sku: string; productName: string; variantSku: string | null; variantLabel: string | null; expectedQty: number; avgCost: number };
export type VanReconcileListRow = { id: string; docNo: string; reconciledByLabel: string; totalReturnedQty: number; totalVarianceQty: number; createdAtIso: string };
export type VanReconcileDetail = {
  id: string; docNo: string; canvasserLabel: string; reconciledByLabel: string; note: string | null; createdAtIso: string;
  totalReturnedQty: number; totalVarianceQty: number;
  lines: Array<{ productName: string; variantSku: string | null; expectedQty: number; countedQty: number; varianceQty: number; unitCost: number }>;
  journalId: string | null; hasPostableJournal: boolean;
};

export async function getVanForReconcile(canvasserId: string): Promise<VanReconcileRow[]> {
  const rows = await prisma.vanStock.findMany({
    where: { userId: canvasserId, qty: { gt: 0 } },
    include: { item: { select: { sku: true, nameId: true, variants: true } } },
    orderBy: { item: { nameId: "asc" } },
  });
  return rows.map((r) => ({
    itemId: r.itemId,
    sku: r.item.sku,
    productName: r.item.nameId,
    variantSku: r.variantSku,
    variantLabel: variantDetailForSku(r.item.variants, r.variantSku),
    expectedQty: r.qty.toNumber(),
    avgCost: r.avgCost.toNumber(),
  }));
}

export async function listVanReconciles(canvasserId: string, paging: { page: number; pageSize: number }): Promise<{ items: VanReconcileListRow[]; totalCount: number }> {
  const where = { canvasserId };
  const [rows, totalCount] = await Promise.all([
    prisma.vanReconcile.findMany({
      where, orderBy: { createdAt: "desc" },
      skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize,
      include: { reconciledBy: { select: { name: true, email: true } } },
    }),
    prisma.vanReconcile.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id, docNo: r.docNo,
      reconciledByLabel: r.reconciledBy.name ?? r.reconciledBy.email,
      totalReturnedQty: Number(r.totalReturnedQty), totalVarianceQty: Number(r.totalVarianceQty),
      createdAtIso: r.createdAt.toISOString(),
    })),
    totalCount,
  };
}

export async function getVanReconcileById(id: string): Promise<VanReconcileDetail | null> {
  const r = await prisma.vanReconcile.findUnique({
    where: { id },
    include: { canvasser: { select: { name: true, email: true } }, reconciledBy: { select: { name: true, email: true } }, lines: true },
  });
  if (!r) return null;
  const journal = await prisma.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "VAN_RECONCILE", sourceId: r.id } },
    select: { id: true },
  });
  const { returned, variance } = reconcileSplit(
    r.lines.map((l) => ({ countedQty: Number(l.countedQty), varianceQty: Number(l.varianceQty), unitCost: Number(l.unitCost) })),
  );
  const pendingIds = await findPostableJournalDocIds("van_reconcile", [r.id]);
  return {
    id: r.id, docNo: r.docNo,
    canvasserLabel: r.canvasser.name ?? r.canvasser.email,
    reconciledByLabel: r.reconciledBy.name ?? r.reconciledBy.email,
    note: r.note, createdAtIso: r.createdAt.toISOString(),
    totalReturnedQty: Number(r.totalReturnedQty), totalVarianceQty: Number(r.totalVarianceQty),
    lines: r.lines.map((l) => ({ productName: l.productName, variantSku: l.variantSku, expectedQty: Number(l.expectedQty), countedQty: Number(l.countedQty), varianceQty: Number(l.varianceQty), unitCost: Number(l.unitCost) })),
    journalId: journal?.id ?? null,
    /*
     * journal == null alone is not sufficient: a reconcile recorded before
     * auto-posting existed also has no journal, but auto-posting never ran
     * for it. Only offer the retry when a JOURNAL_PENDING notification
     * proves a post was attempted and failed for THIS reconcile.
     */
    hasPostableJournal: journal == null && (Math.abs(returned) >= 0.01 || Math.abs(variance) >= 0.01) && pendingIds.has(r.id),
  };
}
