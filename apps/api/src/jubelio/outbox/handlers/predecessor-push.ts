import type { PrismaService } from "../../../db/prisma.module";
import { NonRetryableError } from "../../queue/errors";
import { OUTBOX_STATUS } from "../outbox-status";

type PredecessorType = "salesorder_pick" | "salesorder_pack";

/**
 * Pick, pack and ship are enqueued as independent outbox rows, so a later push can be
 * dequeued before its predecessor has landed in Jubelio. The predecessor is the latest
 * row of its type created at or before this row, so a re-enqueue made after this row
 * never gates it. A PENDING or PROCESSING predecessor throws a plain Error, which burns
 * a retry attempt; a DEAD one throws NonRetryableError so this row goes DEAD with an alert.
 */
export async function assertPredecessorSettled(
  prisma: Pick<PrismaService, "jubelioOutbox">,
  opts: { entityId: string; predecessorType: PredecessorType; rowCreatedAt: Date },
): Promise<void> {
  const { entityId, predecessorType, rowCreatedAt } = opts;
  const row = await prisma.jubelioOutbox.findFirst({
    where: { entityType: predecessorType, entityId, createdAt: { lte: rowCreatedAt } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return;

  if (row.status === OUTBOX_STATUS.PENDING || row.status === OUTBOX_STATUS.PROCESSING) {
    throw new Error(`${predecessorType} push for this order has not settled yet`);
  }
  if (row.status === OUTBOX_STATUS.DEAD) {
    throw new NonRetryableError(
      `${predecessorType} push for this order is DEAD (row ${row.id}); settle it before this push can run`,
    );
  }
}
