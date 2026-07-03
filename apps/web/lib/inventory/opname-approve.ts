import type { Prisma, StockAdjustmentSource } from "@elorae/db";
import { prisma } from "@elorae/db";
import { Decimal } from "decimal.js";
import { generateDocNumber } from "@/lib/docNumber";
import { apiFetch } from "@/lib/internal-api";
import {
  hasQtyDrift,
  normalizeVariantKey,
  shouldApplyAdjustment,
} from "./opname";
import { syncFabricAggregateQty } from "./opname-snapshot";

type Tx = Prisma.TransactionClient;

export type DriftRow = {
  opnameItemId?: string;
  opnameRollId?: string;
  label: string;
  snapshotQty: number;
  currentQty: number;
  kind: "item" | "roll";
};

function toNum(v: unknown): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : Number(v);
}

export async function detectItemDrift(
  tx: Tx,
  opnameId: string,
): Promise<DriftRow[]> {
  const items = await tx.stockOpnameItem.findMany({ where: { opnameId } });
  const drift: DriftRow[] = [];
  for (const row of items) {
    const variantKey = normalizeVariantKey(row.variantSku);
    const inv = await tx.inventoryValue.findUnique({
      where: { itemId_variantSku: { itemId: row.itemId, variantSku: variantKey } },
    });
    const currentQty = inv ? toNum(inv.qtyOnHand) : 0;
    const snapshotQty = toNum(row.snapshotQty);
    if (hasQtyDrift(currentQty, snapshotQty)) {
      drift.push({
        opnameItemId: row.id,
        label: row.itemName,
        snapshotQty,
        currentQty,
        kind: "item",
      });
    }
  }
  return drift;
}

export async function detectRollDrift(
  tx: Tx,
  opnameId: string,
): Promise<DriftRow[]> {
  const rolls = await tx.stockOpnameRoll.findMany({ where: { opnameId } });
  const drift: DriftRow[] = [];
  for (const row of rolls) {
    const fabricRoll = await tx.fabricRoll.findUnique({
      where: { id: row.fabricRollId },
      select: { remainingLength: true },
    });
    const currentQty = fabricRoll ? toNum(fabricRoll.remainingLength) : 0;
    const snapshotQty = toNum(row.snapshotLength);
    if (hasQtyDrift(currentQty, snapshotQty)) {
      drift.push({
        opnameRollId: row.id,
        label: `${row.itemName} / ${row.rollCode}`,
        snapshotQty,
        currentQty,
        kind: "roll",
      });
    }
  }
  return drift;
}

async function tryOpnameJournal(
  opnameId: string,
  lines: Array<{ accountCode: string; debit: number; credit: number }>,
): Promise<void> {
  try {
    const mod = await import("@/lib/finance/journal");
    await mod.generateAutoJournal("OPNAME", opnameId, lines);
  } catch {
    // accounting not built — no-op
  }
}

async function enqueueStockPush(itemId: string, userId: string): Promise<void> {
  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: "stock_push",
      entityId: itemId,
      payload: {},
      enqueuedById: userId,
    },
    select: { id: true },
  });
  void apiFetch("POST", `/jubelio/outbox/enqueue/${row.id}`, { userId }).catch(() => {});
}

