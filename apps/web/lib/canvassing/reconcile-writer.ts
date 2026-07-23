import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { variantDetailForSku } from "@/lib/items/variants";
import { weightedAvgCost } from "./cost";

export type ReconcileCountInput = { itemId: string; variantSku: string | null; countedQty: number };
export type RecordVanReconcileResult =
  | { ok: true; reconcileId: string; docNo: string; totalReturned: number; totalVarianceQty: number }
  | { ok: false; code: "EMPTY_VAN" | "VARIANCE_NEEDS_REASON" | "COUNT_MISMATCH" };

export async function recordVanReconcile(input: {
  canvasserId: string;
  reconciledById: string;
  counts: ReconcileCountInput[];
  note?: string;
}): Promise<RecordVanReconcileResult> {
  return runSerializable(async (tx) => {
    const vanRows = await tx.vanStock.findMany({
      where: { userId: input.canvasserId, qty: { gt: 0 } },
      include: { item: { select: { sku: true, nameId: true, variants: true } } },
    });
    if (vanRows.length === 0) return { ok: false, code: "EMPTY_VAN" };

    // Index counts by key; require exactly one count per van row, no extras.
    const countByKey = new Map<string, number>();
    for (const c of input.counts) {
      const key = `${c.itemId}::${c.variantSku ?? ""}`;
      if (countByKey.has(key)) return { ok: false, code: "COUNT_MISMATCH" }; // duplicate
      countByKey.set(key, Math.max(0, c.countedQty));
    }
    if (countByKey.size !== vanRows.length) return { ok: false, code: "COUNT_MISMATCH" };
    for (const r of vanRows) {
      if (!countByKey.has(`${r.itemId}::${r.variantSku ?? ""}`)) return { ok: false, code: "COUNT_MISMATCH" };
    }

    type Line = { itemId: string; variantSku: string | null; productName: string; expected: number; counted: number; variance: number; avgCost: number };
    const lines: Line[] = vanRows.map((r) => {
      const expected = r.qty.toNumber();
      const counted = countByKey.get(`${r.itemId}::${r.variantSku ?? ""}`)!;
      const label = variantDetailForSku(r.item.variants, r.variantSku);
      const productName = label ? `${r.item.nameId} — ${label}` : r.item.nameId;
      return { itemId: r.itemId, variantSku: r.variantSku, productName, expected, counted, variance: expected - counted, avgCost: r.avgCost.toNumber() };
    });

    const hasVariance = lines.some((l) => l.variance !== 0);
    if (hasVariance && !(input.note && input.note.trim())) return { ok: false, code: "VARIANCE_NEEDS_REASON" };

    const canvasser = await tx.user.findUnique({ where: { id: input.canvasserId }, select: { name: true, email: true } });
    const canvasserLabel = canvasser?.name ?? canvasser?.email ?? input.canvasserId;
    const docNo = await generateDocNumber("VANRECON", tx);

    let totalReturned = 0;
    let totalVarianceQty = 0;
    for (const l of lines) {
      totalReturned += l.counted;
      totalVarianceQty += l.variance;

      if (l.counted > 0) {
        // Return to main. Variantless main rows use variantSku: null (not ""), so use an
        // OR-tolerant lookup (same as loadVan) — calculateMovingAverage's strict ""-key lookup
        // would miss the real row and fork a phantom "" row.
        const main = (l.variantSku ?? "") === ""
          ? await tx.inventoryValue.findFirst({ where: { itemId: l.itemId, OR: [{ variantSku: null }, { variantSku: "" }] }, select: { id: true, qtyOnHand: true, avgCost: true } })
          : await tx.inventoryValue.findFirst({ where: { itemId: l.itemId, variantSku: l.variantSku }, select: { id: true, qtyOnHand: true, avgCost: true } });

        const prevQty = main ? main.qtyOnHand.toNumber() : 0;
        const prevAvg = main ? main.avgCost.toNumber() : 0;
        const newQty = prevQty + l.counted;
        const newAvg = weightedAvgCost(prevQty, prevAvg, l.counted, l.avgCost);

        if (main) {
          await tx.inventoryValue.update({ where: { id: main.id }, data: { qtyOnHand: newQty, avgCost: newAvg, totalValue: newQty * newAvg, lastUpdated: new Date() } });
        } else {
          await tx.inventoryValue.create({ data: { itemId: l.itemId, variantSku: l.variantSku ?? "", qtyOnHand: newQty, reservedQty: 0, avgCost: newAvg, totalValue: newQty * newAvg } });
        }

        await tx.stockAdjustment.create({
          data: {
            docNumber: await generateDocNumber("ADJ", tx),
            itemId: l.itemId,
            type: "POSITIVE",
            qtyChange: l.counted,
            reason: `Van return ${docNo} ← ${canvasserLabel}`,
            prevQty,
            newQty,
            prevAvgCost: prevAvg,
            newAvgCost: newAvg,
            createdById: input.reconciledById,
            source: "VAN_RETURN",
          },
        });
      }

      // Empty the van for this row (regardless of counted).
      await tx.vanStock.update({
        where: { userId_itemId_variantSku: { userId: input.canvasserId, itemId: l.itemId, variantSku: l.variantSku ?? "" } },
        data: { qty: 0 },
      });
    }

    const rec = await tx.vanReconcile.create({
      data: {
        docNo,
        canvasserId: input.canvasserId,
        reconciledById: input.reconciledById,
        note: input.note ?? null,
        totalReturnedQty: totalReturned,
        totalVarianceQty,
        lines: {
          create: lines.map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku ?? "",
            productName: l.productName,
            expectedQty: l.expected,
            countedQty: l.counted,
            varianceQty: l.variance,
            unitCost: l.avgCost,
          })),
        },
      },
      select: { id: true },
    });

    return { ok: true, reconcileId: rec.id, docNo, totalReturned, totalVarianceQty };
  });
}
