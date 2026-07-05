import { prisma, Prisma } from "@elorae/db";
import type { PromoInput } from "@elorae/db/promo";

const toNum = (v: Prisma.Decimal | number | null): number | null => (v === null ? null : Number(v));

export async function fetchActivePromosForStore(
  storeId: string,
  now: Date,
  tx: { promo: typeof prisma.promo } = prisma,
): Promise<PromoInput[]> {
  const rows = await tx.promo.findMany({
    where: {
      isActive: true,
      termsType: "PUTUS",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        { OR: [{ allStores: true }, { stores: { some: { storeId } } }] },
      ],
    },
    include: { items: { select: { itemId: true } }, tiers: { select: { minQty: true, unitPrice: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    type: p.type as PromoInput["type"],
    level: p.level as PromoInput["level"],
    value: toNum(p.value),
    minQty: p.minQty,
    minOrderSubtotal: toNum(p.minOrderSubtotal),
    minOrderQty: p.minOrderQty,
    priority: p.priority,
    itemIds: p.items.map((i) => i.itemId),
    tiers: p.tiers.map((t) => ({ minQty: t.minQty, unitPrice: Number(t.unitPrice) })),
  }));
}

export type PromoListItem = { id: string; name: string; type: string; level: string; isActive: boolean; startsAt: Date | null; endsAt: Date | null };
export type PromoDetail = PromoListItem & {
  value: number | null; minQty: number | null; minOrderSubtotal: number | null; minOrderQty: number | null;
  allStores: boolean; priority: number; itemIds: string[]; storeIds: string[]; tiers: Array<{ minQty: number; unitPrice: number }>;
};

export async function listPromos(
  filter: { type?: string; active?: boolean },
  paging: { page: number; pageSize: number },
): Promise<{ promos: PromoListItem[]; totalCount: number }> {
  const where: Prisma.PromoWhereInput = {};
  if (filter.type === "PERCENT" || filter.type === "FIXED" || filter.type === "TIERED") where.type = filter.type;
  if (typeof filter.active === "boolean") where.isActive = filter.active;
  const [rows, totalCount] = await Promise.all([
    prisma.promo.findMany({ where, orderBy: { createdAt: "desc" }, skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize,
      select: { id: true, name: true, type: true, level: true, isActive: true, startsAt: true, endsAt: true } }),
    prisma.promo.count({ where }),
  ]);
  return { promos: rows, totalCount };
}

export async function getPromoById(id: string): Promise<PromoDetail | null> {
  const p = await prisma.promo.findUnique({
    where: { id },
    include: { items: { select: { itemId: true } }, stores: { select: { storeId: true } }, tiers: { select: { minQty: true, unitPrice: true } } },
  });
  if (!p) return null;
  return {
    id: p.id, name: p.name, type: p.type, level: p.level, isActive: p.isActive, startsAt: p.startsAt, endsAt: p.endsAt,
    value: toNum(p.value), minQty: p.minQty, minOrderSubtotal: toNum(p.minOrderSubtotal), minOrderQty: p.minOrderQty,
    allStores: p.allStores, priority: p.priority,
    itemIds: p.items.map((i) => i.itemId), storeIds: p.stores.map((s) => s.storeId),
    tiers: p.tiers.map((t) => ({ minQty: t.minQty, unitPrice: Number(t.unitPrice) })),
  };
}
