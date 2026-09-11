/**
 * Overdue-alert threshold configuration.
 *
 * Deliberately import-free: no client component imports this today, but the parser is pure and
 * cheap to keep that way — same insurance policy as `pricing-rules.ts` beside the field-sales
 * retur module's `variance.ts`.
 */
export const OVERDUE_THRESHOLD_SETTING_KEY = "ar.overdueThresholdDays";
export const DEFAULT_OVERDUE_THRESHOLDS: number[] = [0, 7, 30, 60];

/**
 * Parses a comma-separated non-negative-integer day list ("0,7,30,60") into a sorted, deduped
 * array. Fails OPEN to `DEFAULT_OVERDUE_THRESHOLDS` on anything malformed, empty, or absent —
 * deliberately the opposite of `readGlCutover`, which fails closed. An ambiguous GL cutover could
 * trigger an unattended retroactive backfill, so silence is the safe failure there. Here silence
 * IS the failure: an unparseable setting failing closed means no overdue alerts fire at all,
 * invisibly, which is exactly what this feature exists to remove.
 */
export function parseOverdueThresholds(raw: string | null | undefined): number[] {
  if (!raw || raw.trim() === "") return DEFAULT_OVERDUE_THRESHOLDS;

  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");

  if (parts.length === 0) return DEFAULT_OVERDUE_THRESHOLDS;

  const values: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      console.warn(
        `[overdue-thresholds] malformed value "${part}" in ${OVERDUE_THRESHOLD_SETTING_KEY}="${raw}" — falling back to defaults`,
      );
      return DEFAULT_OVERDUE_THRESHOLDS;
    }
    values.push(Number.parseInt(part, 10));
  }

  return Array.from(new Set(values)).sort((a, b) => a - b);
}
