export type PhotoSyncDecision = "evict" | "terminal" | "retry";

const TERMINAL_STATUSES = new Set([400, 401, 403, 404]);

export function classifyPhotoUpload(status: number | "thrown"): PhotoSyncDecision {
  if (status === "thrown") return "retry";
  if (status >= 200 && status < 300) return "evict";
  return TERMINAL_STATUSES.has(status) ? "terminal" : "retry";
}
