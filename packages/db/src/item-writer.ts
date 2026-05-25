import { ItemSource, Prisma } from "../generated/prisma/client";

export type IngestItemCreateData =
  | Omit<Prisma.ItemCreateInput, "source">
  | Omit<Prisma.ItemUncheckedCreateInput, "source">;

export type IngestItemUpdateData =
  | Omit<Prisma.ItemUpdateInput, "source">
  | Omit<Prisma.ItemUncheckedUpdateInput, "source">;

export function createItemFromIngest(
  tx: Prisma.TransactionClient,
  data: IngestItemCreateData,
) {
  return tx.item.create({
    data: { ...data, source: ItemSource.JUBELIO_INGEST },
  });
}

export function updateItemFromIngest(
  tx: Prisma.TransactionClient,
  where: Prisma.ItemWhereUniqueInput,
  data: IngestItemUpdateData,
) {
  return tx.item.update({
    where,
    data: { ...data, source: ItemSource.JUBELIO_INGEST },
  });
}
