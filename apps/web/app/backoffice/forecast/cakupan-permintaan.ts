// Cakupan permintaan yang benar-benar dibaca `runForecast` (murni, tanpa basis data).
import { wibMonthStart } from "@/lib/forecast/marketplace-demand";
import type { DemandRow } from "@/lib/forecast/types";

/** Sama dengan `@default(12)` pada `ForecastConfig.lookbackMonths`: tahun tanpa konfigurasi dibuat dengan nilai ini saat forecast dijalankan. */
export const LOOKBACK_BAWAAN = 12;

/**
 * `lookbackMonths` bulan kalender WIB sebelum `targetYear`, sebagai rentang UTC tertutup —
 * jendela yang sama dengan yang dibaca `runForecast`.
 */
export function jendelaLookback(targetYear: number, lookbackMonths: number): { start: Date; end: Date } {
  const startIndex = targetYear * 12 - lookbackMonths;
  const start = wibMonthStart(Math.floor(startIndex / 12), (startIndex % 12) + 1);
  const end = new Date(wibMonthStart(targetYear, 1).getTime() - 1);
  return { start, end };
}

/**
 * Banyaknya bulan WIB yang permintaan bersihnya positif, dijumlah lintas semua sumber
 * (impor Excel, penjualan offline, pesanan marketplace, laporan konsinyasi). Bulan yang
 * isinya hanya retur (bersih ≤ 0) tidak dihitung sebagai bulan berpenjualan.
 */
export function hitungBulanBerpermintaan(
  rows: readonly Pick<DemandRow, "year" | "month" | "netQuantity">[]
): number {
  const perBulan = new Map<string, number>();
  for (const r of rows) {
    const kunci = `${r.year}-${r.month}`;
    perBulan.set(kunci, (perBulan.get(kunci) ?? 0) + r.netQuantity);
  }
  let bulan = 0;
  for (const qty of perBulan.values()) if (qty > 0) bulan++;
  return bulan;
}
