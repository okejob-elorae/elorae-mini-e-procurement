import { prisma, Prisma } from "@elorae/db";
import { computeStorePrice } from "@elorae/db/pricing";
import { buildOfflineSalesHistoryRows } from "@elorae/db/field-sales";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";

export type VanSaleLineInput = { itemId: string; variantSku: string | null; qty: number };
export type RecordVanSaleResult =
  | { ok: true; saleId: string; docNo: string; changeAmount: number }
  | { ok: false; code: "EMPTY" | "NO_PRICE" | "INSUFFICIENT_PAYMENT" }
  | { ok: false; code: "INSUFFICIENT_VAN_STOCK"; shortLines: Array<{ itemId: string; variantSku: string | null; requested: number; available: number }> };

function mergeLines(lines: VanSaleLineInput[]): VanSaleLineInput[] {
  const map = new Map<string, VanSaleLineInput>();
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const key = `${l.itemId}::${l.variantSku ?? ""}`;
    const e = map.get(key);
    if (e) e.qty += l.qty;
    else map.set(key, { itemId: l.itemId, variantSku: l.variantSku, qty: l.qty });
  }
  return Array.from(map.values());
}

export async function recordVanSale(input: {
  salesmanId: string; storeId?: string | null; buyerName?: string | null; buyerPhone?: string | null;
  saleLat?: number | null; saleLng?: number | null;
  lines: VanSaleLineInput[]; amountPaid: number; note?: string; idempotencyKey?: string;
}): Promise<RecordVanSaleResult> {
  const merged = mergeLines(input.lines);
  if (merged.length === 0) return { ok: false, code: "EMPTY" };

  return runSerializable(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.vanSale.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, docNo: true, changeAmount: true } });
      if (existing) return { ok: true, saleId: existing.id, docNo: existing.docNo, changeAmount: Number(existing.changeAmount) };
    }

    // Load item price + meta for each line
    // (van sales price at PUTUS = item sellingPrice; store margin only affects KONSI, which van sales never are)
    const itemIds = Array.from(new Set(merged.map((l) => l.itemId)));
    const items = await tx.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, sku: true, nameId: true, sellingPrice: true, category: { select: { name: true } } },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));

    type Priced = { line: VanSaleLineInput; item: typeof items[number]; unitPrice: number; vanQty: number; vanCost: number };
    const priced: Priced[] = [];
    const shortLines: Array<{ itemId: string; variantSku: string | null; requested: number; available: number }> = [];

    for (const l of merged) {
      const item = itemById.get(l.itemId);
      if (!item) return { ok: false, code: "NO_PRICE" };
      const sp = item.sellingPrice === null ? null : Number(item.sellingPrice);
      const { price } = computeStorePrice({ sellingPrice: sp, termsType: "PUTUS", marginPercent: null });
      if (price === null) return { ok: false, code: "NO_PRICE" };

      const van = await tx.vanStock.findUnique({
        where: { userId_itemId_variantSku: { userId: input.salesmanId, itemId: l.itemId, variantSku: l.variantSku ?? "" } },
        select: { qty: true, avgCost: true },
      });
      const vanQty = van ? Number(van.qty) : 0;
      if (l.qty > vanQty) { shortLines.push({ itemId: l.itemId, variantSku: l.variantSku, requested: l.qty, available: vanQty }); continue; }
      priced.push({ line: l, item, unitPrice: price, vanQty, vanCost: van ? Number(van.avgCost) : 0 });
    }
    if (shortLines.length > 0) return { ok: false, code: "INSUFFICIENT_VAN_STOCK", shortLines };

    const total = priced.reduce((s, p) => s + p.line.qty * p.unitPrice, 0);
    if (input.amountPaid < total) return { ok: false, code: "INSUFFICIENT_PAYMENT" };
    const changeAmount = input.amountPaid - total;

    for (const p of priced) {
      await tx.vanStock.update({
        where: { userId_itemId_variantSku: { userId: input.salesmanId, itemId: p.line.itemId, variantSku: p.line.variantSku ?? "" } },
        data: { qty: p.vanQty - p.line.qty },
      });
    }

    const docNo = await generateDocNumber("VANSALE", tx);
    const sale = await tx.vanSale.create({
      data: {
        docNo,
        salesmanId: input.salesmanId,
        storeId: input.storeId ?? null,
        buyerName: input.buyerName ?? null,
        buyerPhone: input.buyerPhone ?? null,
        saleLat: input.saleLat == null ? null : new Prisma.Decimal(input.saleLat),
        saleLng: input.saleLng == null ? null : new Prisma.Decimal(input.saleLng),
        subtotal: total,
        total,
        amountPaid: input.amountPaid,
        changeAmount,
        note: input.note,
        idempotencyKey: input.idempotencyKey ?? null,
        lines: {
          create: priced.map((p) => ({
            itemId: p.line.itemId,
            variantSku: p.line.variantSku ?? "",
            productName: p.item.nameId,
            qty: p.line.qty,
            unitPrice: p.unitPrice,
            unitCost: p.vanCost,
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
        productName: p.item.nameId,
        qty: p.line.qty,
        unitPrice: p.unitPrice,
        lineTotal: p.line.qty * p.unitPrice,
        productCategory: p.item.category?.name ?? null,
      })),
    }).map((r) => ({ ...r, orderDate: now, completedDate: now }));
    await tx.salesHistory.createMany({ data: rows });

    return { ok: true, saleId: sale.id, docNo, changeAmount };
  });
}
