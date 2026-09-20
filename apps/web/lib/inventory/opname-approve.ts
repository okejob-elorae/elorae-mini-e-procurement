import type { Prisma, StockAdjustmentSource, StockLedgerRefType } from "@elorae/db";
import { prisma, setMainStock } from "@elorae/db";
import { Decimal } from "decimal.js";
import { generateDocNumber } from "@/lib/docNumber";
import { apiFetch } from "@/lib/internal-api";
import {
  hasQtyDrift,
  normalizeVariantKey,
  shouldApplyAdjustment,
} from "./opname";
import { findExistingInventoryValueRow } from "./costing";
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
    const inv = await findExistingInventoryValueRow(tx, row.itemId, variantKey);
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

  for (const row of items) {
    const countedQty = toNum(row.countedQty);
    const variantKey = normalizeVariantKey(row.variantSku);
    const inv = await findExistingInventoryValueRow(tx, row.itemId, variantKey);
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
    const adjQty = type === "POSITIVE" ? qtyChange.toNumber() : -qtyChange.toNumber();

    // Same expression the stockMovement.create below stamps as totalCost — computed here so the
    // ledger entry and the movement row carry the identical figure. This is the figure the
    // opname journal reads to post the inventory-variance GL entry, so it must equal the
    // StockMovement row's totalCost by construction, not by a later reconciliation.
    const totalCostAdj =
      type === "POSITIVE"
        ? qtyChange.mul(prevAvgCost).toNumber()
        : qtyChange.mul(prevAvgCost).neg().toNumber();

    /*
     * setMainStock, not moveMainStock: an opname line is an absolute physical count, and the
     * counted figure is what must land. Routed as a delta the row ends at prevActual + adjQty —
     * which is NOT countedQty if anything moved between the read above and the write — while the
     * StockAdjustment row created just above records newQty: countedQty, so the two disagree with
     * nothing to reconcile them. The ledger type is wrong the same way: ledgerTypeForDelta types a
     * count IN or OUT, where every other count in this system writes ADJUSTMENT, and the ledger is
     * append-only so that spelling would be permanent.
     */
    await setMainStock(tx, {
      itemId: row.itemId,
      variantSku: variantKey,
      nextQty: newQty.toNumber(),
      totalValue: newTotalValue.toNumber(),
      unitCost: prevAvgCost.toNumber(),
      totalCost: totalCostAdj,
      balanceValue: newTotalValue.toNumber(),
      inventoryValueId: inv.id,
      refType: "StockOpname" satisfies StockLedgerRefType,
      refId: opnameId,
      refDocNumber: docNumber,
      createdById: userId,
    });

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

    if (scope === "FINISHED_GOOD") {
      const mapping = await tx.jubelioProductMapping.findFirst({
        where: { itemId: row.itemId },
        select: { id: true },
      });
      if (mapping) pushItemIds.push(row.itemId);
    }
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
    const newAggregate = await syncFabricAggregateQty(tx, itemId, {
      refId: opnameId,
      refDocNumber: docNumber,
    });
    /*
     * Same helper syncFabricAggregateQty just resolved and wrote through, tie-break included.
     * This re-resolve used to hand-roll the OR without the orderBy, so on an item carrying both a
     * null-spelled and a ""-spelled row it could read a DIFFERENT row than the one the line above
     * had just set — and the StockMovement.balanceQty below is derived from what comes back here.
     */
    const inv = await findExistingInventoryValueRow(tx, itemId, "");
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
