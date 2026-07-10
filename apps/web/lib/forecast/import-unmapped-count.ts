import { ResolutionStatus, prisma } from "@elorae/db";

export async function countUnmappedSkusByImportBatch(
  importIds: string[],
): Promise<Map<string, number>> {
  if (importIds.length === 0) {
    return new Map();
  }

  const pairs = await prisma.salesHistory.findMany({
    where: {
      importBatchId: { in: importIds },
      resolutionStatus: ResolutionStatus.UNMAPPED,
    },
    select: { importBatchId: true, variantSku: true },
    distinct: ["importBatchId", "variantSku"],
  });

  const counts = new Map<string, number>();
  for (const pair of pairs) {
    counts.set(pair.importBatchId, (counts.get(pair.importBatchId) ?? 0) + 1);
  }
  return counts;
}
