import { prisma } from "@elorae/db";
import { sendNotificationToUsers } from "@/lib/notifications/recipients";

export type ApprovalNotice = {
  id: string;
  docNo: string;
  storeId: string;
  salesmanId: string;
};

/**
 * Tells the salesman their settlement was approved. Called by the action after the journals are
 * posted, and only with the `notice` of the call that performed the flip, so a replay never
 * re-notifies. Best-effort: a failure here is logged and swallowed, because the approval already
 * happened. No `VITEST` guard of its own, since `sendNotificationToUsers` carries one and a second
 * would hide the call from a spec that stubs the helper.
 */
export async function notifySalesmanOfApproval(settlement: ApprovalNotice): Promise<void> {
  try {
    const salesman = await prisma.user.findUnique({
      where: { id: settlement.salesmanId },
      select: { id: true, fcmToken: true },
    });
    if (!salesman) return;
    await sendNotificationToUsers([salesman], {
      type: "SETTLEMENT_APPROVED",
      title: "Pelunasan disetujui",
      body: `Pelunasan ${settlement.docNo} sudah disetujui`,
      data: { settlementId: settlement.id, docNo: settlement.docNo, storeId: settlement.storeId },
    });
  } catch (e) {
    console.error(`[approveSettlement] notification delivery failed for settlement ${settlement.id}`, e);
  }
}
