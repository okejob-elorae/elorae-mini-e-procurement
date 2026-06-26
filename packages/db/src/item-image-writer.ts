import type { Prisma, PrismaClient } from "../generated/prisma/client";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export type UpsertJubelioImageInput = {
  itemId: string;
  variantSku: string | null;
  url: string;
  sortOrder: number;
  jubelioImageId: string;
};

export async function upsertJubelioImage(
  client: AnyClient,
  input: UpsertJubelioImageInput,
): Promise<{ id: string; action: "inserted" | "updated" }> {
  const now = new Date();
  const existing = await client.itemImage.findUnique({
    where: { jubelioImageId: input.jubelioImageId },
    select: { id: true },
  });
  if (existing) {
    await client.itemImage.update({
      where: { id: existing.id },
      data: {
        itemId: input.itemId,
        variantSku: input.variantSku,
        url: input.url,
        sortOrder: input.sortOrder,
        syncedAt: now,
      },
    });
    return { id: existing.id, action: "updated" };
  }
  const created = await client.itemImage.create({
    data: {
      itemId: input.itemId,
      variantSku: input.variantSku,
      url: input.url,
      sortOrder: input.sortOrder,
      jubelioImageId: input.jubelioImageId,
      syncedAt: now,
      source: "JUBELIO_INGEST",
    },
    select: { id: true },
  });
  return { id: created.id, action: "inserted" };
}

export async function pruneJubelioOrphans(
  client: AnyClient,
  itemId: string,
  keepJubelioIds: string[],
): Promise<number> {
  const result = await client.itemImage.deleteMany({
    where: {
      itemId,
      source: "JUBELIO_INGEST",
      jubelioImageId: { notIn: keepJubelioIds.length > 0 ? keepJubelioIds : ["__none__"] },
    },
  });
  return result.count;
}

export async function bindJubelioId(
  client: AnyClient,
  itemImageId: string,
  jubelioImageId: string,
): Promise<void> {
  await client.itemImage.update({
    where: { id: itemImageId },
    data: { jubelioImageId, syncedAt: new Date() },
  });
}
