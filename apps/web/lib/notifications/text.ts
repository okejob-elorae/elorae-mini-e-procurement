/**
 * `NotificationQueue.title`/`body` and `AdminNotification.title` are plain `String` columns, i.e.
 * MySQL `VARCHAR(191)`, and an overlong value throws on insert in strict mode, so the row is never
 * written and the notification reaches nobody. MySQL counts characters, not bytes, so the cap is
 * in code points: `Array.from` walks code points and never splits a surrogate pair.
 *
 * Import-free, so any writer can use it.
 */
export const NOTIFICATION_TEXT_MAX = 191;

/* The text unchanged when it fits, else its first `max - 1` code points plus an ellipsis. */
export function capNotificationText(text: string, max: number = NOTIFICATION_TEXT_MAX): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join("")}…`;
}
