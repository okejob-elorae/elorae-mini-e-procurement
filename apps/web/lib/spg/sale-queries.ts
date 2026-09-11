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
  onCounterQty: number;
};

/**
 * SPG record-sale catalog — active finished goods, priced PUTUS (retail),
 * mirroring the pricing recordSpgSale itself applies (PUTUS ignores
 * marginPercent, so this never needs the store's own consignment terms —
 * but it DOES need the store's priceDiscountPercent, since that applies to
 * every PUTUS-priced line regardless of the store's own consignment terms;
 * looked up below so this preview matches what recordSpgSale actually
 * charges). The set stays UNRESTRICTED — every active finished good
 * is offered, including one with no StoreStock row at all (reports 0).
 * recordSpgSale is no longer fully record-only — it decrements StoreStock at
 * a KONSI store (see its doc comment) — but this query still enforces NO
 * stock gate: the set below is never filtered, capped, or ordered by
 * onCounterQty.
 *
 * onCounterQty is an ON-COUNTER LOCATION figure read from StoreStock only. It
 * is NOT available-for-sale (that stays InventoryValue.qtyOnHand - reservedQty,
 * main-only) and it must never gate, cap, or clamp anything — it is
 * information the SPG sees alongside a row they can already sell regardless
 * of what it says, including negative (the ledger missed something; the sale
 * already happened and the cash is in the till).
 *
 * Batched: one findMany for the store's StoreStock rows, folded into a map —
 * not a query per catalog row.
 *
 * Variant-key hazard: SpgCatalogRow.variantSku is `string | null` (a
 * variantless row carries null) while StoreStock.variantSku is non-nullable
 * `@default("")`. The CATALOG side is normalised with `?? ""` before the map
 * lookup, exactly as recordSpgSale's own StoreStock key does — matching null
 * against "" finds nothing and would silently report 0 for every variantless
 * item. Every variant defined on the item is still offered (not just ones
 * with a StoreStock row) since there is no stock check.
 */
export async function getSellableCatalogForSpg(storeId: string): Promise<SpgCatalogRow[]> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { priceDiscountPercent: true } });
  const priceDiscountPercent = store?.priceDiscountPercent == null ? null : Number(store.priceDiscountPercent);

  const rows = await prisma.item.findMany({
    where: { isActive: true, type: "FINISHED_GOOD" },
    orderBy: { nameId: "asc" },
    select: { id: true, sku: true, nameId: true, sellingPrice: true, variants: true },
  });

  const stockRows = await prisma.storeStock.findMany({
    where: { storeId },
    select: { itemId: true, variantSku: true, qty: true },
  });
  const stockByKey = new Map<string, number>();
  for (const s of stockRows) {
    stockByKey.set(`${s.itemId}::${s.variantSku}`, s.qty.toNumber());
  }
  const onCounterQtyFor = (itemId: string, variantSku: string | null) => stockByKey.get(`${itemId}::${variantSku ?? ""}`) ?? 0;

  const out: SpgCatalogRow[] = [];
  for (const r of rows) {
    const sp = r.sellingPrice === null ? null : Number(r.sellingPrice);
    const { price } = computeStorePrice({ sellingPrice: sp, termsType: "PUTUS", marginPercent: null, priceDiscountPercent });
    const variantSkus = parseItemVariants(r.variants)
      .map((v) => (v.sku ?? "").trim())
      .filter(Boolean);

    if (variantSkus.length === 0) {
      out.push({
        itemId: r.id,
        sku: r.sku,
        productName: r.nameId,
        variantSku: null,
        variantLabel: null,
        price,
        onCounterQty: onCounterQtyFor(r.id, null),
      });
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
        onCounterQty: onCounterQtyFor(r.id, vSku),
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
