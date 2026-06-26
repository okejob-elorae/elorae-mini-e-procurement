import { prisma } from "@elorae/db";
import type { ItemImageDto, ItemImageSource } from "./types";

export async function getItemImages(itemId: string): Promise<ItemImageDto[]> {
  const rows = await prisma.itemImage.findMany({
    where: { itemId },
    orderBy: [{ variantSku: "asc" }, { sortOrder: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    variantSku: r.variantSku,
    url: r.url,
    sortOrder: r.sortOrder,
    jubelioImageId: r.jubelioImageId,
    syncedAt: r.syncedAt,
    source: r.source as ItemImageSource,
  }));
}

export async function getPrimaryImage(
  itemId: string,
  variantSku: string | null,
): Promise<string | null> {
  if (variantSku) {
    const v = await prisma.itemImage.findFirst({
      where: { itemId, variantSku },
      orderBy: { sortOrder: "asc" },
      select: { url: true },
    });
    if (v) return v.url;
  }
  const p = await prisma.itemImage.findFirst({
    where: { itemId, variantSku: null },
    orderBy: { sortOrder: "asc" },
    select: { url: true },
  });
  return p?.url ?? null;
}

export async function getPrimaryImagesBatch(
  pairs: Array<{ itemId: string; variantSku: string | null }>,
): Promise<Map<string, string>> {
  if (pairs.length === 0) return new Map();
  const ids = Array.from(new Set(pairs.map((p) => p.itemId)));
  const rows = await prisma.itemImage.findMany({
    where: { itemId: { in: ids } },
    orderBy: { sortOrder: "asc" },
    select: { itemId: true, variantSku: true, url: true },
  });
  const key = (itemId: string, variantSku: string | null) =>
    `${itemId}|${variantSku ?? ""}`;
  const byKey = new Map<string, string>();
  for (const r of rows) {
    const k = key(r.itemId, r.variantSku);
    if (!byKey.has(k)) byKey.set(k, r.url);
  }
  const out = new Map<string, string>();
  for (const p of pairs) {
    const specific = byKey.get(key(p.itemId, p.variantSku));
    const productLevel = byKey.get(key(p.itemId, null));
    const url = specific ?? productLevel;
    if (url) out.set(key(p.itemId, p.variantSku), url);
  }
  return out;
}
