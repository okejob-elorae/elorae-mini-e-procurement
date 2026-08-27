import { runSerializable } from "@/lib/db/tx-retry";
import { CollectionError } from "./errors";

export async function rejectCollection(input: {
  submissionId: string;
  reason: string;
  rejectedById: string;
}): Promise<{ ok: true }> {
  const reason = input.reason.trim();
  /*
   * Same visible-content check as `voidPayment` (`apps/web/lib/finance/ar/void-writer.ts`) — a
   * reason made only of zero-width/format characters (Unicode `Cf`, e.g. U+200B) or U+2800
   * BRAILLE PATTERN BLANK survives `.trim()` unchanged and would otherwise persist as a
   * reject reason that renders blank.
   */
  const hasVisibleContent = /[^\s\p{Cf}⠀]/u.test(reason);
  if (!hasVisibleContent) throw new CollectionError("MISSING_REASON", "A reject reason is required");

  return runSerializable(async (tx) => {
    const submission = await tx.collectionSubmission.findUnique({
      where: { id: input.submissionId },
      select: { id: true, status: true, receivableId: true, amount: true },
    });
    if (!submission) throw new CollectionError("NOT_FOUND");
    if (submission.status !== "PENDING") throw new CollectionError("NOT_PENDING");

    const flipped = await tx.collectionSubmission.updateMany({
      where: { id: submission.id, status: "PENDING" },
      data: { status: "REJECTED", rejectReason: reason },
    });
    if (flipped.count === 0) throw new CollectionError("NOT_PENDING");

    await tx.auditLog.create({
      data: {
        userId: input.rejectedById,
        action: "COLLECTION_REJECT",
        entityType: "CollectionSubmission",
        entityId: submission.id,
        reason,
        metadata: { receivableId: submission.receivableId, amount: Number(submission.amount) },
      },
    });

    return { ok: true };
  });
}
