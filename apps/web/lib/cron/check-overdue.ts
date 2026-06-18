import {
  checkAndSendOverdueNotifications,
  checkAndSendAccessoriesPendingCMTNotifications,
} from "@/app/actions/notifications";

export async function runCheckOverdue(): Promise<void> {
  const [overdue, accessories] = await Promise.all([
    checkAndSendOverdueNotifications(),
    checkAndSendAccessoriesPendingCMTNotifications(),
  ]);
  console.log(
    "[cron] check-overdue done — overdue.sent=%d accessoriesCmt.sent=%d woCount=%d",
    overdue.sent,
    accessories.sent,
    accessories.woCount,
  );
}
