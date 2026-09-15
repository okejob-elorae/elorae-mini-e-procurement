import { moveMainStock, moveVanStock } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { variantDetailForSku } from "@/lib/items/variants";
import { weightedAvgCost } from "@/lib/inventory/weighted-avg-cost";
import { findExistingInventoryValueRow } from "@/lib/inventory/costing";

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

    const totalReturned = lines.reduce((s, l) => s + l.counted, 0);
    const totalVarianceQty = lines.reduce((s, l) => s + l.variance, 0);

    // Created ahead of the loop so its id is a real refId for the ledger entries below, not the
    // doc number. The line rows are appended via createMany once the loop finishes.
    const rec = await tx.vanReconcile.create({
      data: {
        docNo,
        canvasserId: input.canvasserId,
        reconciledById: input.reconciledById,
        note: input.note ?? null,
        totalReturnedQty: totalReturned,
        totalVarianceQty,
      },
      select: { id: true },
    });

    for (const l of lines) {
      if (l.counted > 0) {
        /*
         * Return to main through findExistingInventoryValueRow, THE spelling of this lookup: a
         * variantless main row keys on null OR "", and calculateMovingAverage's strict ""-key
         * lookup would miss a real null row and fork a phantom one. Its orderBy id asc tie-break
         * is load-bearing rather than cosmetic — the resolved id is pinned into moveMainStock
         * below, so without it two paths reading the same null/"" bucket can pin different rows
         * and interleave two independent balances under one ledger key.
         */
        const main = await findExistingInventoryValueRow(tx, l.itemId, l.variantSku);

        const prevQty = main ? main.qtyOnHand.toNumber() : 0;
        const prevAvg = main ? main.avgCost.toNumber() : 0;
        const newQty = prevQty + l.counted;
        const newAvg = weightedAvgCost(prevQty, prevAvg, l.counted, l.avgCost);

        /*
         * createIfMissing mirrors the create-branch this replaced. inventoryValueId pins the
         * write to the exact row `main` was just read from when one exists — a genuinely missing
         * row opens one at newAvg via moveMainStock's own create, spelled null for variantless
         * (the mover's convention) rather than this branch's former "" spelling.
         */
        await moveMainStock(tx, {
          itemId: l.itemId,
          variantSku: l.variantSku,
          qtyDelta: l.counted,
          avgCost: newAvg,
          totalValue: newQty * newAvg,
          createIfMissing: true,
          inventoryValueId: main?.id,
          refType: "VanReconcile",
          refId: rec.id,
          refDocNumber: docNo,
          createdById: input.reconciledById,
        });

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

      // Empty the van for this row (regardless of counted) — a delta to zero, never a set; the
      // spec is explicit that emptying the van is a delta, not an absolute set mover.
      await moveVanStock(tx, {
        userId: input.canvasserId,
        itemId: l.itemId,
        variantSku: l.variantSku,
        qtyDelta: -l.expected,
        refType: "VanReconcile",
        refId: rec.id,
        refDocNumber: docNo,
      });
    }

    await tx.vanReconcileLine.createMany({
      data: lines.map((l) => ({
        vanReconcileId: rec.id,
        itemId: l.itemId,
        variantSku: l.variantSku ?? "",
        productName: l.productName,
        expectedQty: l.expected,
        countedQty: l.counted,
        varianceQty: l.variance,
        unitCost: l.avgCost,
      })),
    });

    return { ok: true, reconcileId: rec.id, docNo, totalReturned, totalVarianceQty };
  });
}
