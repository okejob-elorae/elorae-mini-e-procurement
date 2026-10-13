import { prisma } from "@elorae/db";
import { daysOverdue } from "@/lib/finance/ar/aging";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { PO_PAYMENT_DUE, buildPaymentReminderCopy } from "./payment-reminder-copy";
import { PAYMENT_REMINDER_SETTING_KEY, parsePaymentReminderDays } from "./payment-reminder-thresholds";

/**
 * Applied AFTER the priority sort: upcoming and due-today reminders go first, so an overdue
 * backlog (first deploy, or a long outage) drains behind the live ones instead of starving them.
 */
const MAX_ANNOUNCEMENTS_PER_RUN = 200;

export type PaymentReminderSweepResult = {
  scanned: number;
  announced: number;
  deferred: number;
  failed: number;
};

/**
 * The due date is part of the key on purpose: when a PO's due date moves (terms corrected, the
 * first receipt declined, a manual date edited) its reminders re-arm for the new date.
 */
function dedupKey(poId: string, dueDateIso: string): string {
  return `${poId}|${dueDateIso}`;
}

/**
 * Fires one `PO_PAYMENT_DUE` `AdminNotification` per PO per run, at the highest configured
 * threshold it has newly crossed for its current due date. Thresholds are days relative to the
 * due date (negative = before). Modelled on the AR overdue sweep (`runOverdueSweep`), whose
 * comments explain the dedup, marker and await decisions this copies.
 *
 * `poIds` scopes the sweep; omitted, it sweeps every unpaid, non-draft, non-cancelled PO with a
 * due date. Every test MUST pass it — specs share the `:3308` dev bed with real data.
 */
export async function runPaymentReminderSweep(options?: {
  poIds?: string[];
  asOf?: Date;
  maxAnnouncementsPerRun?: number;
}): Promise<PaymentReminderSweepResult> {
  const asOf = options?.asOf ?? new Date();
  const cap = options?.maxAnnouncementsPerRun ?? MAX_ANNOUNCEMENTS_PER_RUN;

  const setting = await prisma.systemSetting.findUnique({
    where: { key: PAYMENT_REMINDER_SETTING_KEY },
    select: { value: true },
  });
  const thresholds = parsePaymentReminderDays(setting?.value ?? null);

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      paidAt: null,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      paymentDueDate: { not: null },
      ...(options?.poIds ? { id: { in: options.poIds } } : {}),
    },
    orderBy: [{ paymentDueDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      docNumber: true,
      paymentDueDate: true,
      grandTotal: true,
      supplier: { select: { name: true } },
    },
  });

  /*
   * Deliberately NO `take` and NO `createdAt` floor: these rows are the only record that a
   * crossing already fired, so a row outside a window would be re-announced every run.
   */
  const priorRows = await prisma.adminNotification.findMany({
    where: { category: PO_PAYMENT_DUE },
    select: { metadata: true },
  });
  const highestAnnounced = new Map<string, number>();
  for (const row of priorRows) {
    const meta = row.metadata as { poId?: unknown; dueDate?: unknown; thresholdDays?: unknown } | null;
    if (typeof meta?.poId !== "string" || typeof meta.dueDate !== "string" || typeof meta.thresholdDays !== "number") continue;
    const key = dedupKey(meta.poId, meta.dueDate);
    const current = highestAnnounced.get(key);
    if (current === undefined || meta.thresholdDays > current) highestAnnounced.set(key, meta.thresholdDays);
  }

  /*
   * Every crossing is computed before any is announced, so the cap never decides which POs are
   * even looked at — only which crossings wait for the next run.
   */
  const candidates: Array<{
    po: (typeof pos)[number];
    dueDate: Date;
    daysRelative: number;
    tStar: number;
    dueDateIso: string;
  }> = [];
  for (const po of pos) {
    const dueDate = po.paymentDueDate;
    if (!dueDate) continue;

    const daysRelative = daysOverdue(dueDate, asOf);
    const crossed = thresholds.filter((t) => t <= daysRelative);
    if (crossed.length === 0) continue;

    const tStar = crossed[crossed.length - 1];
    const dueDateIso = dueDate.toISOString();
    const tLast = highestAnnounced.get(dedupKey(po.id, dueDateIso));
    if (tLast !== undefined && tStar <= tLast) continue;

    candidates.push({ po, dueDate, daysRelative, tStar, dueDateIso });
  }

  /*
   * Upcoming and due-today crossings (`tStar <= 0`) before overdue ones. `Array.prototype.sort`
   * is stable, so each group keeps the query's earliest-due-first, then id, order.
   */
  const groupOf = (tStar: number): number => (tStar <= 0 ? 0 : 1);
  candidates.sort((a, b) => groupOf(a.tStar) - groupOf(b.tStar));

  let announced = 0;
  let deferred = 0;
  let failed = 0;

  for (const { po, dueDate, daysRelative, tStar, dueDateIso } of candidates) {
    if (announced >= cap) {
      deferred++;
      continue;
    }

    const amount = Number(po.grandTotal);
    const { title, message } = buildPaymentReminderCopy({
      docNumber: po.docNumber,
      supplierName: po.supplier.name,
      amount,
      dueDate,
      daysRelative,
    });

    /**
     * The `AdminNotification` row is the dedup marker. A throw before it is written leaves the
     * crossing unannounced, and the next run retries it. `fanOutAdminNotification` never throws
     * and is AWAITED here only because this is a cron with no user waiting — never copy the
     * `await` into an interactive call site.
     */
    try {
      /* Flat scalars only: `toFcmData` drops anything else. `dueDate` + `thresholdDays` are the dedup key. */
      const notification = await prisma.adminNotification.create({
        data: {
          category: PO_PAYMENT_DUE,
          severity: daysRelative > 0 ? "WARNING" : "INFO",
          title,
          message,
          metadata: {
            poId: po.id,
            docNumber: po.docNumber,
            supplierName: po.supplier.name,
            dueDate: dueDateIso,
            thresholdDays: tStar,
            daysRelative,
            amount,
          },
        },
      });
      await fanOutAdminNotification(notification);
    } catch (err) {
      failed++;
      console.error(`[payment-reminder-sweep] PO ${po.id} at ${tStar} days failed; its crossing stays unannounced for the next run`, err);
      continue;
    }

    announced++;
  }

  return { scanned: pos.length, announced, deferred, failed };
}
