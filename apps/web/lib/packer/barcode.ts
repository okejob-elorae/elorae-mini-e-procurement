export function normalizeBarcode(raw: string): string {
  return raw.replace(/[\x00-\x1f\x7f]/g, "").trim();
}

/** Canonical form for pool / start / end matching. */
export function normalizeScanCode(raw: string): string {
  return normalizeBarcode(raw).toUpperCase();
}

/**
 * True for payloads that look like a real resi / AWB.
 * Rejects OCR/barcode noise like "V- - _ L".
 */
export function isAcceptableScanCode(raw: string): boolean {
  return extractTrackingCandidate(raw) !== "";
}

/**
 * Pull a trusted tracking token from a raw decode.
 * Prefers long digit runs (Shopee) or courier-style letter+digits.
 */
export function extractTrackingCandidate(raw: string): string {
  const n = normalizeScanCode(raw);
  if (!n) return "";

  // Longest digit run first (Shopee Sameday / many marketplace barcodes).
  const digitRuns = [...n.matchAll(/\d{10,}/g)].map((m) => m[0]!);
  if (digitRuns.length > 0) {
    digitRuns.sort((a, b) => b.length - a.length);
    return digitRuns[0]!;
  }

  // Compact token only: A-Z / 0-9 / hyphen, no spaces or junk punctuation.
  const compact = n.replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{8,}$/.test(compact)) return "";
  if (/[--]{2,}|^-|-$/.test(compact)) return "";

  const digits = (compact.match(/\d/g) ?? []).length;
  // Courier AWB: JY1064321101 / SPXID1234567890
  if (/^[A-Z]{1,6}\d{8,}$/.test(compact)) return compact;
  // Mostly digits with optional short prefix/suffix
  if (digits >= 10 && compact.length >= 10) return compact;

  return "";
}

/**
 * Min length of the shorter side for fuzzy/LIKE match.
 * Avoids short noise matching many resi (e.g. "1100").
 */
export const TRACKING_FUZZY_MIN_LEN = 8;

/**
 * Match scanned barcode to stored trackingNumber.
 * Exact match, or LIKE-style: one contains the other when shorter side is long enough.
 * Example: scan `11004268889737` matches DB `SPX11004268889737`.
 */
export function trackingCodesMatch(a: string, b: string): boolean {
  return scoreTrackingMatch(a, b) > 0;
}

/** Higher score = better match. 0 = no match. */
export function scoreTrackingMatch(scannedRaw: string, trackingRaw: string): number {
  const scannedToken = extractTrackingCandidate(scannedRaw);
  const trackingFull = normalizeScanCode(trackingRaw);
  if (!scannedToken || !trackingFull) return 0;

  // Perfect: full tracking equals scanned token (no courier prefix on DB side).
  if (trackingFull === scannedToken) return 1000;

  const trackingToken = extractTrackingCandidate(trackingRaw);
  // Prefixed DB resi whose digit core equals scan.
  if (trackingToken && trackingToken === scannedToken) {
    if (trackingFull.endsWith(scannedToken)) return 850;
    if (trackingFull.includes(scannedToken)) return 750;
  }

  const shorter =
    scannedToken.length <= trackingFull.length ? scannedToken : trackingFull;
  const longer =
    scannedToken.length <= trackingFull.length ? trackingFull : scannedToken;
  if (shorter.length < TRACKING_FUZZY_MIN_LEN) return 0;
  if (!longer.includes(shorter)) return 0;

  if (longer.endsWith(shorter)) return 500 + shorter.length;
  if (longer.startsWith(shorter)) return 400 + shorter.length;
  return 200 + shorter.length;
}

/** Start/end (and pool) matching — allows prefix/suffix LIKE. */
export function barcodesMatch(start: string, end: string): boolean {
  return trackingCodesMatch(start, end);
}

/** Pick best candidate whose trackingNumber matches the scanned barcode. */
export function pickBestTrackingMatch<T>(
  items: T[],
  scannedRaw: string,
  getTracking: (item: T) => string,
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  let bestLen = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const tracking = getTracking(item);
    const score = scoreTrackingMatch(scannedRaw, tracking);
    if (score <= 0) continue;
    const len = normalizeScanCode(tracking).length;
    // Higher score wins; on tie prefer shorter/exact tracking.
    if (score > bestScore || (score === bestScore && len < bestLen)) {
      bestScore = score;
      bestLen = len;
      best = item;
    }
  }
  return best;
}
