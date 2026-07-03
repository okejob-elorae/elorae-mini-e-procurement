/**
 * Pantone TCX code normalization helpers (fan-deck jump, tcx parsing).
 */

const TCX_PATTERN = /(\d{2}-\d{4})/;

/** Strip prefixes/suffixes and return canonical tcx like "11-0103". */
export function normalizeTcxCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const direct = trimmed.match(/^(\d{2}-\d{4})$/);
  if (direct) return direct[1]!;

  const embedded = trimmed.match(TCX_PATTERN);
  return embedded ? embedded[1]! : null;
}

export function sectionFromTcx(tcx: string): number | null {
  const part = tcx.split("-")[0];
  if (!part) return null;
  const n = parseInt(part, 10);
  return Number.isFinite(n) ? n : null;
}
