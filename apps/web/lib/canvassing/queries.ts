import { prisma } from "@elorae/db";
import { variantDetailForSku } from "@/lib/items/variants";

export type CanvasserSummary = { id: string; name: string; email: string; lineCount: number; totalQty: number };
export type VanStockRow = { itemId: string; sku: string; productName: string; variantSku: string | null; variantLabel: string | null; qty: number; avgCost: number };
export type LoadableInventoryRow = { itemId: string; variantSku: string | null; available: number };
export type VanLoadRow = { id: string; docNo: string; loadedByLabel: string; createdAtIso: string; lineCount: number };

export async function listCanvassers(): Promise<CanvasserSummary[]> {
  const users = await prisma.user.findMany({
    where: { roleDefinition: { permissions: { some: { permission: { code: "pwa:access" } } } } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  const summaries = await Promise.all(users.map(async (u) => {
    const rows = await prisma.vanStock.findMany({ where: { userId: u.id, qty: { gt: 0 } }, select: { qty: true } });
    return {
      id: u.id,
      name: u.name ?? u.email,
      email: u.email,
      lineCount: rows.length,
      totalQty: rows.reduce((s, r) => s + r.qty.toNumber(), 0),
    };
  }));
  return summaries;
}

export async function getVanStock(canvasserId: string): Promise<VanStockRow[]> {
  const rows = await prisma.vanStock.findMany({
    where: { userId: canvasserId, qty: { gt: 0 } },
    include: { item: { select: { sku: true, nameId: true, variants: true } } },
    orderBy: { item: { nameId: "asc" } },
  });
  return rows.map((r) => ({
    itemId: r.itemId,
    sku: r.item.sku,
    productName: r.item.nameId,
    variantSku: r.variantSku,
    variantLabel: variantDetailForSku(r.item.variants, r.variantSku),
    qty: r.qty.toNumber(),
    avgCost: r.avgCost.toNumber(),
  }));
}

export async function getLoadableInventory(itemIds: string[]): Promise<LoadableInventoryRow[]> {
  if (itemIds.length === 0) return [];
  const rows = await prisma.inventoryValue.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true },
  });
  return rows.map((r) => ({
    itemId: r.itemId,
    variantSku: r.variantSku,
    available: r.qtyOnHand.toNumber() - r.reservedQty.toNumber(),
  }));
}

export type VanLoadDetail = {
  docNo: string;
  createdAtIso: string;
  canvasserLabel: string;
  loadedByLabel: string;
  lines: Array<{ productName: string; variantSku: string | null; variantLabel: string | null; qty: number }>;
};

export async function getVanLoadById(id: string): Promise<VanLoadDetail | null> {
  const load = await prisma.vanLoad.findUnique({
    where: { id },
    include: {
      canvasser: { select: { name: true, email: true } },
      loadedBy: { select: { name: true, email: true } },
      lines: { include: { item: { select: { nameId: true, variants: true } } } },
    },
  });
  if (!load) return null;
  return {
    docNo: load.docNo,
    createdAtIso: load.createdAt.toISOString(),
    canvasserLabel: load.canvasser.name ?? load.canvasser.email,
    loadedByLabel: load.loadedBy.name ?? load.loadedBy.email,
    lines: load.lines.map((l) => ({
      productName: l.item.nameId,
      variantSku: l.variantSku,
      variantLabel: variantDetailForSku(l.item.variants, l.variantSku),
      qty: l.qty.toNumber(),
    })),
  };
}

export async function listVanLoads(canvasserId: string, limit: number): Promise<VanLoadRow[]> {
  const rows = await prisma.vanLoad.findMany({
    where: { canvasserId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { loadedBy: { select: { name: true, email: true } }, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo,
    loadedByLabel: r.loadedBy.name ?? r.loadedBy.email,
    createdAtIso: r.createdAt.toISOString(),
    lineCount: r._count.lines,
  }));
}
