import { prisma, Prisma } from "@elorae/db";
import { computeStorePrice } from "@elorae/db/pricing";
import { buildOfflineSalesHistoryRows } from "@elorae/db/field-sales";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { variantDetailForSku } from "@/lib/items/variants";

export type SpgSaleLineInput = { itemId: string; variantSku: string | null; qty: number };
export type RecordSpgSaleResult =
  | { ok: true; spgSaleId: string; docNo: string; changeGiven: number }
  | { ok: false; code: "EMPTY" | "STORE_NOT_FOUND" | "NO_PRICE" | "INSUFFICIENT_PAYMENT" };

function mergeLines(lines: SpgSaleLineInput[]): SpgSaleLineInput[] {
  const map = new Map<string, SpgSaleLineInput>();
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const key = `${l.itemId}::${l.variantSku ?? ""}`;
    const e = map.get(key);
    if (e) e.qty += l.qty;
    else map.set(key, { itemId: l.itemId, variantSku: l.variantSku, qty: l.qty });
  }
  return Array.from(map.values());
}

/**
 * Record an SPG in-store sale — terminal POS, no approval, mirroring recordVanSale
 * (apps/web/lib/canvassing/sale-writer.ts) minus the stock dimension.
 *
 * Record-only: the buyer is the SPG's assigned store, goods are already at the
 * store, and no consignment/store stock ledger exists yet. This writer touches
 * NO VanStock, NO InventoryValue, NO StockAdjustment — only SpgSale/SpgSaleLine
 * + SalesHistory. Stock reconciliation is deferred (like konsi today).
 */
export async function recordSpgSale(input: {
  salesmanId: string;
  storeId: string;
  createdById?: string;
  lines: SpgSaleLineInput[];
  cashReceived?: number;
  saleLat?: number | null;
  saleLng?: number | null;
  note?: string;
  idempotencyKey?: string;
}): Promise<RecordSpgSaleResult> {
  const merged = mergeLines(input.lines);
  if (merged.length === 0) return { ok: false, code: "EMPTY" };

  return runSerializable(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.spgSale.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, docNo: true, changeGiven: true },
      });
      if (existing) return { ok: true, spgSaleId: existing.id, docNo: existing.docNo, changeGiven: Number(existing.changeGiven) };
    }

    const store = await tx.store.findUnique({ where: { id: input.storeId }, select: { marginPercent: true } });
    if (!store) return { ok: false, code: "STORE_NOT_FOUND" };
    const marginPercent = store.marginPercent === null ? null : Number(store.marginPercent);

    // Load item price + meta for each line
    // (SPG sales are always retail/PUTUS to the end customer, regardless of the
    // store's own consignment terms with Elorae — a KONSI store's own margin
    // never applies to what an SPG charges a walk-in shopper.)
    const itemIds = Array.from(new Set(merged.map((l) => l.itemId)));
    const items = await tx.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, sku: true, nameId: true, sellingPrice: true, variants: true, category: { select: { name: true } } },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));

    type Priced = { line: SpgSaleLineInput; item: typeof items[number]; unitPrice: number };
    const priced: Priced[] = [];

    for (const l of merged) {
      const item = itemById.get(l.itemId);
      if (!item) return { ok: false, code: "NO_PRICE" };
      const sp = item.sellingPrice === null ? null : Number(item.sellingPrice);
      const { price } = computeStorePrice({ sellingPrice: sp, termsType: "PUTUS", marginPercent });
      if (price === null) return { ok: false, code: "NO_PRICE" };
      priced.push({ line: l, item, unitPrice: price });
    }

    const displayName = (p: Priced) => {
      const label = variantDetailForSku(p.item.variants, p.line.variantSku);
      return label ? `${p.item.nameId} — ${label}` : p.item.nameId;
    };

    const total = priced.reduce((s, p) => s + p.line.qty * p.unitPrice, 0);
    const cashReceived = input.cashReceived ?? total;
    if (cashReceived < total) return { ok: false, code: "INSUFFICIENT_PAYMENT" };
    const changeGiven = cashReceived - total;

    const docNo = await generateDocNumber("SPGSALE", tx);
    const sale = await tx.spgSale.create({
      data: {
        docNo,
        salesmanId: input.salesmanId,
        storeId: input.storeId,
        createdById: input.createdById ?? input.salesmanId,
        saleLat: input.saleLat == null ? null : new Prisma.Decimal(input.saleLat),
        saleLng: input.saleLng == null ? null : new Prisma.Decimal(input.saleLng),
        subtotal: total,
        total,
        cashReceived,
        changeGiven,
        note: input.note,
        idempotencyKey: input.idempotencyKey ?? null,
        lines: {
          create: priced.map((p) => ({
            itemId: p.line.itemId,
            variantSku: p.line.variantSku ?? "",
            productName: displayName(p),
            qty: p.line.qty,
            unitPrice: p.unitPrice,
            lineTotal: p.line.qty * p.unitPrice,
          })),
        },
      },
      select: { id: true },
    });

    const now = new Date();
    const rows = buildOfflineSalesHistoryRows({
      orderNo: docNo,
      orderTotal: total,
      lines: priced.map((p) => ({
        itemId: p.line.itemId,
        variantSku: p.line.variantSku ?? "",
        parentSku: p.item.sku,
        productName: displayName(p),
        qty: p.line.qty,
        unitPrice: p.unitPrice,
        lineTotal: p.line.qty * p.unitPrice,
        productCategory: p.item.category?.name ?? null,
      })),
    }).map((r) => ({ ...r, orderDate: now, completedDate: now }));
    await tx.salesHistory.createMany({ data: rows });

    return { ok: true, spgSaleId: sale.id, docNo, changeGiven };
  });
}
