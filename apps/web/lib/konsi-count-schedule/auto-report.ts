import { prisma } from "@elorae/db";
import { createSellThrough } from "@/lib/konsi-sell-through/writer";
import { SellThroughError, type SellThroughErrorCode } from "@/lib/konsi-sell-through/errors";
import { isLineHeld, roundQty } from "@/lib/konsi-sell-through/derive";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { capNotificationText } from "@/lib/notifications/text";
import idMessages from "@/lib/i18n/messages/id.json";
import { KONSI_REPORT_BLOCKED, KONSI_REPORT_HELD, KONSI_REPORT_READY } from "./categories";

export type AutoReportOutcome =
  | { kind: "SKIPPED" }
  | { kind: "READY"; sellThroughId: string; docNo: string }
  | { kind: "HELD"; sellThroughId: string; docNo: string; heldCount: number }
  | { kind: "BLOCKED"; code: SellThroughErrorCode; detail: string }
  | { kind: "FAILED" };

/*
 * The refusal copy the stocktake page's create button already shows, read from the Indonesian
 * locale rather than restated here, so the notification and the screen can never word one
 * refusal two ways.
 */
const REASON_COPY = idMessages.storeStocktakes.detail.sellThrough.reason as Record<string, string | undefined>;

function blockedReason(code: string, detail: string): string {
  const template = REASON_COPY[code] ?? REASON_COPY.UNEXPECTED ?? code;
  return template.replace("{detail}", detail);
}

/**
 * Creates the DRAFT sell-through report that an approved FULL count at a KONSI store with a
 * sell-through method closes, and tells the admins how it went: READY, HELD (naming how many
 * lines await a resolution), or BLOCKED (naming the refusal). Anything else returns SKIPPED.
 *
 * Best-effort by contract. The caller has already COMMITTED the stocktake approval, and nothing
 * here may undo or fail it, so the whole body sits inside one try/catch and the function never
 * throws. A `SellThroughError` is an expected refusal and becomes BLOCKED. Anything else is
 * logged and becomes FAILED, which leaves the report to be created by hand from the stocktake page
 * exactly as before. It runs outside any transaction, because `createSellThrough` opens its own.
 * STALE is not announced: it only surfaces when a report is approved.
 */
export async function autoCreateSellThroughAfterCount(stocktakeId: string, approverId: string): Promise<AutoReportOutcome> {
  try {
    const st = await prisma.storeStocktake.findUnique({
      where: { id: stocktakeId },
      select: {
        id: true,
        docNo: true,
        storeId: true,
        status: true,
        isFullCount: true,
        store: { select: { name: true, termsType: true, sellThroughMethod: true } },
      },
    });
    if (!st || st.status !== "APPROVED" || !st.isFullCount) return { kind: "SKIPPED" };
    if (st.store.termsType !== "KONSI" || !st.store.sellThroughMethod) return { kind: "SKIPPED" };

    const base = { storeId: st.storeId, storeName: st.store.name, stocktakeId: st.id, stocktakeDocNo: st.docNo };

    let created: { id: string; docNo: string };
    try {
      created = await createSellThrough({ closingStocktakeId: st.id, createdById: approverId });
    } catch (e) {
      if (!(e instanceof SellThroughError)) throw e;
      const detail = e.detail ?? "";
      const notification = await prisma.adminNotification.create({
        data: {
          category: KONSI_REPORT_BLOCKED,
          severity: "WARNING",
          title: capNotificationText(`Laporan sell-through tidak bisa dibuat — ${st.store.name}`),
          message: `Perhitungan ${st.docNo} sudah disetujui, tetapi laporan sell-through tidak bisa dibuat otomatis. ${blockedReason(e.code, detail)}`,
          metadata: { ...base, code: e.code, detail },
        },
      });
      void fanOutAdminNotification(notification);
      return { kind: "BLOCKED", code: e.code, detail };
    }

    const report = await prisma.konsiSellThrough.findUniqueOrThrow({
      where: { id: created.id },
      select: { method: true, lines: { select: { gapQty: true, resolution: true } } },
    });
    const heldCount = report.lines.filter((l) => isLineHeld({ gapQty: roundQty(l.gapQty.toNumber()), resolution: l.resolution }, report.method)).length;
    const reportMeta = { ...base, sellThroughId: created.id, docNo: created.docNo };

    if (heldCount > 0) {
      const notification = await prisma.adminNotification.create({
        data: {
          category: KONSI_REPORT_HELD,
          severity: "WARNING",
          title: capNotificationText(`Laporan sell-through menunggu penyelesaian — ${st.store.name}`),
          message: `Laporan ${created.docNo} dibuat otomatis dari perhitungan ${st.docNo}. ${heldCount} baris menunggu penyelesaian sebelum laporan bisa disetujui.`,
          metadata: { ...reportMeta, heldCount },
        },
      });
      void fanOutAdminNotification(notification);
      return { kind: "HELD", sellThroughId: created.id, docNo: created.docNo, heldCount };
    }

    const notification = await prisma.adminNotification.create({
      data: {
        category: KONSI_REPORT_READY,
        severity: "INFO",
        title: capNotificationText(`Laporan sell-through siap ditinjau — ${st.store.name}`),
        message: `Laporan ${created.docNo} dibuat otomatis dari perhitungan ${st.docNo} dan siap ditinjau.`,
        metadata: reportMeta,
      },
    });
    void fanOutAdminNotification(notification);
    return { kind: "READY", sellThroughId: created.id, docNo: created.docNo };
  } catch (err) {
    console.error(`[konsi-auto-report] stocktake ${stocktakeId} failed`, err);
    return { kind: "FAILED" };
  }
}
