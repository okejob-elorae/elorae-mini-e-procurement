import { prisma } from "@elorae/db";
import { parseItemVariants, variantDetailForSku } from "@/lib/items/variants";
import { hargaKasirSpg, syaratHargaToko, type SyaratHargaToko } from "./harga-kasir";

export type SpgCatalogRow = {
  itemId: string;
  sku: string;
  productName: string;
  variantSku: string | null;
  variantLabel: string | null;
  price: number | null;
  /** Barcode varian dari data varian (kalau diisi) — untuk pemindai. */
  barcode: string | null;
  /** Saldo di toko SPG; null kalau katalog dimuat tanpa toko. */
  stok: number | null;
  /** Kategori barang — promo konter bisa menyasar kategori. */
  categoryId: string | null;
};

/**
 * SPG catalog — active finished goods. Every variant defined on the item is offered.
 *
 * With `storeId`, each row is priced at that store's counter price
 * (`hargaKasirSpg`, the same function recordSpgSale uses): the Elorae selling
 * price at a PUTUS store, the in-store price (grossed up by the store's margin)
 * at a KONSI store — so the phone's preview and offline queue show exactly what
 * the server will record. Without `storeId` (pickers that never show a price)
 * rows carry the plain Elorae selling price.
 *
 * With `storeId`, each row also carries the store's own stock balance. It is
 * shown, never used as a gate: an SPG records what physically sold, and a
 * negative balance is settled by a store opname, not by refusing the sale.
 */
export async function getSellableCatalogForSpg(storeId?: string): Promise<SpgCatalogRow[]> {
  const [rows, grup, toko] = await Promise.all([
    prisma.item.findMany({
      where: { isActive: true, type: "FINISHED_GOOD" },
      orderBy: { nameId: "asc" },
      select: { id: true, sku: true, nameId: true, sellingPrice: true, variants: true, categoryId: true },
    }),
    storeId
      ? prisma.storeStockMovement.groupBy({ by: ["itemId", "variantSku"], where: { storeId }, _sum: { qty: true } })
      : Promise.resolve([]),
    storeId ? prisma.store.findUnique({ where: { id: storeId }, select: { termsType: true, marginPercent: true } }) : Promise.resolve(null),
  ]);
  const syarat: SyaratHargaToko = toko ? syaratHargaToko(toko) : { termsType: "PUTUS", marginPercent: null };
  const saldo = new Map(grup.map((g) => [`${g.itemId}::${g.variantSku}`, g._sum.qty ?? 0]));
  const stok = (itemId: string, variantSku: string | null) => (storeId ? (saldo.get(`${itemId}::${variantSku ?? ""}`) ?? 0) : null);

  const out: SpgCatalogRow[] = [];
  for (const r of rows) {
    const price = hargaKasirSpg(r.sellingPrice === null ? null : Number(r.sellingPrice), syarat);
    const varian = parseItemVariants(r.variants)
      .map((v) => ({ sku: String(v.sku ?? "").trim(), barcode: String((v as { barcode?: unknown }).barcode ?? "").trim() || null }))
      .filter((v) => v.sku);

    if (varian.length === 0) {
      out.push({
        itemId: r.id,
        sku: r.sku,
        productName: r.nameId,
        variantSku: null,
        variantLabel: null,
        price,
        barcode: null,
        stok: stok(r.id, null),
        categoryId: r.categoryId,
      });
      continue;
    }
    for (const v of varian) {
      out.push({
        itemId: r.id,
        sku: r.sku,
        productName: r.nameId,
        variantSku: v.sku,
        variantLabel: variantDetailForSku(r.variants, v.sku) ?? v.sku,
        price,
        barcode: v.barcode,
        stok: stok(r.id, v.sku),
        categoryId: r.categoryId,
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
  /** Jumlah seluruh potongan (promo barang + promo belanja + diskon manual). 0 untuk nota lama. */
  discountTotal: number;
  orderPromoName: string | null;
  orderDiscount: number;
  manualDiscount: number;
  manualDiscountReason: string | null;
  /** Diskon member nota ini (0 = bukan member atau tanpa diskon) dan tingkatnya saat dijual. */
  memberDiscount: number;
  memberTier: string | null;
  /** Dicatat tanpa sinyal lalu terkirim belakangan (`syncedAtIso`). */
  capturedOffline: boolean;
  syncedAtIso: string | null;
  customer: { id: string; name: string; phone: string } | null;
  /**
   * `unitPrice` = harga sebelum potongan; `lineTotal` = BERSIH sesudah seluruh
   * potongan (jumlah semua baris = `total`); `discount` = potongan baris itu.
   */
  lines: Array<{
    productName: string;
    variantSku: string | null;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    discount: number;
    promoName: string | null;
    /**
     * Bagian PROMO BARANG dari `discount`, dari rincian promo nota
     * (`SpgSalePromo`, sejak 2026-10-20). null untuk nota lama tanpa rincian.
     */
    promoDiscount: number | null;
  }>;
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
  const [pelanggan, rincian] = await Promise.all([
    r.customerId
      ? prisma.storeCustomer.findFirst({ where: { id: r.customerId, storeId: r.storeId }, select: { id: true, name: true, phone: true } })
      : null,
    prisma.spgSalePromo.findMany({ where: { spgSaleId: r.id, kind: "BARANG" }, select: { spgSaleLineId: true, discount: true } }),
  ]);
  const adaRincian =
    rincian.length > 0 || (r.orderPromoId !== null && (await prisma.spgSalePromo.count({ where: { spgSaleId: r.id } })) > 0);
  const promoPerBaris = new Map<string, number>();
  for (const x of rincian) {
    if (x.spgSaleLineId) promoPerBaris.set(x.spgSaleLineId, Math.round(((promoPerBaris.get(x.spgSaleLineId) ?? 0) + Number(x.discount)) * 100) / 100);
  }
  // Nota dengan rincian: baris tanpa baris rincian memang tanpa promo barang (0). Nota lama
  // yang memakai promo tanpa rincian → null, pembaca memakai aturan lamanya.
  const sejakRincian = adaRincian;
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
    discountTotal: Number(r.discountTotal),
    orderPromoName: r.orderPromoName,
    orderDiscount: Number(r.orderDiscount),
    manualDiscount: Number(r.manualDiscount),
    manualDiscountReason: r.manualDiscountReason,
    memberDiscount: Number(r.memberDiscount),
    memberTier: r.memberTier,
    capturedOffline: r.capturedOffline,
    syncedAtIso: r.syncedAt ? r.syncedAt.toISOString() : null,
    customer: pelanggan,
    lines: r.lines.map((l) => ({
      productName: l.productName,
      variantSku: l.variantSku || null,
      qty: l.qty,
      unitPrice: Number(l.unitPrice),
      lineTotal: Number(l.lineTotal),
      discount: Number(l.discount),
      promoName: l.promoName,
      promoDiscount: sejakRincian ? (promoPerBaris.get(l.id) ?? 0) : null,
    })),
  };
}
