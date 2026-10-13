/**
 * PO payment reminder thresholds: days relative to a PO's payment due date, negative = before it.
 *
 * Import-free on purpose, so the settings page can read the default without dragging anything
 * server-side into the client bundle.
 */
export const PAYMENT_REMINDER_SETTING_KEY = "po.paymentReminderDays";
export const DEFAULT_PAYMENT_REMINDER_DAYS: readonly number[] = [-7, -1, 0, 7];
export const PAYMENT_REMINDER_DAYS_BOUND = 365;

export type PaymentReminderDaysErrorCode = "EMPTY" | "INVALID" | "OUT_OF_RANGE";

/* The strict check the settings action uses, so the page can never save a value the sweep would discard. */
export function validatePaymentReminderDays(
  raw: string,
): { ok: true; days: number[] } | { ok: false; code: PaymentReminderDaysErrorCode } {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) return { ok: false, code: "EMPTY" };
  if (!parts.every((p) => /^-?\d+$/.test(p))) return { ok: false, code: "INVALID" };

  /* `+ 0` turns a parsed `-0` into `0`, so "-0" and "0" are one threshold and print as "0". */
  const values = parts.map((p) => Number.parseInt(p, 10) + 0);
  if (values.some((v) => Math.abs(v) > PAYMENT_REMINDER_DAYS_BOUND)) return { ok: false, code: "OUT_OF_RANGE" };

  return { ok: true, days: Array.from(new Set(values)).sort((a, b) => a - b) };
}

/**
 * Fails OPEN to the default, like `parseOverdueThresholds`: an unreadable setting failing closed
 * would silently stop every reminder, which is the exact failure this feature exists to remove.
 */
export function parsePaymentReminderDays(raw: string | null | undefined): number[] {
  if (raw === null || raw === undefined || raw.trim() === "") return [...DEFAULT_PAYMENT_REMINDER_DAYS];

  const result = validatePaymentReminderDays(raw);
  if (!result.ok) {
    console.warn(
      `[payment-reminder-thresholds] ${result.code} value in ${PAYMENT_REMINDER_SETTING_KEY}="${raw}" — falling back to defaults`,
    );
    return [...DEFAULT_PAYMENT_REMINDER_DAYS];
  }
  return result.days;
}
