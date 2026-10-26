export type PhotoSyncDecision = "evict" | "terminal" | "retry";

/** Stored as the failed photo's `error` when the server refused it at the per-visit cap. */
export const PHOTO_CAP_REACHED_ERROR = "CAP_REACHED";

/**
 * 401 is deliberately absent: an expired session is transient, so the photo waits for the
 * next flush after re-login. The proxy answers an unauthenticated `/pwa/api/*` call with a JSON
 * 401, and the upload fetches with `redirect: "manual"`, so a redirect surfaces as status 0 and
 * retries too. 409 is the server's per-visit cap refusal, which no retry can fix.
 */
const TERMINAL_STATUSES = new Set([400, 403, 404, 409]);

export function classifyPhotoUpload(status: number | "thrown"): PhotoSyncDecision {
  if (status === "thrown") return "retry";
  if (status >= 200 && status < 300) return "evict";
  return TERMINAL_STATUSES.has(status) ? "terminal" : "retry";
}
