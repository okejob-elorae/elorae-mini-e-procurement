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
    // Unlike most other set-mover calls, this one DOES carry totalCost/balanceValue:
    // opnameNetDelta sums every OPNAME ledger row for the journal, treating a null totalCost as a
    // hard error — null means "this predates the value columns", not "this item is uncosted".
    // `delta` mirrors the same qty change applyFabricAdjustments (opname-approve.ts) accumulates
    // per item as `netDelta` (its own prevQty is `total - netDelta`, the identical identity used
    // here in reverse).
    //
    // No avgCost-guard here: null and 0 mean different things in this column. Null means "we
    // don't know what this was worth" (true of every pre-migration row, since the moving average
    // at that instant was never recorded); 0 means "this was worth nothing", which is exactly
    // true for a fabric item whose avgCost is 0 (never costed through a GRN) — a known zero, not
    // an unknown. Stamping null here would make every opname on an as-yet-uncosted fabric item
    // refuse to post. `delta * avgCost` already evaluates to 0 when avgCost is 0, so the plain
    // expression is both simpler and more truthful than a guarded one.
    const delta = total - Number(existing.qtyOnHand);
    await setMainStock(tx, {
      itemId,
      variantSku: variantKey,
      nextQty: total,
      totalValue: total * avgCost,
      totalCost: delta * avgCost,
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
    //
    // totalCost/balanceValue are stamped as an explicit 0, not omitted: the row above is created
    // at avgCost: 0, so 0 is the correct recorded value for a never-before-costed item — a known
    // zero, not an unknown. Leaving them undefined would store null, which this column reserves
    // for "we don't know", and opnameNetDelta treats a null totalCost as a hard error.
    await appendStockLedger(tx, {
      location: { type: "MAIN" },
      itemId,
      variantSku: variantKey,
      type: "OPENING",
      qty: total,
      balanceQty: total,
      totalCost: 0,
      balanceValue: 0,
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
