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
 */
export async function fanOutAdminNotification(notification: {
  id: string;
  category: string;
  title: string;
  message: string;
  metadata?: unknown;
}): Promise<void> {
  const permission = CATEGORY_PERMISSION[notification.category];
  if (!permission) {
    console.warn(`[notification-fanout] no permission mapped for category ${notification.category}`);
    return;
  }

  try {
    const users = await getUsersWithPermission(permission);
    if (users.length === 0) {
      /**
       * Loud on purpose. `getUsersWithPermission` returns [] when the Permission row does not
       * exist, and this deployment seeds permission rows by hand — so a missing row is a real
       * and recurring misconfiguration. Silently telling nobody is the exact failure this
       * feature removes.
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
