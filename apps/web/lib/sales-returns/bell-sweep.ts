import { prisma } from "@elorae/db";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { SALES_RETURN_RECEIVED, buildSalesReturnBellCopy } from "./bell-copy";
import { BELL_FLOOR_SETTING_KEY, parseBellFloor } from "./bell-floor";

/* A burst of ingests (the apps/api sweeper catching up) drains at this pace, oldest first. */
const MAX_ANNOUNCEMENTS_PER_RUN = 50;

export type SalesReturnBellSweepResult = {
  scanned: number;
  announced: number;
  deferred: number;
  failed: number;
  flooredNow: boolean;
};

const NOTHING = { scanned: 0, announced: 0, deferred: 0, failed: 0 };

/**
 * Fires one `SALES_RETURN_RECEIVED` `AdminNotification` per PENDING marketplace return created at
 * or after the floor. Web-only on purpose: apps/api cannot tell a first ingest from a re-ingest,
 * and the bell is fed only by the web fan-out — keying on `SalesReturn.id` here makes webhook
 * retries, the apps/api returns sweeper and re-ingests irrelevant. Modelled on
 * `runPaymentReminderSweep`, whose comments explain the dedup, marker and await decisions.
 *
 * `returnIds` scopes the sweep; omitted, it sweeps every candidate. Every test MUST pass it —
 * specs share the `:3308` dev bed with real data.
 */
export async function runSalesReturnBellSweep(options?: {
  returnIds?: string[];
  now?: Date;
  maxAnnouncementsPerRun?: number;
}): Promise<SalesReturnBellSweepResult> {
  const now = options?.now ?? new Date();
  const cap = options?.maxAnnouncementsPerRun ?? MAX_ANNOUNCEMENTS_PER_RUN;

  const setting = await prisma.systemSetting.findUnique({
    where: { key: BELL_FLOOR_SETTING_KEY },
    select: { value: true },
  });

  /* First run: every return that already exists predates the feature, so floor at now and stop. */
  if (setting === null) {
    await prisma.systemSetting.upsert({
      where: { key: BELL_FLOOR_SETTING_KEY },
      create: { key: BELL_FLOOR_SETTING_KEY, value: now.toISOString() },
      update: {},
    });
    return { ...NOTHING, flooredNow: true };
  }

  /*
   * A value that does not parse is left untouched and announces nothing: re-flooring it would
   * silently skip every return created since, and failing loudly in the log is the safer miss.
   */
  const floor = parseBellFloor(setting.value);
  if (floor === null) {
    console.warn(`[sales-return-bell] unparseable ${BELL_FLOOR_SETTING_KEY}="${setting.value}" — announcing nothing until it is fixed`);
    return { ...NOTHING, flooredNow: false };
  }

  /* `createdAt`, not `receivedAt`: Jubelio's timestamp can predate the floor for a return ingested late. */
  const returns = await prisma.salesReturn.findMany({
    where: {
      status: "PENDING",
      createdAt: { gte: floor },
      ...(options?.returnIds ? { id: { in: options.returnIds } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      jubelioReturnNo: true,
      channel: true,
      channelOrderNo: true,
      totalQty: true,
      totalValue: true,
      salesOrder: { select: { salesorderNo: true } },
    },
  });

  /*
   * Deliberately NO `take` and NO `createdAt` floor: these rows are the only record that a return
   * was already announced, so a row outside a window would be re-announced every run.
   */
  const priorRows = await prisma.adminNotification.findMany({
    where: { category: SALES_RETURN_RECEIVED },
    select: { metadata: true },
  });
  const announcedIds = new Set<string>();
  for (const row of priorRows) {
    const meta = row.metadata as { salesReturnId?: unknown } | null;
    if (typeof meta?.salesReturnId === "string") announcedIds.add(meta.salesReturnId);
  }

  let announced = 0;
  let deferred = 0;
  let failed = 0;

  for (const r of returns) {
    if (announcedIds.has(r.id)) continue;
    if (announced >= cap) {
      deferred++;
      continue;
    }

    const totalQty = Number(r.totalQty);
    const totalValue = Number(r.totalValue);
    const { title, message } = buildSalesReturnBellCopy({
      jubelioReturnNo: r.jubelioReturnNo,
      channelOrderNo: r.channelOrderNo,
      channel: r.channel,
      totalQty,
      totalValue,
      salesorderNo: r.salesOrder?.salesorderNo ?? null,
    });

    /**
     * The `AdminNotification` row is the dedup marker. A throw before it is written leaves the
     * return unannounced, and the next run retries it. `fanOutAdminNotification` never throws
     * and is AWAITED here only because this is a cron with no user waiting — never copy the
     * `await` into an interactive call site.
     */
    try {
      /* Flat scalars only: `toFcmData` drops anything else. `salesReturnId` is the dedup key. No buyer name — this rides in the push. */
      const notification = await prisma.adminNotification.create({
        data: {
          category: SALES_RETURN_RECEIVED,
          severity: "INFO",
          title,
          message,
          metadata: {
            salesReturnId: r.id,
            jubelioReturnNo: r.jubelioReturnNo ?? "",
            channel: r.channel,
            totalQty,
            totalValue,
          },
        },
      });
      await fanOutAdminNotification(notification);
    } catch (err) {
      failed++;
      console.error(`[sales-return-bell] return ${r.id} failed; it stays unannounced for the next run`, err);
      continue;
    }

    announced++;
  }

  return { scanned: returns.length, announced, deferred, failed, flooredNow: false };
}
