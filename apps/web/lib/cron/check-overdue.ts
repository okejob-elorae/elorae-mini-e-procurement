import {
  checkAndSendOverdueNotifications,
  checkAndSendWoOverdueNotifications,
  checkAndSendAccessoriesPendingCMTNotifications,
} from "@/app/actions/notifications";

export async function runCheckOverdue(): Promise<void> {
  const [overdue, woOverdue, accessories] = await Promise.all([
    checkAndSendOverdueNotifications(),
    checkAndSendWoOverdueNotifications(),
    checkAndSendAccessoriesPendingCMTNotifications(),
  ]);
  console.log(
    "[cron] check-overdue done — overdue.sent=%d woOverdue.sent=%d accessoriesCmt.sent=%d woCount=%d",
    overdue.sent,
    woOverdue.sent,
    accessories.sent,
    accessories.woCount,
  );
}
