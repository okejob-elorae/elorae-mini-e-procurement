export function normalizeBarcode(raw: string): string {
  return raw.replace(/[\x00-\x1f\x7f]/g, "").trim();
}

export function barcodesMatch(start: string, end: string): boolean {
  const a = normalizeBarcode(start);
  const b = normalizeBarcode(end);
  return a !== "" && a.toLowerCase() === b.toLowerCase();
}
