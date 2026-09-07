/**
 * Settlement variance tolerance configuration.
 *
 * Deliberately import-free, the same policy as `calc.ts` and `allocate.ts` beside it: the PWA
 * settlement screen is a "use client" component and imports this directory directly, so any
 * import here that reaches the `@elorae/db` barrel (Prisma types, the generated schema enums, a
 * `./queries`-style module) would drag Prisma and the mariadb driver into the browser bundle.
 * This module needs nothing at all, not even `roundCents`, so it imports nothing at all.
 */
export const VARIANCE_TOLERANCE_SETTING_KEY = "settlement.varianceToleranceRupiah";
export const DEFAULT_VARIANCE_TOLERANCE = 0;

/**
 * Parses the approval variance tolerance — the absolute rupiah gap between a settlement's
 * computed `expectedAmount` and the cash the salesman actually handed over that finance may
 * approve without typing an override reason.
 *
 * Fails OPEN to `DEFAULT_VARIANCE_TOLERANCE` on anything absent, empty or malformed, the same
 * shape as `parseOverdueThresholds`. "Fail open" here means the PARSE falls back rather than
 * throwing — it does NOT mean a malformed setting widens what approval will accept. The default
 * is `0`, so a broken configuration ends up STRICTER than a working one: every non-zero variance
 * then demands a reason. That direction is deliberate. The failure this feature exists to remove
 * is money changing hands with no recorded explanation, so the safe degradation is to ask for
 * more explanation, never less.
 *
 * Accepts a non-negative decimal with at most two places (`Decimal(15,2)` is the width every
 * settlement amount is stored at). A leading sign, an exponent, or any other character falls
 * back — which is how a negative value, which would otherwise make `Math.abs(variance) <=
 * tolerance` unsatisfiable in a confusing way, is rejected. `Number.isFinite` is still load
 * bearing after the pattern: a three-hundred-digit integer matches `\d+` and parses to
 * `Infinity`, which would silently disable the gate entirely.
 */
export function parseVarianceTolerance(raw: string | null | undefined): number {
  if (!raw || raw.trim() === "") return DEFAULT_VARIANCE_TOLERANCE;

  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    console.warn(
      `[variance-tolerance] malformed ${VARIANCE_TOLERANCE_SETTING_KEY}="${raw}" — falling back to ${DEFAULT_VARIANCE_TOLERANCE}`,
    );
    return DEFAULT_VARIANCE_TOLERANCE;
  }

  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    console.warn(
      `[variance-tolerance] out-of-range ${VARIANCE_TOLERANCE_SETTING_KEY}="${raw}" — falling back to ${DEFAULT_VARIANCE_TOLERANCE}`,
    );
    return DEFAULT_VARIANCE_TOLERANCE;
  }

  return value;
}
