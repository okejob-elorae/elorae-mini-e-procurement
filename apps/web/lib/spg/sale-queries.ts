import { prisma } from "@elorae/db";
import { computeStorePrice } from "@elorae/db/pricing";
import { parseItemVariants, variantDetailForSku } from "@/lib/items/variants";

export type SpgCatalogRow = {
  itemId: string;
  sku: string;
  productName: string;
  variantSku: string | null;
  variantLabel: string | null;
  price: number | null;
};

/**
 * SPG record-sale catalog — active finished goods, priced PUTUS (retail),
 * mirroring the pricing recordSpgSale itself applies (store-independent:
 * PUTUS ignores marginPercent, so this never needs the store's own
 * consignment terms). No stock/available field — SpgSale is record-only, no
 * inventory ledger backs it (see recordSpgSale doc comment), so nothing here
 * should imply a stock gate. Every variant defined on the item is offered
 * (not just ones with an InventoryValue row) since there is no stock check.
 */
export async function getSellableCatalogForSpg(): Promise<SpgCatalogRow[]> {
  const rows = await prisma.item.findMany({
    where: { isActive: true, type: "FINISHED_GOOD" },
    orderBy: { nameId: "asc" },
    select: { id: true, sku: true, nameId: true, sellingPrice: true, variants: true },
  });

  const out: SpgCatalogRow[] = [];
  for (const r of rows) {
    const sp = r.sellingPrice === null ? null : Number(r.sellingPrice);
    const { price } = computeStorePrice({ sellingPrice: sp, termsType: "PUTUS", marginPercent: null });
    const variantSkus = parseItemVariants(r.variants)
      .map((v) => (v.sku ?? "").trim())
      .filter(Boolean);

    if (variantSkus.length === 0) {
      out.push({ itemId: r.id, sku: r.sku, productName: r.nameId, variantSku: null, variantLabel: null, price });
      continue;
    }
    for (const vSku of variantSkus) {
      out.push({
        itemId: r.id,
        sku: r.sku,
        productName: r.nameId,
        variantSku: vSku,
        variantLabel: variantDetailForSku(r.variants, vSku) ?? vSku,
        price,
      });
    }
  }
  return out;
}

export type SpgSaleListRow = { id: string; docNo: string; salesmanLabel: string; storeName: string; total: number; createdAtIso: string };

export async function listSpgSales(
  filters: { salesmanId?: string; from?: Date; to?: Date },
  paging: { page: number; pageSize: number },
): Promise<{ items: SpgSaleListRow[]; totalCount: number }> {
  const where: Record<string, unknown> = {};
  if (filters.salesmanId) where.salesmanId = filters.salesmanId;
  if (filters.from || filters.to) where.createdAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) };
  const [rows, totalCount] = await Promise.all([
    prisma.spgSale.findMany({
      where, orderBy: { createdAt: "desc" },
      skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize,
      include: { salesman: { select: { name: true, email: true } }, store: { select: { name: true } } },
    }),
    prisma.spgSale.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id, docNo: r.docNo,
      salesmanLabel: r.salesman.name ?? r.salesman.email,
      storeName: r.store.name,
      total: Number(r.total), createdAtIso: r.createdAt.toISOString(),
    })),
    totalCount,
  };
}

export type SpgSalesmanOption = { id: string; label: string };

export async function listSpgSalesmen(): Promise<SpgSalesmanOption[]> {
  const users = await prisma.user.findMany({
    where: { assignedStoreId: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
  return users.map((u) => ({ id: u.id, label: u.name ?? u.email }));
}

export type SpgSaleDetail = {
  id: string;
  docNo: string;
  salesmanLabel: string;
  storeName: string;
  saleLat: number | null;
  saleLng: number | null;
  subtotal: number;
  total: number;
  cashReceived: number;
  changeGiven: number;
  note: string | null;
  createdAtIso: string;
  lines: Array<{ productName: string; variantSku: string | null; qty: number; unitPrice: number; lineTotal: number }>;
};

/**
 * Scope to owner (opts.salesmanId) when called from the PWA nota view, so an
 * SPG can only fetch their own sales. Payload carries no cost/margin field —
 * SpgSaleLine has no unitCost (record-only, no stock/COGS snapshot exists).
 */
export async function getSpgSaleById(id: string, opts?: { salesmanId?: string }): Promise<SpgSaleDetail | null> {
  const r = await prisma.spgSale.findFirst({
    where: { id, ...(opts?.salesmanId ? { salesmanId: opts.salesmanId } : {}) },
    include: { salesman: { select: { name: true, email: true } }, store: { select: { name: true } }, lines: true },
  });
  if (!r) return null;
  return {
    id: r.id,
    docNo: r.docNo,
    salesmanLabel: r.salesman.name ?? r.salesman.email,
    storeName: r.store.name,
    saleLat: r.saleLat === null ? null : Number(r.saleLat),
    saleLng: r.saleLng === null ? null : Number(r.saleLng),
    subtotal: Number(r.subtotal),
    total: Number(r.total),
    cashReceived: Number(r.cashReceived),
    changeGiven: Number(r.changeGiven),
    note: r.note,
    createdAtIso: r.createdAt.toISOString(),
    lines: r.lines.map((l) => ({
      productName: l.productName,
      variantSku: l.variantSku || null,
      qty: l.qty,
      unitPrice: Number(l.unitPrice),
      lineTotal: Number(l.lineTotal),
    })),
  };
}
