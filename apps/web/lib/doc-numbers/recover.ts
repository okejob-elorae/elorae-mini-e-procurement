import { normalizePrefix } from "./validate";

type Period = { year: number; month: number };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The highest sequence number already issued under the config's CURRENT prefix and period.
 *
 * Matched case-insensitively, like the `utf8mb4_unicode_ci` column the numbers live in. A NEVER
 * counter never resets, so any year in the number counts: the year there is the issue year, not a
 * period the counter belongs to.
 */
export function maxIssuedNumber(
  docNumbers: string[],
  config: { prefix: string; resetPeriod: string },
  period: Period,
): number {
  const prefix = escapeRegExp(normalizePrefix(config.prefix).toLowerCase());
  let periodPart: string;
  if (config.resetPeriod === "MONTHLY") {
    periodPart = `${period.year}/${String(period.month).padStart(2, "0")}/`;
  } else if (config.resetPeriod === "YEARLY") {
    periodPart = `${period.year}/`;
  } else {
    periodPart = "\\d{4}/";
  }
  const pattern = new RegExp(`^${prefix}${periodPart}(\\d+)$`);

  let max = 0;
  for (const docNumber of docNumbers) {
    const match = pattern.exec(docNumber.toLowerCase());
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (value > max) max = value;
  }
  return max;
}

/**
 * The counter row to write back: never below what is stored, so a resync cannot rewind and
 * re-issue a number. A YEARLY/MONTHLY counter whose stored period is stale restarts from what was
 * issued in the current period, which is what the generator's own reset would have done.
 */
export function resyncedCounter(
  config: { lastNumber: number; year: number; month: number; resetPeriod: string },
  maxIssued: number,
  period: Period,
): { lastNumber: number; year: number; month: number } {
  const samePeriod =
    config.resetPeriod === "NEVER" ||
    (config.resetPeriod === "YEARLY" && config.year === period.year) ||
    (config.resetPeriod === "MONTHLY" && config.year === period.year && config.month === period.month);
  return {
    lastNumber: samePeriod ? Math.max(config.lastNumber, maxIssued) : maxIssued,
    year: period.year,
    month: period.month,
  };
}
