import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { sendNotificationToUsers } from "@/lib/notifications/recipients";
import { CollectionError } from "./errors";

/**
 * One push to the collector who just received work: a single receivable opens that receivable, a
 * batch opens the queue. After the commit and best-effort, so a failed push never undoes the
 * assignment. Only receivables that actually changed hands count, so re-assigning a collector to
 * receivables they already hold sends nothing.
 */
async function notifyCollectorOfAssignment(collectorId: string, newlyAssignedIds: string[]): Promise<void> {
  if (newlyAssignedIds.length === 0) return;
  try {
    const collector = await prisma.user.findUnique({
      where: { id: collectorId },
      select: { id: true, fcmToken: true },
    });
    if (!collector) return;
    const single = newlyAssignedIds.length === 1;
    await sendNotificationToUsers([collector], {
      type: "COLLECTOR_ASSIGNED",
      title: "Tagihan baru ditugaskan",
      body: single
        ? "1 piutang baru ditugaskan kepada Anda"
        : `${newlyAssignedIds.length} piutang baru ditugaskan kepada Anda`,
      data: single ? { receivableId: newlyAssignedIds[0], count: "1" } : { count: String(newlyAssignedIds.length) },
    });
  } catch (err) {
    console.error(`[collections] collector assignment notice failed for ${collectorId}`, err);
  }
}

export async function assignCollector(input: {
  receivableIds: string[];
  collectorId: string | null;
  assignedById: string;
}): Promise<{ assignedCount: number }> {
  if (input.receivableIds.length === 0) throw new CollectionError("EMPTY_TARGETS");
  if (new Set(input.receivableIds).size !== input.receivableIds.length) {
    throw new CollectionError("DUPLICATE_TARGETS");
  }

  const { assignedCount, newlyAssignedIds } = await runSerializable(async (tx) => {
    if (input.collectorId !== null) {
      /*
       * A `collections:collect` permission ROW is not enough — `pwaAccessGuard` (apps/web/lib/pwa/guard.ts)
       * bounces any user whose role is `isSystem` (wildcard `*`) out of /pwa/* unconditionally,
       * and ADMIN is granted every real Permission row explicitly (see seed-collections-permissions.sql's
       * own comment), so a naive check here would happily mark ADMIN "eligible" to collect while
       * pwaAccessGuard permanently refuses them the one screen collection actually happens on.
       * Require pwa:access too, and exclude isSystem roles, matching pwaAccessGuard's real gate
       * (!hasWildcard && hasPwaAccess) exactly instead of approximating it.
       */
      const eligible = await tx.user.findFirst({
        where: {
          id: input.collectorId,
          roleDefinition: {
            isSystem: false,
            AND: [
              { permissions: { some: { permission: { code: "collections:collect" } } } },
              { permissions: { some: { permission: { code: "pwa:access" } } } },
            ],
          },
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
      if (r.status === "PAID" || r.status === "WRITTEN_OFF" || r.status === "VOIDED") throw new CollectionError("ALREADY_SETTLED");
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

    return {
      assignedCount: input.receivableIds.length,
      newlyAssignedIds: receivables.filter((r) => r.collectorId !== input.collectorId).map((r) => r.id),
    };
  });

  if (input.collectorId !== null) await notifyCollectorOfAssignment(input.collectorId, newlyAssignedIds);
  return { assignedCount };
}
