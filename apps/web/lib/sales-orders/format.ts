import { formatRupiah } from "@/lib/format/rupiah";

/** Sama dengan `formatRupiah` — dipertahankan untuk pemakai lama. */
export function formatIDR(value: string | number | null | undefined): string {
  return formatRupiah(value === "" ? 0 : value);
}

/** Format in Asia/Jakarta so list dates match WIB-anchored date filters. */
export function formatDateTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
