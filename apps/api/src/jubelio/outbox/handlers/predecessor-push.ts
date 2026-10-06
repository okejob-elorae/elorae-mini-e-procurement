import type { JubelioOutboxEntityType } from "@elorae/db";
import type { PrismaService } from "../../../db/prisma.module";
import { OUTBOX_STATUS } from "../outbox-status";

type PredecessorType = Extract<JubelioOutboxEntityType, "salesorder_pick" | "salesorder_pack">;

/**
 * Pick, pack and ship are enqueued as independent outbox rows, so a later push can be
 * dequeued before its predecessor has landed in Jubelio. The predecessor is the latest
 * row of its type created at or before this row, so a re-enqueue made after this row
 * never gates it. Only a PENDING or PROCESSING predecessor holds this push: it throws a
 * plain Error, which burns a retry attempt. DONE, SKIPPED, DEAD or no row lets the push
 * proceed and Jubelio validates the state transition itself. DEAD must not hold it: a
 * DEAD row cannot be settled (the outbox reset puts it back to PENDING and a repeating
 * Jubelio refusal sends it DEAD again), so holding on DEAD would block the dependent
 * push for good.
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
}
