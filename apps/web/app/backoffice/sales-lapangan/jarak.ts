/**
 * Jarak check-in untuk dibaca atasan: meter di bawah 1 km, kilometer di atasnya,
 * selalu dengan pemisah ribuan menurut bahasa layar. "574173 m" → "574 km".
 */
export function jarakTeks(meter: number, locale: string): string {
  const fmt = (n: number, digit: number) =>
    new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: digit }).format(n);
  if (!Number.isFinite(meter)) return "—";
  const m = Math.max(0, meter);
  if (m < 1000) return `${fmt(Math.round(m), 0)} m`;
  const km = m / 1000;
  return `${fmt(km, km < 10 ? 1 : 0)} km`;
}

/** Angka mentah di parameter tanda check-in diberi pemisah ribuan; jarak luar radius diberi satuannya sendiri. */
export function paramTandaTampil(
  kode: string,
  param: Record<string, string | number> | undefined,
  locale: string,
): Record<string, string | number> {
  const hasil: Record<string, string | number> = { ...(param ?? {}) };
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 1 });
  for (const [k, v] of Object.entries(hasil)) if (typeof v === "number") hasil[k] = angka.format(v);
  if (kode === "LUAR_RADIUS" && typeof param?.jarak === "number") hasil.jarak = jarakTeks(param.jarak, locale);
  return hasil;
}
