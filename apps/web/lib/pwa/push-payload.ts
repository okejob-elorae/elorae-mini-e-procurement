/**
 * Imported by the PWA service worker (`app/pwa/sw.ts`), whose bundle may not resolve the `@/`
 * alias — keep every import relative, and only of import-free modules like `navigation.ts`.
 */
import { getNotificationHref } from "../notifications/navigation";

export type ParsedPushPayload = { title: string; body: string; url: string; tag?: string };

const FALLBACK_TITLE = "Elorae";
const FALLBACK_URL = "/pwa/notifications";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/* Same-origin paths only: a protocol-relative `//host` would open another site. */
function isSafePath(href: string | null): href is string {
  return href !== null && href.startsWith("/") && !href.startsWith("//");
}

/**
 * Reads the JSON FCM delivers to a web push subscription —
 * `{ notification?: { title?, body? }, data?: Record<string, string>, fcmMessageId? }` — into
 * what the service worker shows. Never throws: Chrome's `userVisibleOnly` contract means every
 * push must show a notification, so a shape this does not recognise still yields a fallback
 * title that opens the notification list.
 */
export function parsePushPayload(raw: unknown): ParsedPushPayload {
  const root = asRecord(raw);
  const notification = asRecord(root?.notification);
  const data = asRecord(root?.data);

  const title = nonEmptyString(notification?.title) ?? nonEmptyString(data?.title) ?? FALLBACK_TITLE;
  const body = nonEmptyString(notification?.body) ?? nonEmptyString(data?.body) ?? "";

  const type = nonEmptyString(data?.type);
  const href = type && data ? getNotificationHref(type, data, "pwa") : null;
  const url = isSafePath(href) ? href : FALLBACK_URL;

  const tag = nonEmptyString(root?.fcmMessageId);
  return tag ? { title, body, url, tag } : { title, body, url };
}
