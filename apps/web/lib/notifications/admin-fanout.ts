import { PERMISSIONS } from "@/lib/rbac";
import { getUsersWithPermission, sendNotificationToUsers } from "./recipients";
import {
  KONSI_COUNT_DUE,
  KONSI_COUNT_OVERDUE,
  KONSI_REPORT_BLOCKED,
  KONSI_REPORT_HELD,
  KONSI_REPORT_READY,
} from "@/lib/konsi-count-schedule/categories";
import { PO_PAYMENT_DUE } from "@/lib/purchase-orders/payment-reminder-copy";
import { SALES_RETURN_RECEIVED } from "@/lib/sales-returns/bell-copy";

/**
 * Which permission decides who is told about each category.
 *
 * Manage-level, not view-level: a bell that pings people who can see a problem but not fix it
 * is how a bell becomes noise. System-role admins receive everything anyway, because
 * `getUsersWithPermission` includes `roleDefinition.isSystem` users.
 *
 * A category absent from this map is delivered to nobody, deliberately — see
 * `fanOutAdminNotification`.
 */
const CATEGORY_PERMISSION: Record<string, string> = {
  JOURNAL_PENDING: PERMISSIONS.JOURNALS_MANAGE,
  // Jurnal manual / pembalik yang menunggu persetujuan orang lain (maker-checker,
  // lib/finance/jurnal-manual). Pembuatnya ikut menerima — penulisnya yang menolak ia menyetujui.
  JOURNAL_APPROVAL: PERMISSIONS.JOURNALS_MANAGE,
  PENDING_ORDER_APPROVAL: PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  STORE_CHANGE_REQUEST: PERMISSIONS.STORES_MANAGE,
  TAX_INVOICE_PENDING: PERMISSIONS.TAX_INVOICES_MANAGE,
  FIELD_RETURN_MISMATCH: PERMISSIONS.FIELD_RETURNS_MANAGE,
  CREDIT_LIMIT_HOLD: PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  COLLECTION_PENDING_VERIFICATION: PERMISSIONS.PAYMENTS_MANAGE,
  AR_OVERDUE: PERMISSIONS.COLLECTIONS_MANAGE,
  [PO_PAYMENT_DUE]: PERMISSIONS.PURCHASE_ORDERS_EDIT,
  [SALES_RETURN_RECEIVED]: PERMISSIONS.SALES_RETURNS_DECIDE,
  DELIVERY_COMPLETION_STUCK: PERMISSIONS.DELIVERIES_SHIP,
  FULFILLMENT_PUSH_STUCK: PERMISSIONS.SALES_ORDERS_FULFILL,
  [KONSI_COUNT_DUE]: PERMISSIONS.STORES_MANAGE,
  [KONSI_COUNT_OVERDUE]: PERMISSIONS.STORES_MANAGE,
  [KONSI_REPORT_READY]: PERMISSIONS.STORES_MANAGE,
  [KONSI_REPORT_HELD]: PERMISSIONS.STORES_MANAGE,
  [KONSI_REPORT_BLOCKED]: PERMISSIONS.STORES_MANAGE,
  /*
   * Giro yang efektif hari ini atau lewat. Yang bisa bertindak adalah yang boleh
   * memverifikasi klaim (`bolehMemverifikasi` di `lib/receivables/izin.ts`) —
   * hanya mereka yang bisa menandai giro cair atau ditolak bank.
   */
  GIRO_JATUH_TEMPO: PERMISSIONS.JOURNALS_MANAGE,
  /*
   * Sales menarik laporannya sendiri (salah toko). Yang perlu tahu adalah yang
   * memutuskan dokumen itu: keuangan untuk BKM, pengelola retur untuk NRT —
   * supaya penarikan tidak pernah diam-diam.
   */
  KLAIM_DIBATALKAN_SALES: PERMISSIONS.JOURNALS_MANAGE,
  RETUR_DIBATALKAN_SALES: PERMISSIONS.RECEIVABLES_MANAGE,
  // Sales meminta koreksi laporan yang sudah diproses — ke yang bisa membetulkannya.
  KOREKSI_DIMINTA_BKM: PERMISSIONS.JOURNALS_MANAGE,
  KOREKSI_DIMINTA_RETUR: PERMISSIONS.RECEIVABLES_MANAGE,
  // Calon toko baru dari lapangan — yang bisa menyetujui adalah pengelola master toko.
  STORE_PROPOSAL: PERMISSIONS.STORES_MANAGE,
  // Ringkasan harian tim lapangan (18.30 WIB) — untuk yang menyetujui pesanan lapangan.
  RINGKASAN_SALES_HARIAN: PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  // Biaya perjalanan: ajuan ke penyetuju (`bolehMenyetujuiBiaya`), yang sudah
  // disetujui ke keuangan yang membayar (`bolehMembayarBiaya`).
  EXPENSE_CLAIM_SUBMITTED: PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  EXPENSE_CLAIM_TO_PAY: PERMISSIONS.JOURNALS_MANAGE,
  // Tukar barang: ajuan ke penyetuju (`bolehMenyetujuiTukar`), yang sudah
  // disetujui ke gudang yang menyelesaikan (`bolehMenyelesaikanTukar`).
  STORE_EXCHANGE_PROPOSED: PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  STORE_EXCHANGE_TO_COMPLETE: PERMISSIONS.INVENTORY_MANAGE,
  // Pengajuan izin/sakit/cuti — yang memutuskan adalah penyetuju lapangan.
  LEAVE_REQUEST_SUBMITTED: PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  // Mutasi antar toko oleh SPG: ajuan dan selisih ke penyetuju lapangan; yang
  // harus diterima kantor (toko tujuan tanpa SPG) dan yang macet ke pengelola toko.
  STORE_TRANSFER_PROPOSED: PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  STORE_TRANSFER_DISCREPANCY: PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  STORE_TRANSFER_TO_RECEIVE: PERMISSIONS.STORES_MANAGE,
  STORE_TRANSFER_STALE: PERMISSIONS.STORES_MANAGE,
  // Barang rusak yang tiba di kiriman ke toko SPG — gudang yang memutuskan nasibnya.
  STORE_RECEIPT_DAMAGED: PERMISSIONS.INVENTORY_MANAGE,
  // Tukar shift SPG yang sudah disetujui rekannya — pengelola toko yang menyetujui.
  SPG_SHIFT_SWAP: PERMISSIONS.STORES_MANAGE,
  // Barang hilang yang perlu diputuskan penanggungnya — yang menetapkan beban
  // adalah `receivables:manage` (pemisahan tugas di lib/receivables/izin.ts).
  STOCK_LOSS_OPEN: PERMISSIONS.RECEIVABLES_MANAGE,
  // Permintaan stok SPG di toko tanpa salesman pemegang — tidak masuk kotak
  // masuk HP siapa pun, jadi pengelola toko yang menanganinya.
  SPG_STOCK_REQUEST_UNHELD: PERMISSIONS.STORES_MANAGE,
  // Nota retur SPG di toko tanpa salesman pemegang — tidak ada orang lapangan
  // yang menindaklanjutinya, jadi pengelola retur/piutang yang diberi tahu.
  RETUR_SPG_TANPA_PEMEGANG: PERMISSIONS.RECEIVABLES_MANAGE,
};

