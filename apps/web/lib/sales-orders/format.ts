const IDR_FORMATTER = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatIDR(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return IDR_FORMATTER.format(0);
  const n = typeof value === "string" ? Number(value) : value;
  return IDR_FORMATTER.format(Number.isFinite(n) ? n : 0);
}

export function formatDateTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
