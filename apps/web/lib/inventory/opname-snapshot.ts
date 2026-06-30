import type { ItemType, OpnameScope, Prisma } from "@elorae/db";
import { prisma } from "@elorae/db";
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
): Promise<number> {
  const agg = await tx.fabricRoll.aggregate({
    where: { itemId, isClosed: false },
    _sum: { remainingLength: true },
  });
  const total = Number(agg._sum.remainingLength ?? 0);
  const variantKey = "";
  const existing = await tx.inventoryValue.findUnique({
    where: { itemId_variantSku: { itemId, variantSku: variantKey } },
  });
  if (existing) {
    const avgCost = Number(existing.avgCost);
    await tx.inventoryValue.update({
      where: { id: existing.id },
      data: {
        qtyOnHand: total,
        totalValue: total * avgCost,
        lastUpdated: new Date(),
      },
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
