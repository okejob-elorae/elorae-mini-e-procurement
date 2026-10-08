import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { adalahJurnalSaldoAwal, getAccountBalances, getEarliestJournal } from "./balances";
import { buildBalanceSheet, type BalanceSheet } from "./balance-sheet";
import { buildIncomeStatement } from "./income-statement";

/**
 * Neraca per tanggal — satu pemuat untuk halaman, cetak, dan Excel supaya
 * ketiganya sepakat.
 *
 * Saldo kumulatif MENYERTAKAN jurnal penutup tahun: laba tahun yang sudah
 * ditutup terbaca di akun laba ditahan. "Laba tahun berjalan" dibaca terpisah
 * dari 1 Januari tahun posisi (WIB) s.d. tanggal posisi — juga menyertakan
 * jurnal penutup, jadi tahun yang ditutup per 31 Desember terbaca nol.
 */
export async function muatNeraca(asOf: Date): Promise<{
  report: BalanceSheet;
  openingWarningDate: string | null;
  earliest: { date: Date; isManual: boolean; sourceType: string | null } | null;
}> {
  const tahun = formatDateOnlyJakarta(asOf).slice(0, 4);
  const awalTahun = parseDateOnly(`${tahun}-01-01`);
  const [kumulatif, berjalan, earliest] = await Promise.all([
    getAccountBalances({ to: asOf }, { sertakanTutupTahun: true }),
    getAccountBalances({ from: awalTahun, to: asOf }, { sertakanTutupTahun: true }),
    getEarliestJournal(),
  ]);
  const report = buildBalanceSheet(kumulatif, { labaTahunBerjalan: buildIncomeStatement(berjalan).labaBersih });
  /* Saldo awal yang sudah dicatat (manual atau wizard saldo awal) meniadakan peringatan. */
  const openingWarningDate = earliest && !adalahJurnalSaldoAwal(earliest) ? earliest.date.toISOString() : null;
  return { report, openingWarningDate, earliest };
}