/**
 * Coerces an `AdminNotification.metadata` blob into the flat string map FCM requires.
 *
 * Scalars are stringified; null, undefined, objects and arrays are dropped rather than
 * JSON-encoded. Nothing downstream reads a blob out of an FCM data field, and encoding one
 * risks the 4KB payload limit — while a non-string value would fail at the FCM call inside a
 * best-effort path where nobody would ever see it.
 */
export function toFcmData(metadata: unknown): Record<string, string> {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

/**
 * Delivers an already-written `AdminNotification` to the bell of everyone who can act on it.
 *
 * Takes the created row rather than a re-stated payload, so the bell can never drift from the
 * flag and the row id is available for the delivery payload.
 *
 * Best-effort by design, and safe as such: the durable half is the `AdminNotification` row
 * itself, which still gates the "Post journal" retry button whatever happens here. A failure
 * costs a bell ping, not state. It must never throw — every caller has already committed its
 * real work — and must never be called inside a transaction, because it performs FCM network
 * calls.
 *
 * The whole body sits inside one try/catch so "never throws" is structural rather than a
 * property of which statements happen to be safe. That matters because every interactive call site
 * invokes it as `void fanOutAdminNotification(...)`: a floating promise that rejected would become
 * an unhandled rejection, which Node terminates the process on by default.
 *
 * Interactive callers must NOT await it. Delivery walks recipients sequentially with an FCM call
 * each, and firebase-admin retries a connection failure for roughly a minute per recipient, so
 * awaiting it stalls the operation that already committed — a canvasser's thermal nota, a PWA
 * order submit. `void` is safe here specifically because web runs as a long-lived Node process on
 * the VPS, not a serverless runtime that freezes on response. The five cron sweeps —
 * `runOverdueSweep`, `runKonsiCountSweep`, `runFulfillmentPushDivergenceSweep`,
 * `runPaymentReminderSweep` and `runSalesReturnBellSweep` — await it deliberately: no user is
 * waiting, and an unawaited batch would stampede FCM.
 * `reportStuckDeliveryCompletionAction` awaits it too: the PWA's offline completion queue calls it
 * mostly from background sync, but also from the pending screen's Retry, where a salesman is
 * waiting, so it is no precedent for an interactive path.
 */
export async function fanOutAdminNotification(notification: {
  id: string;
  category: string;
  title: string;
  message: string;
  metadata?: unknown;
}): Promise<void> {
  /**
   * Never deliver from a test run. Closed here rather than by mocking, because the callers are
   * not the specs that reach this: a spec exercising a writer three call-layers up cannot be
   * expected to know it must stub a module it never imports, and the branch already shipped
   * four such specs before two reviewers found four more. The leak is permanent — vitest runs
   * against the shared `:3308` bed, `NotificationQueue` rows are never pruned, and they land in
   * real dev users' bells naming synthetic document ids. Worse, `vitest.config.ts` loads
   * `apps/web/.env`, which carries the `FIREBASE_ADMIN_*` credentials, so a test run can push to
   * real phones. First statement in the function on purpose: it must precede every database read.
   *
   * `VITEST` is set by the vitest runner itself, in the test process only; nothing in the Docker
   * images, compose files or deploy workflow sets it, so production delivery is unaffected. The
   * seam's own spec unsets it per-case to exercise the real path.
   */
  if (process.env.VITEST) return;

  try {
    const permission = CATEGORY_PERMISSION[notification.category];
    if (!permission) {
      console.warn(`[notification-fanout] no permission mapped for category ${notification.category}`);
      return;
    }

    const users = await getUsersWithPermission(permission);
    if (users.length === 0) {
      /**
       * Loud on purpose. `getUsersWithPermission` falls back to system-role admins when the
       * Permission row itself is absent, so reaching zero recipients now means something
       * stronger: this deployment has no active system-role user AND no role holds the
       * permission. Silently telling nobody is the exact failure this feature removes.
       */
      console.warn(
        `[notification-fanout] no recipients hold ${permission} — ${notification.category} ${notification.id} reached nobody`,
      );
      return;
    }

    await sendNotificationToUsers(users, {
      type: notification.category,
      title: notification.title,
      body: notification.message,
      data: { adminNotificationId: notification.id, ...toFcmData(notification.metadata) },
    });
  } catch (err) {
    console.error(`[notification-fanout] delivery failed for ${notification.category} ${notification.id}`, err);
  }
}
