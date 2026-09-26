import { prisma, type Prisma } from "@elorae/db";
import { createSellThrough } from "@/lib/konsi-sell-through/writer";
import { SellThroughError, type SellThroughErrorCode } from "@/lib/konsi-sell-through/errors";
import { isLineHeld, roundQty } from "@/lib/konsi-sell-through/derive";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { capNotificationText } from "@/lib/notifications/text";
import { KONSI_REPORT_BLOCKED, KONSI_REPORT_HELD, KONSI_REPORT_READY } from "./categories";

/**
 * SKIPPED: nothing to create, including when someone created this count's report by hand first.
 * READY/HELD: the report was created and announced. BLOCKED: `createSellThrough` refused it.
 * FAILED: something unexpected threw. A FAILED outcome that carries a `sellThroughId` means the
 * report WAS created but not announced, so it must never be read as "no report exists".
 */
export type AutoReportOutcome =
  | { kind: "SKIPPED" }
  | { kind: "READY"; sellThroughId: string; docNo: string }
  | { kind: "HELD"; sellThroughId: string; docNo: string; heldCount: number }
  | { kind: "BLOCKED"; code: SellThroughErrorCode; detail: string }
  | { kind: "FAILED"; sellThroughId?: string };

/* Writes one notification and fans it out. A failure is logged and swallowed, since the outcome it announces has already happened. */
async function announce(stocktakeId: string, data: Prisma.AdminNotificationCreateInput): Promise<void> {
  try {
    const notification = await prisma.adminNotification.create({ data });
    void fanOutAdminNotification(notification);
  } catch (err) {
    console.error(`[konsi-auto-report] notification ${data.category} for stocktake ${stocktakeId} failed`, err);
  }
}

/**
 * Creates the DRAFT sell-through report that an approved FULL count at a KONSI store with a
 * sell-through method closes, and tells the admins how it went: READY, HELD (naming how many
 * lines await a resolution), or BLOCKED (naming the refusal code and pointing at the stocktake,
 * whose page shows the reason). Anything else returns SKIPPED.
 *
 * Best-effort by contract. The caller has already COMMITTED the stocktake approval, and nothing
 * here may undo or fail it, so the whole body sits inside one try/catch and the function never
 * throws. A `SellThroughError` is an expected refusal and becomes BLOCKED, except when the report
 * already exists because someone created it by hand first: `ALREADY_USED`, or `DRAFT_EXISTS`
 * while a live report closes this very count, which is SKIPPED. Anything else is logged and
 * becomes FAILED, which leaves the report to be created by hand from the stocktake page exactly as
 * before; once `createSellThrough` has succeeded, FAILED carries its id. Each notification is
 * written in its own try/catch, so a failed announcement never hides a created report. It runs
 * outside any transaction, because `createSellThrough` opens its own. STALE is not announced: it
 * only surfaces when a report is approved.
 */
export async function autoCreateSellThroughAfterCount(stocktakeId: string, approverId: string): Promise<AutoReportOutcome> {
  let createdId: string | undefined;
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
      if (e.code === "ALREADY_USED") return { kind: "SKIPPED" };
      if (e.code === "DRAFT_EXISTS") {
        const live = await prisma.konsiSellThrough.findUnique({ where: { stocktakeKey: st.id }, select: { id: true } });
        if (live) return { kind: "SKIPPED" };
      }
      const detail = e.detail ?? "";
      await announce(st.id, {
        category: KONSI_REPORT_BLOCKED,
        severity: "WARNING",
        title: capNotificationText(`Laporan sell-through tidak bisa dibuat — ${st.store.name}`),
        message: `Perhitungan ${st.docNo} disetujui, tetapi laporan sell-through tidak bisa dibuat otomatis (kode ${e.code}). Buka perhitungan ini untuk melihat alasannya.`,
        metadata: { ...base, code: e.code, detail },
      });
      return { kind: "BLOCKED", code: e.code, detail };
    }
    createdId = created.id;

    const report = await prisma.konsiSellThrough.findUniqueOrThrow({
      where: { id: created.id },
      select: { method: true, lines: { select: { gapQty: true, resolution: true } } },
    });
    const heldCount = report.lines.filter((l) => isLineHeld({ gapQty: roundQty(l.gapQty.toNumber()), resolution: l.resolution }, report.method)).length;
    const reportMeta = { ...base, sellThroughId: created.id, docNo: created.docNo };

    if (heldCount > 0) {
      await announce(st.id, {
        category: KONSI_REPORT_HELD,
        severity: "WARNING",
        title: capNotificationText(`Laporan sell-through menunggu penyelesaian — ${st.store.name}`),
        message: `Laporan ${created.docNo} dibuat otomatis dari perhitungan ${st.docNo}. ${heldCount} baris menunggu penyelesaian sebelum laporan bisa disetujui.`,
        metadata: { ...reportMeta, heldCount },
      });
      return { kind: "HELD", sellThroughId: created.id, docNo: created.docNo, heldCount };
    }

    await announce(st.id, {
      category: KONSI_REPORT_READY,
      severity: "INFO",
      title: capNotificationText(`Laporan sell-through siap ditinjau — ${st.store.name}`),
      message: `Laporan ${created.docNo} dibuat otomatis dari perhitungan ${st.docNo} dan siap ditinjau.`,
      metadata: reportMeta,
    });
    return { kind: "READY", sellThroughId: created.id, docNo: created.docNo };
  } catch (err) {
    console.error(`[konsi-auto-report] stocktake ${stocktakeId} failed`, err);
    return createdId ? { kind: "FAILED", sellThroughId: createdId } : { kind: "FAILED" };
  }
}
