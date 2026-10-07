import { prisma } from "@elorae/db";
import { sendNotificationToUsers } from "@/lib/notifications/recipients";

export type SalesmanMismatchNoticeInput = {
  returnId: string;
  docNo: string;
  storeId: string;
  mismatchedLineCount: number;
};

/**
 * The salesman reads this in the PWA, so the copy is Indonesian. `data` stays flat strings only:
 * `sendNotificationToUsers` spreads it into the FCM data map, which carries nothing else, and
 * `getNotificationHref` reads `storeId` from it to open the store page in the PWA.
 */
export function buildSalesmanMismatchNotice(input: SalesmanMismatchNoticeInput): {
  title: string;
  body: string;
  data: Record<string, string>;
} {
  return {
    title: `Retur ${input.docNo}: hitungan gudang berbeda`,
    body: `${input.mismatchedLineCount} baris retur tidak sesuai dengan hitungan gudang. Admin sedang menindaklanjuti.`,
    data: { returnId: input.returnId, docNo: input.docNo, storeId: input.storeId },
  };
}

/**
 * Tells the salesman who raised a FIELD retur that the warehouse count disagreed with theirs.
 * Callers run it after their transaction commits and never await it (an interactive path).
 *
 * The `VITEST` guard is defence in depth: `sendNotificationToUsers` carries its own, but the
 * receiving specs share the `:3308` bed and the real `FIREBASE_ADMIN_*` credentials, so a run that
 * got past both would write a real `NotificationQueue` row and attempt a real push.
 */
export async function notifySalesmanOfMismatch(
  input: SalesmanMismatchNoticeInput & { raisedById: string },
): Promise<void> {
  if (process.env.VITEST) return;
  const user = await prisma.user.findUnique({
    where: { id: input.raisedById },
    select: { id: true, fcmToken: true },
  });
  if (!user) return;
  await sendNotificationToUsers([user], {
    type: "FIELD_RETURN_MISMATCH",
    ...buildSalesmanMismatchNotice(input),
  });
}
