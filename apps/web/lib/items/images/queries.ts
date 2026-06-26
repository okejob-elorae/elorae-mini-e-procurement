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
