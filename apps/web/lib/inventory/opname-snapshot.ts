import type { ItemType, OpnameScope, Prisma, StockLedgerRefType } from "@elorae/db";
import { appendStockLedger, prisma, setMainStock } from "@elorae/db";
import { findExistingInventoryValueRow } from "./costing";
import { normalizeVariantKey } from "./opname";

type Tx = Prisma.TransactionClient;

function scopeToItemType(scope: OpnameScope): ItemType {
  return scope;
}

export async function freezeItemSnapshot(
  tx: Tx,
  opnameId: string,
  scope: OpnameScope,
  itemIds?: string[],
): Promise<number> {
  const itemType = scopeToItemType(scope);
  const items = await tx.item.findMany({
    where: {
      type: itemType,
      isActive: true,
      ...(itemIds?.length ? { id: { in: itemIds } } : {}),
    },
    select: {
      id: true,
      nameId: true,
      inventoryValues: { select: { variantSku: true, qtyOnHand: true } },
    },
  });

  const rows: Prisma.StockOpnameItemCreateManyInput[] = [];
  for (const item of items) {
    const invRows = item.inventoryValues.length
      ? item.inventoryValues
      : [{ variantSku: "", qtyOnHand: 0 }];
    for (const inv of invRows) {
      rows.push({
        opnameId,
        itemId: item.id,
        variantSku: normalizeVariantKey(inv.variantSku) || null,
        itemName: item.nameId,
        snapshotQty: Number(inv.qtyOnHand),
      });
    }
  }

  if (rows.length > 0) {
    await tx.stockOpnameItem.createMany({ data: rows });
  }
  return rows.length;
}

export async function freezeFabricRollSnapshot(
  tx: Tx,
  opnameId: string,
  itemIds?: string[],
): Promise<number> {
  const rolls = await tx.fabricRoll.findMany({
    where: {
      isClosed: false,
      item: {
        type: "FABRIC",
        isActive: true,
        ...(itemIds?.length ? { id: { in: itemIds } } : {}),
      },
    },
    select: {
      id: true,
      rollCode: true,
      remainingLength: true,
      item: { select: { nameId: true } },
    },
  });

  if (rolls.length === 0) return 0;

  await tx.stockOpnameRoll.createMany({
    data: rolls.map((roll) => ({
      opnameId,
      fabricRollId: roll.id,
      rollCode: roll.rollCode,
      itemName: roll.item.nameId,
      snapshotLength: Number(roll.remainingLength),
    })),
  });
  return rolls.length;
}

export async function syncFabricAggregateQty(
  tx: Tx,
  itemId: string,
  ref: { refId: string; refDocNumber?: string },
): Promise<number> {
  const agg = await tx.fabricRoll.aggregate({
    where: { itemId, isClosed: false },
    _sum: { remainingLength: true },
  });
  const total = Number(agg._sum.remainingLength ?? 0);
  const variantKey = "";
  const existing = await findExistingInventoryValueRow(tx, itemId, variantKey);
  if (existing) {
    // A freshly counted aggregate is an absolute figure, not a delta — setMainStock is the set
    // mover. avgCost itself is not recomputed here (unchanged from before this migration), but
    // totalValue must stay consistent with the new qtyOnHand at the existing avgCost, so it is
    // recomputed and passed through in the SAME update setMainStock performs — not as a
    // follow-up write, which would reintroduce the read-then-write-twice pattern this branch
    // exists to remove. inventoryValueId pins the write to the exact row `existing` was just
    // read from.
    const avgCost = Number(existing.avgCost);
    // Unlike most other set-mover calls, this one DOES carry totalCost/balanceValue: its sibling
    // StockMovement row (applyFabricAdjustments in opname-approve.ts) carries them too, and
    // opnameNetDelta sums every OPNAME ledger row for the journal, so a null here would either
    // fail that posting or post it short for any opname with a fabric component. `delta` mirrors
    // the same qty change applyFabricAdjustments derives as `netDelta` (its own prevQty is
    // `total - netDelta`, the identical identity used here in reverse) — same null-when-no-cost
    // treatment as that sibling row's totalCost, so the two agree on the zero-cost case too.
    const delta = total - Number(existing.qtyOnHand);
    await setMainStock(tx, {
      itemId,
      variantSku: variantKey,
      nextQty: total,
      totalValue: total * avgCost,
      totalCost: avgCost ? delta * avgCost : null,
      balanceValue: total * avgCost,
      inventoryValueId: existing.id,
      refType: "StockOpname" satisfies StockLedgerRefType,
      refId: ref.refId,
      refDocNumber: ref.refDocNumber,
    });
  } else if (total > 0) {
    await tx.inventoryValue.create({
      data: {
        itemId,
        variantSku: variantKey,
        qtyOnHand: total,
        avgCost: 0,
        totalValue: 0,
      },
    });

    // A freshly created row at the snapshot total has no prior balance to move from — it is a
    // row-provisioning event, not a movement, so it is appended directly rather than through
    // setMainStock (which throws when no row exists).
    await appendStockLedger(tx, {
      location: { type: "MAIN" },
      itemId,
      variantSku: variantKey,
      type: "OPENING",
      qty: total,
      balanceQty: total,
      refType: "StockOpname" satisfies StockLedgerRefType,
      refId: ref.refId,
      refDocNumber: ref.refDocNumber,
    });
  }
  return total;
}

export async function getOpenFabricItemIds(itemIds?: string[]): Promise<string[]> {
  const rolls = await prisma.fabricRoll.findMany({
    where: {
      isClosed: false,
      item: {
        type: "FABRIC",
        isActive: true,
        ...(itemIds?.length ? { id: { in: itemIds } } : {}),
      },
    },
    select: { itemId: true },
    distinct: ["itemId"],
  });
  return rolls.map((r) => r.itemId);
}
