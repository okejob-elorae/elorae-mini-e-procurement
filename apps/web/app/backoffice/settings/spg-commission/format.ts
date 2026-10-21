/** Money on this page is whole rupiah, always id-ID grouped like every other money figure in the app. */
export function formatRupiah(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

/** A `"YYYY-MM"` key as a localised month name; UTC on both sides so the host timezone never shifts it. */
export function formatYearMonth(yearMonth: string, locale: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

export function formatSavedDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

/** Digits only, capped at 13: the most a `DECIMAL(15, 2)` column holds as whole rupiah. */
export function sanitizeAmountInput(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 13);
}
