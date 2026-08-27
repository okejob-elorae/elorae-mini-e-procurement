import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { CollectionError } from "./errors";

export async function assignCollector(input: {
  receivableIds: string[];
  collectorId: string | null;
  assignedById: string;
}): Promise<{ assignedCount: number }> {
  if (input.receivableIds.length === 0) throw new CollectionError("EMPTY_TARGETS");
  if (new Set(input.receivableIds).size !== input.receivableIds.length) {
    throw new CollectionError("DUPLICATE_TARGETS");
  }

  return runSerializable(async (tx) => {
    if (input.collectorId !== null) {
      const eligible = await tx.user.findFirst({
        where: {
          id: input.collectorId,
          roleDefinition: { permissions: { some: { permission: { code: "collections:collect" } } } },
        },
        select: { id: true },
      });
      if (!eligible) throw new CollectionError("NOT_ELIGIBLE");
    }

    const receivables = await tx.receivable.findMany({
      where: { id: { in: input.receivableIds } },
      select: { id: true, status: true, collectorId: true },
    });
    if (receivables.length !== input.receivableIds.length) throw new CollectionError("NOT_FOUND");
    for (const r of receivables) {
      if (r.status === "PAID" || r.status === "WRITTEN_OFF") throw new CollectionError("ALREADY_SETTLED");
    }

    const previousCollectorIds = Array.from(
      new Set(receivables.map((r) => r.collectorId).filter((id): id is string => id !== null)),
    );

    await tx.receivable.updateMany({
      where: { id: { in: input.receivableIds } },
      data: { collectorId: input.collectorId },
    });

    await tx.auditLog.create({
      data: {
        userId: input.assignedById,
        action: input.collectorId === null ? "COLLECTOR_UNASSIGN" : "COLLECTOR_ASSIGN",
        entityType: "Receivable",
        entityId: input.receivableIds[0],
        metadata: { receivableIds: input.receivableIds, collectorId: input.collectorId, previousCollectorIds },
      },
    });

    return { assignedCount: input.receivableIds.length };
  });
}
