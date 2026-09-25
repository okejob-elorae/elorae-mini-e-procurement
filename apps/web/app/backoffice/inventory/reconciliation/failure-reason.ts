/**
 * Turns the `errorMessage` a failed reconciliation run stores into a sentence
 * an operator can act on. The runner saves the raw exception text; the common
 * one is Node's "fetch failed", which only means the Jubelio integration
 * service could not be reached — useless on screen as-is. Unknown messages are
 * passed through unchanged so nothing is hidden, and a run with no message at
 * all says so honestly instead of showing a bare "Gagal".
 */
type Translate = (key: "failureUnknown" | "failureApiUnreachable" | "failureSnapshot") => string;

export function reconciliationFailureReason(
  errorMessage: string | null | undefined,
  t: Translate,
): { reason: string; technical: string | null } {
  const raw = errorMessage?.trim() ?? "";
  if (!raw) return { reason: t("failureUnknown"), technical: null };
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(raw)) {
    return { reason: t("failureApiUnreachable"), technical: raw };
  }
  if (/Failed to fetch Jubelio inventory snapshot/i.test(raw)) {
    return { reason: t("failureSnapshot"), technical: raw };
  }
  return { reason: raw, technical: null };
}
