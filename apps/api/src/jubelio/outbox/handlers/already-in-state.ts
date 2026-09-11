/**
 * Jubelio refuses a WMS state transition when the sales channel has already
 * moved the order past it. The refusal arrives as an HTTP 500 whose top-level
 * `message` is the useless generic "An internal server error occurred"; the real
 * reason sits in the body's own `code` field as free-text Indonesian:
 *
 *   "error: Pesanan sudah dipakai di transaksi lain. Pesanan: SP-260901V8CUMUTR,
 *    Status Channel: READY_TO_SHIP, Status Sekarang: PAID, Status Dituju: FINISH_PACK"
 *
 * `JubelioHttpService.parse` stores that parsed body on `JubelioError.cause`, so
 * the marker is reachable at `cause.code` — never at `err.code`, and never as the
 * literal "ALREADY_IN_STATE" the handlers used to look for. Retrying such a push
 * can never succeed, so callers treat a match as SKIPPED rather than a failure.
 *
 * Observed on prod 2026-09-01 for salesorder 47180; see docs/ARCHITECTURE-NOTES.md.
 */
const ALREADY_IN_STATE_MARKERS = ["sudah dipakai di transaksi lain"];

/**
 * Every place the marker phrase has been observed or could plausibly surface,
 * flattened into one lowercase haystack. `cause` is whatever the response body
 * parsed to, which is a string when the body was not JSON.
 */
function errorHaystack(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const parts: string[] = [];
  const { message, cause } = err as { message?: unknown; cause?: unknown };
  if (typeof message === "string") parts.push(message);
  if (typeof cause === "string") {
    parts.push(cause);
  } else if (cause && typeof cause === "object") {
    const body = cause as { code?: unknown; message?: unknown };
    if (typeof body.code === "string") parts.push(body.code);
    if (typeof body.message === "string") parts.push(body.message);
  }
  return parts.join(" ").toLowerCase();
}

export function isAlreadyInStateError(err: unknown): boolean {
  const haystack = errorHaystack(err);
  if (!haystack) return false;
  return ALREADY_IN_STATE_MARKERS.some((marker) => haystack.includes(marker));
}
