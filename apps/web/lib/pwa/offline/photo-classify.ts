export type PhotoSyncDecision = "evict" | "terminal" | "retry";

/**
 * 401 is deliberately absent: an expired session is transient, so the photo waits for the
 * next flush after re-login. 409 is the server's per-visit cap refusal, which no retry can fix.
 */
const TERMINAL_STATUSES = new Set([400, 403, 404, 409]);

export function classifyPhotoUpload(status: number | "thrown"): PhotoSyncDecision {
  if (status === "thrown") return "retry";
  if (status >= 200 && status < 300) return "evict";
  return TERMINAL_STATUSES.has(status) ? "terminal" : "retry";
}
