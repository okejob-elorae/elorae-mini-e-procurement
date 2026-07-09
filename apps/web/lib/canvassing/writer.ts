import { prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { weightedAvgCost } from "./cost";

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
    const invByKey = new Map<string, { qtyOnHand: Prisma.Decimal; reservedQty: Prisma.Decimal; avgCost: Prisma.Decimal } | null>();
    for (const l of merged) {
      const inv = await tx.inventoryValue.findUnique({
        where: { itemId_variantSku: { itemId: l.itemId, variantSku: l.variantSku ?? "" } },
        select: { qtyOnHand: true, reservedQty: true, avgCost: true },
      });
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

    for (const l of merged) {
      const inv = invByKey.get(`${l.itemId}::${l.variantSku ?? ""}`)!;
      const prevQty = inv.qtyOnHand.toNumber();
      const avgCost = inv.avgCost.toNumber();
      const newQty = prevQty - l.qty;

      await tx.inventoryValue.update({
        where: { itemId_variantSku: { itemId: l.itemId, variantSku: l.variantSku ?? "" } },
        data: { qtyOnHand: newQty, totalValue: newQty * avgCost },
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
      await tx.vanStock.upsert({
        where: { userId_itemId_variantSku: { userId: input.canvasserId, itemId: l.itemId, variantSku: vanVariantSku } },
        create: { userId: input.canvasserId, itemId: l.itemId, variantSku: vanVariantSku, qty: l.qty, avgCost: avgCost },
        update: { qty: prevVanQty + l.qty, avgCost: newVanAvg },
      });
    }

    const load = await tx.vanLoad.create({
      data: {
        docNo,
        canvasserId: input.canvasserId,
        loadedById: input.loadedById,
        note: input.note,
        lines: {
          create: merged.map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku ?? "",
            qty: l.qty,
            unitCost: invByKey.get(`${l.itemId}::${l.variantSku ?? ""}`)!.avgCost.toNumber(),
          })),
        },
      },
      select: { id: true },
    });

    return { ok: true, loadId: load.id, docNo };
  });
}
