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
 * (apps/web/lib/canvassing/sale-writer.ts) minus the main-warehouse stock dimension.
 *
 * The buyer is the SPG's assigned store; goods are already at the store. This writer
 * touches NO VanStock, NO InventoryValue, NO StockAdjustment — those units left main at
 * konsi transfer time and were adjusted then. At a KONSI store it DOES decrement the
 * store's own StoreStock ledger (see the block inside the transaction below), because
 * the goods physically leave the store when the SPG sells them. Only SpgSale/SpgSaleLine
 * + SalesHistory + (KONSI-gated) StoreStock are written.
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

    const store = await tx.store.findUnique({ where: { id: input.storeId }, select: { marginPercent: true, termsType: true } });
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

    /*
     * Goods physically leave a consignment store when the SPG sells them, so the store's own
     * ledger must move with the sale. Written next to the document that causes it and inside
     * the same serializable transaction, so a failure rolls the sale back too — a sale that
     * records without moving stock is exactly the defect this closes.
     *
     * Below the idempotency short-circuit on purpose: a replay returns the existing sale
     * before reaching here, which makes the decrement replay-safe with no guard of its own.
     *
     * KONSI-gated, and the gate is load-bearing rather than defensive. Nothing requires an
     * SPG's assigned store to be a consignment store, and at a PUTUS store the goods were sold
     * outright — the store owns them, no StoreStock row exists, and creating a negative one
     * would invent a liability for stock Elorae does not own.
     *
     * The quantity is p.line.qty from the same `priced` array the SpgSaleLine rows were
     * written from, NOT from input.lines. Note this is a structural choice, not one a test on
     * the final StoreStock balance can distinguish: the pricing loop above either pushes every
     * `merged` entry into `priced` or returns early before any write happens at all (including
     * before this decrement and before tx.spgSale.create), so `priced` is never a partial
     * subset of `merged` — a line is never silently dropped. And because each key here is
     * re-read fresh per iteration, decrementing off raw (pre-merge) input.lines would settle at
     * the same final qty as decrementing off the merged priced entry (two decrements of 3 land
     * on the same total as one decrement of 6). The reason to reuse `priced` is that it is the
     * exact same aggregation SpgSaleLine was built from, so the ledger key and the document
     * line can never disagree about which qty produced which document row — not because
     * rebuilding from input.lines would produce a different number here.
     */
    if (store.termsType === "KONSI") {
      for (const p of priced) {
        const variantSku = p.line.variantSku ?? "";
        const storeKey = { storeId_itemId_variantSku: { storeId: input.storeId, itemId: p.line.itemId, variantSku } };
        const existing = await tx.storeStock.findUnique({ where: storeKey, select: { qty: true } });
        const prevQty = existing ? existing.qty.toNumber() : 0;
        /*
         * Never clamped and never refused: the sale already happened and the cash is in the
         * till. A negative row is the signal that the ledger missed something, and it is
         * surfaced by the store stock card's existing destructive badge and negativeCount
         * header.
         *
         * avgCost is not recomputed — removing units at the current average leaves it
         * unchanged. A newly created negative row carries avgCost 0 because a sale of stock
         * the ledger never held has no cost basis, and the konsi transfer's blend already
         * clamps a negative previous quantity to zero, so that zero is absorbed correctly by
         * the next transfer in.
         */
        await tx.storeStock.upsert({
          where: storeKey,
          create: { storeId: input.storeId, itemId: p.line.itemId, variantSku, qty: -p.line.qty, avgCost: 0 },
          update: { qty: prevQty - p.line.qty },
        });
      }
    }

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