export async function applyFgAccessoriesAdjustments(
  tx: Tx,
  opnameId: string,
  docNumber: string,
  userId: string,
  scope: "FINISHED_GOOD" | "ACCESSORIES",
): Promise<{ adjustmentCount: number; pushItemIds: string[] }> {
  const items = await tx.stockOpnameItem.findMany({ where: { opnameId } });
  let adjustmentCount = 0;
  const pushItemIds: string[] = [];
  const journalLines: Array<{ accountCode: string; debit: number; credit: number }> = [];

  for (const row of items) {
    const countedQty = toNum(row.countedQty);
    const variantKey = normalizeVariantKey(row.variantSku);
    const inv = await tx.inventoryValue.findUnique({
      where: { itemId_variantSku: { itemId: row.itemId, variantSku: variantKey } },
    });
    const currentQty = inv ? toNum(inv.qtyOnHand) : 0;
    const snapshotQty = toNum(row.snapshotQty);
    const hadDrift = hasQtyDrift(currentQty, snapshotQty);

    await tx.stockOpnameItem.update({
      where: { id: row.id },
      data: {
        currentQtyAtApproval: currentQty,
        hadDriftWarning: hadDrift,
      },
    });

    if (!shouldApplyAdjustment(countedQty, currentQty) || !inv) continue;

    const prevQty = new Decimal(currentQty);
    const newQty = new Decimal(countedQty);
    const prevAvgCost = new Decimal(toNum(inv.avgCost));
    const qtyChange = newQty.minus(prevQty).abs();
    const type = newQty.gte(prevQty) ? "POSITIVE" : "NEGATIVE";
    const idempotencyKey = `opname:${opnameId}:${row.id}`;

    const existing = await tx.stockAdjustment.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      await tx.stockOpnameItem.update({
        where: { id: row.id },
        data: { adjustmentId: existing.id },
      });
      continue;
    }

    const adjDoc = await generateDocNumber("ADJ", tx);
    const adjustment = await tx.stockAdjustment.create({
      data: {
        docNumber: adjDoc,
        itemId: row.itemId,
        type,
        qtyChange: qtyChange.toNumber(),
        reason: `Stock opname ${docNumber}`,
        prevQty: prevQty.toNumber(),
        newQty: newQty.toNumber(),
        prevAvgCost: prevAvgCost.toNumber(),
        newAvgCost: prevAvgCost.toNumber(),
        approvedById: userId,
        createdById: userId,
        source: "ERP_OPNAME" satisfies StockAdjustmentSource,
        idempotencyKey,
        externalRef: opnameId,
      },
    });

    const newTotalValue = newQty.mul(prevAvgCost);
    await tx.inventoryValue.update({
      where: { id: inv.id },
      data: {
        qtyOnHand: newQty.toNumber(),
        totalValue: newTotalValue.toNumber(),
        lastUpdated: new Date(),
      },
    });

    const adjQty = type === "POSITIVE" ? qtyChange.toNumber() : -qtyChange.toNumber();
    const totalCostAdj =
      type === "POSITIVE"
        ? qtyChange.mul(prevAvgCost).toNumber()
        : qtyChange.mul(prevAvgCost).neg().toNumber();

    await tx.stockMovement.create({
      data: {
        itemId: row.itemId,
        variantSku: variantKey,
        type: "ADJUSTMENT",
        refType: "OPNAME",
        refId: opnameId,
        refDocNumber: docNumber,
        qty: adjQty,
        unitCost: prevAvgCost.toNumber(),
        totalCost: totalCostAdj,
        balanceQty: newQty.toNumber(),
        balanceValue: newTotalValue.toNumber(),
        notes: `Opname adjustment: ${docNumber}`,
      },
    });

    await tx.stockOpnameItem.update({
      where: { id: row.id },
      data: { adjustmentId: adjustment.id },
    });

    adjustmentCount += 1;
    journalLines.push({ accountCode: "6201", debit: Math.abs(totalCostAdj), credit: 0 });

    if (scope === "FINISHED_GOOD") {
      const mapping = await tx.jubelioProductMapping.findFirst({
        where: { itemId: row.itemId },
        select: { id: true },
      });
      if (mapping) pushItemIds.push(row.itemId);
    }
  }

  if (journalLines.length > 0) {
    await tryOpnameJournal(opnameId, journalLines);
  }

  return { adjustmentCount, pushItemIds };
}

export async function applyFabricAdjustments(
  tx: Tx,
  opnameId: string,
  docNumber: string,
): Promise<{ adjustmentCount: number }> {
  const rolls = await tx.stockOpnameRoll.findMany({ where: { opnameId } });
  const itemDeltas = new Map<string, number>();
  let adjustmentCount = 0;

  for (const row of rolls) {
    const countedLength = toNum(row.countedLength);
    const fabricRoll = await tx.fabricRoll.findUnique({
      where: { id: row.fabricRollId },
      select: { remainingLength: true, itemId: true, isClosed: true },
    });
    if (!fabricRoll) continue;

    const currentLength = toNum(fabricRoll.remainingLength);
    const snapshotLength = toNum(row.snapshotLength);
    if (!shouldApplyAdjustment(countedLength, currentLength)) continue;

    await tx.fabricRoll.update({
      where: { id: row.fabricRollId },
      data: {
        remainingLength: countedLength,
        isClosed: countedLength <= 0 ? true : fabricRoll.isClosed,
      },
    });

    const delta = countedLength - currentLength;
    itemDeltas.set(fabricRoll.itemId, (itemDeltas.get(fabricRoll.itemId) ?? 0) + delta);
    adjustmentCount += 1;

    if (hasQtyDrift(currentLength, snapshotLength)) {
      // drift recorded implicitly via roll update
    }
  }

  for (const [itemId, netDelta] of itemDeltas) {
    const newAggregate = await syncFabricAggregateQty(tx, itemId);
    const inv = await tx.inventoryValue.findFirst({
      where: { itemId, OR: [{ variantSku: "" }, { variantSku: null }] },
    });
    const prevQty = inv ? toNum(inv.qtyOnHand) - netDelta : newAggregate - netDelta;
    const avgCost = inv ? toNum(inv.avgCost) : 0;

    await tx.stockMovement.create({
      data: {
        itemId,
        variantSku: "",
        type: "ADJUSTMENT",
        refType: "OPNAME",
        refId: opnameId,
        refDocNumber: docNumber,
        qty: netDelta,
        unitCost: avgCost || null,
        totalCost: avgCost ? netDelta * avgCost : null,
        balanceQty: newAggregate,
        balanceValue: newAggregate * avgCost,
        notes: `Fabric opname aggregate: ${docNumber}`,
      },
    });
  }

  return { adjustmentCount };
}

export async function pushFgStockAfterOpname(
  itemIds: string[],
  userId: string,
): Promise<void> {
  for (const itemId of [...new Set(itemIds)]) {
    try {
      await enqueueStockPush(itemId, userId);
    } catch {
      // local adjustment stands; outbox poller may retry on next manual push
    }
  }
}
