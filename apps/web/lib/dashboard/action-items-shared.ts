/**
 * Client-safe half of the action panel: the row shape and the document total.
 *
 * NO `@elorae/db` import here, ever — `ActionNeededPanel` is a client
 * component, and importing `action-items.ts` (which queries Prisma) from it
 * dragged the database driver into the browser bundle and broke the build of
 * every page.
 */

/**
 * One row of the "needs your attention" panel on Beranda.
 *
 * The dashboard below this panel answers "how are we doing"; this panel answers
 * "what is waiting for me". Those are different questions, and only the second
 * one decays into a problem when nobody looks — an approval nobody grants blocks
 * a salesman, a failed journal silently leaves the GL wrong.
 *
 * `labelKey` is a key under the `dashboardActions` i18n namespace, not a string:
 * this panel is the first thing an operator reads every morning, so it must
 * follow the locale like everything else around it.
 */
export type ActionItem = {
  key: string;
  labelKey: string;
  count: number;
  href: string;
  /** Permission needed to ACT on it. Null = anyone who can open the dashboard. */
  permission: string | null;
  /** `overdue` already cost someone time; `waiting` is merely queued. */
  tone: "overdue" | "waiting";
  /** Rupiah at stake, for rows about money. Absent = the row is a count only. */
  amount?: number;
  /**
   * Kunci `dashboardActions.<kunci>` yang menamai nilainya ("nilai PO {nilai}"),
   * bila nilai itu bisa tertukar dengan angka lain di aplikasi — nilai PO
   * terlambat bukan nilai barang yang belum diterima di Laporan.
   */
  amountLabelKey?: string;
  /**
   * Menunggu ORANG LAIN, bukan penonton (mis. BKM yang ia catat sendiri — ia
   * tidak boleh memutuskannya). Tetap tampil supaya ia tahu, tetapi tidak ikut
   * angka "N hal perlu ditindaklanjuti".
   */
  menungguOrangLain?: boolean;
  /**
   * Documents this row shares with another row, so the panel total counts each
   * DOCUMENT once. A PO that is both past its ETA and still SUBMITTED appears on
   * both PO rows; the headline "N things need attention" must not count it twice.
   */
  overlap?: { key: string; count: number };
};

/**
 * How many DOCUMENTS the visible rows add up to. Pure. Rows waiting for someone
 * else (`menungguOrangLain`) are not the viewer's work and are not counted.
 *
 * Rows are not documents: one PO can be both past its ETA and still SUBMITTED.
 * An overlap is subtracted only when the row it points at is visible too —
 * otherwise nothing was counted twice.
 */
export function totalActionDocuments(visible: readonly ActionItem[]): number {
  const keys = new Set(visible.map((item) => item.key));
  return visible.filter((item) => !item.menungguOrangLain).reduce(
    (sum, item) =>
      sum + item.count - (item.overlap && keys.has(item.overlap.key) ? Math.min(item.overlap.count, item.count) : 0),
    0,
  );
}
