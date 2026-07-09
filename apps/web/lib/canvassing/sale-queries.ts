import { prisma } from "@elorae/db";
import { computeStorePrice } from "@elorae/db/pricing";

export type SellableVanRow = { itemId: string; sku: string; productName: string; variantSku: string | null; qtyOnVan: number; price: number | null };
export type VanSaleListRow = { id: string; docNo: string; salesmanLabel: string; buyerLabel: string; total: number; createdAtIso: string };
export type VanSaleDetail = {
  id: string; docNo: string; salesmanLabel: string; storeName: string | null; buyerName: string | null; buyerPhone: string | null;
  saleLat: number | null; saleLng: number | null; subtotal: number; total: number; amountPaid: number; changeAmount: number;
  note: string | null; createdAtIso: string;
  lines: Array<{ productName: string; variantSku: string | null; qty: number; unitPrice: number; unitCost: number; lineTotal: number }>;
};

export async function getSellableVanStock(salesmanId: string): Promise<SellableVanRow[]> {
  // Van sale price = PUTUS = item sellingPrice (store margin only affects KONSI, which van sales never are),
  // so pricing is buyer-independent.
  const rows = await prisma.vanStock.findMany({
    where: { userId: salesmanId, qty: { gt: 0 } },
    include: { item: { select: { sku: true, nameId: true, sellingPrice: true } } },
    orderBy: { item: { nameId: "asc" } },
  });
  return rows.map((r) => {
    const sp = r.item.sellingPrice === null ? null : Number(r.item.sellingPrice);
    const { price } = computeStorePrice({ sellingPrice: sp, termsType: "PUTUS", marginPercent: null });
    return { itemId: r.itemId, sku: r.item.sku, productName: r.item.nameId, variantSku: r.variantSku, qtyOnVan: Number(r.qty), price };
  });
}

export async function listVanSales(
  filters: { salesmanId?: string; from?: Date; to?: Date },
  paging: { page: number; pageSize: number },
): Promise<{ items: VanSaleListRow[]; totalCount: number }> {
  const where: Record<string, unknown> = {};
  if (filters.salesmanId) where.salesmanId = filters.salesmanId;
  if (filters.from || filters.to) where.createdAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) };
  const [rows, totalCount] = await Promise.all([
    prisma.vanSale.findMany({
      where, orderBy: { createdAt: "desc" },
      skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize,
      include: { salesman: { select: { name: true, email: true } }, store: { select: { name: true } } },
    }),
    prisma.vanSale.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id, docNo: r.docNo,
      salesmanLabel: r.salesman.name ?? r.salesman.email,
      buyerLabel: r.store?.name ?? r.buyerName ?? "—",
      total: Number(r.total), createdAtIso: r.createdAt.toISOString(),
    })),
    totalCount,
  };
}

export async function getVanSaleById(id: string): Promise<VanSaleDetail | null> {
  const r = await prisma.vanSale.findUnique({
    where: { id },
    include: { salesman: { select: { name: true, email: true } }, store: { select: { name: true } }, lines: true },
  });
  if (!r) return null;
  return {
    id: r.id, docNo: r.docNo,
    salesmanLabel: r.salesman.name ?? r.salesman.email,
    storeName: r.store?.name ?? null, buyerName: r.buyerName, buyerPhone: r.buyerPhone,
    saleLat: r.saleLat === null ? null : Number(r.saleLat), saleLng: r.saleLng === null ? null : Number(r.saleLng),
    subtotal: Number(r.subtotal), total: Number(r.total), amountPaid: Number(r.amountPaid), changeAmount: Number(r.changeAmount),
    note: r.note, createdAtIso: r.createdAt.toISOString(),
    lines: r.lines.map((l) => ({ productName: l.productName, variantSku: l.variantSku, qty: Number(l.qty), unitPrice: Number(l.unitPrice), unitCost: Number(l.unitCost), lineTotal: Number(l.lineTotal) })),
  };
}
