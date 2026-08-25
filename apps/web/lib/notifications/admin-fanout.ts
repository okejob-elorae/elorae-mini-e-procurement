import { PERMISSIONS } from "@/lib/rbac";
import { getUsersWithPermission, sendNotificationToUsers } from "./recipients";

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
  PENDING_ORDER_APPROVAL: PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  STORE_CHANGE_REQUEST: PERMISSIONS.STORES_MANAGE,
  TAX_INVOICE_PENDING: PERMISSIONS.TAX_INVOICES_MANAGE,
  FIELD_RETURN_MISMATCH: PERMISSIONS.FIELD_RETURNS_MANAGE,
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
 * property of which statements happen to be safe. That matters because every call site invokes
 * it as `void fanOutAdminNotification(...)`: a floating promise that rejected would become an
 * unhandled rejection, which Node terminates the process on by default.
 *
 * Callers must NOT await it. Delivery walks recipients sequentially with an FCM call each, and
 * firebase-admin retries a connection failure for roughly a minute per recipient, so awaiting it
 * stalls the operation that already committed — a canvasser's thermal nota, a PWA order submit.
 * `void` is safe here specifically because web runs as a long-lived Node process on the VPS, not
 * a serverless runtime that freezes on response.
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
