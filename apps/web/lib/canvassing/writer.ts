import { prisma, Prisma, moveMainStock, moveVanStock } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { weightedAvgCost } from "@/lib/inventory/weighted-avg-cost";
import { findExistingInventoryValueRow } from "@/lib/inventory/costing";

export type LoadVanLine = { itemId: string; variantSku: string | null; qty: number };
export type LoadVanResult =
  | { ok: true; loadId: string; docNo: string }
  | { ok: false; code: "EMPTY" }
  | { ok: false; code: "INSUFFICIENT_STOCK"; shortLines: Array<{ itemId: string; variantSku: string | null; requested: number; available: number }> };

function mergeLines(lines: LoadVanLine[]): LoadVanLine[] {
  const map = new Map<string, LoadVanLine>();
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const key = `${l.itemId}::${l.variantSku ?? ""}`;
    const existing = map.get(key);
    if (existing) existing.qty += l.qty;
    else map.set(key, { itemId: l.itemId, variantSku: l.variantSku, qty: l.qty });
  }
  return Array.from(map.values());
}

export async function loadVan(input: {
  canvasserId: string;
  loadedById: string;
  lines: LoadVanLine[];
  note?: string;
}): Promise<LoadVanResult> {
  const merged = mergeLines(input.lines);
  if (merged.length === 0) return { ok: false, code: "EMPTY" };

  return runSerializable(async (tx) => {
    // read current main inventory for each line
    const invByKey = new Map<string, { id: string; qtyOnHand: Prisma.Decimal; reservedQty: Prisma.Decimal; avgCost: Prisma.Decimal } | null>();
    for (const l of merged) {
      /*
       * findExistingInventoryValueRow is THE spelling of this lookup — OR-tolerant on a falsy
       * variantSku AND carrying the orderBy id asc tie-break. The tie-break is load-bearing here,
       * not cosmetic: the id resolved below is pinned into moveMainStock as inventoryValueId, so
       * without it two paths reading the same null/"" bucket can pin different rows and interleave
       * two independent balances under one ledger key.
       */
      const inv = await findExistingInventoryValueRow(tx, l.itemId, l.variantSku);
      invByKey.set(`${l.itemId}::${l.variantSku ?? ""}`, inv);
    }

    const shortLines: Array<{ itemId: string; variantSku: string | null; requested: number; available: number }> = [];
    for (const l of merged) {
      const inv = invByKey.get(`${l.itemId}::${l.variantSku ?? ""}`);
      const available = inv ? inv.qtyOnHand.toNumber() - inv.reservedQty.toNumber() : 0;
      if (l.qty > available) shortLines.push({ itemId: l.itemId, variantSku: l.variantSku, requested: l.qty, available });
    }
    if (shortLines.length > 0) return { ok: false, code: "INSUFFICIENT_STOCK", shortLines };

    const canvasser = await tx.user.findUnique({ where: { id: input.canvasserId }, select: { name: true, email: true } });
    const canvasserLabel = canvasser?.name ?? canvasser?.email ?? input.canvasserId;
    const docNo = await generateDocNumber("VANLOAD", tx);

    // Created ahead of the loop so its id is a real refId for the ledger entries below, not the
    // doc number. The line rows are appended via createMany once the loop has the per-line costs.
    const load = await tx.vanLoad.create({
      data: {
        docNo,
        canvasserId: input.canvasserId,
        loadedById: input.loadedById,
        note: input.note,
      },
      select: { id: true },
    });

    const lineData: Array<{ vanLoadId: string; itemId: string; variantSku: string; qty: number; unitCost: number }> = [];

    for (const l of merged) {
      const inv = invByKey.get(`${l.itemId}::${l.variantSku ?? ""}`)!;
      const prevQty = inv.qtyOnHand.toNumber();
      const avgCost = inv.avgCost.toNumber();
      const newQty = prevQty - l.qty;

      await moveMainStock(tx, {
        itemId: l.itemId,
        variantSku: l.variantSku,
        qtyDelta: -l.qty,
        totalValue: newQty * avgCost,
        inventoryValueId: inv.id,
        refType: "VanLoad",
        refId: load.id,
        refDocNumber: docNo,
        createdById: input.loadedById,
      });

      await tx.stockAdjustment.create({
        data: {
          docNumber: await generateDocNumber("ADJ", tx),
          itemId: l.itemId,
          type: "NEGATIVE",
          qtyChange: -l.qty,
          reason: `Van load ${docNo} → ${canvasserLabel}`,
          prevQty,
          newQty,
          prevAvgCost: avgCost,
          newAvgCost: avgCost,
          createdById: input.loadedById,
          source: "VAN_LOAD",
        },
      });

      // Coerce variantless to "" (not null) to match the InventoryValue convention
      // so the @@unique([userId, itemId, variantSku]) is DB-enforced (MySQL treats NULLs as distinct).
      const vanVariantSku = l.variantSku ?? "";
      const van = await tx.vanStock.findUnique({
        where: { userId_itemId_variantSku: { userId: input.canvasserId, itemId: l.itemId, variantSku: vanVariantSku } },
        select: { qty: true, avgCost: true },
      });
      const prevVanQty = van ? van.qty.toNumber() : 0;
      const prevVanAvg = van ? van.avgCost.toNumber() : 0;
      const newVanAvg = weightedAvgCost(prevVanQty, prevVanAvg, l.qty, avgCost);
      await moveVanStock(tx, {
        userId: input.canvasserId,
        itemId: l.itemId,
        variantSku: l.variantSku,
        qtyDelta: l.qty,
        avgCost: newVanAvg,
        refType: "VanLoad",
        refId: load.id,
        refDocNumber: docNo,
        createdById: input.loadedById,
      });

      lineData.push({ vanLoadId: load.id, itemId: l.itemId, variantSku: vanVariantSku, qty: l.qty, unitCost: avgCost });
    }

    await tx.vanLoadLine.createMany({ data: lineData });

    return { ok: true, loadId: load.id, docNo };
  });
}
