import cron from "node-cron";
import { runCheckOverdue } from "./check-overdue";
import { runReconciliationCron } from "@/app/actions/stock-reconciliation";
import { postPendingSalesJournals, GL_CUTOVER_SETTING_KEY } from "@/lib/finance/sales/sweep";

let registered = false;

export function registerCronJobs(): void {
  if (registered) return;
  registered = true;

  // Daily 09:00 Asia/Jakarta
  cron.schedule(
    "0 9 * * *",
    async () => {
      console.log("[cron] check-overdue tick");
      try {
        await runCheckOverdue();
      } catch (err) {
        console.error("[cron] check-overdue failed:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  // Every 6 hours — Jubelio stock reconciliation
  cron.schedule(
    "0 */6 * * *",
    async () => {
      console.log("[cron] reconciliation tick");
      try {
        await runReconciliationCron();
      } catch (err) {
        console.error("[cron] reconciliation failed:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  // Every 5 minutes — post sales revenue + COGS journals for shipped orders
  cron.schedule(
    "*/5 * * * *",
    async () => {
      console.log("[cron] sales-journal tick");
      try {
        const r = await postPendingSalesJournals();
        /*
         * `NO_CUTOVER` is logged rather than passed over in silence: it means the
         * sweep is inert by configuration, not that the backlog is empty, and an
         * unset or malformed cutover date would otherwise look identical to a
         * healthy idle tick for as long as it stayed wrong.
         */
        if (r.skipped === "NO_CUTOVER") {
          console.warn(
            `[cron] sales-journal: inert — ${GL_CUTOVER_SETTING_KEY} is unset or not a valid YYYY-MM-DD date, so no sales journals will post`,
          );
        } else if (r.posted > 0 || r.pending > 0) {
          console.log(`[cron] sales-journal: +${r.revenue} rev, +${r.cogs} cogs, ${r.pending} pending`);
        }
      } catch (err) {
        console.error("[cron] sales-journal failed:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  console.log("[cron] jobs registered");
}
