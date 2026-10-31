import { geserHari, bacaTanggal } from "@/lib/tanggal-isian";

/*
 * Tanggal jurnal saldo awal dan kunci periode — murni.
 *
 * KEPUTUSAN SEMENTARA (2026-10-08, usulan Claude): jurnal saldo awal
 * bertanggal SEHARI SEBELUM tanggal mulai buku besar (tanggal mulai 1 Agu →
 * jurnal 31 Jul), seperti saldo awal uji akuntansi. Saldo awal adalah posisi
 * pada AWAL hari mulai; laporan yang dimulai pada tanggal mulai membacanya
 * sebagai saldo awal, bukan sebagai mutasi periode.
 */

export function tanggalJurnalSaldoAwal(tanggalMulai: string): string {
  return geserHari(tanggalMulai, -1);
}

export type BarisPeriode = { year: number; month: number; status: string };
export type BarisTahun = { year: number; status: string };

export type PeriodeTertutup = { tahun: number; bulan: number | null };

/**
 * Periode tertutup paling awal yang ikut berubah bila jurnal bertanggal
 * `tanggal` (YYYY-MM-DD) diposting atau dibalik: periode itu sendiri ATAU
 * periode mana pun sesudahnya (saldo awal mengalir ke neraca setiap bulan
 * berikutnya). Tahun yang ditutup dihitung tertutup seluruhnya. Null = bebas.
 */
export function periodeTertutupSejak(
  tanggal: string,
  periode: readonly BarisPeriode[],
  tahun: readonly BarisTahun[] = [],
): PeriodeTertutup | null {
  const t = bacaTanggal(tanggal);
  if (!t) return null;
  const awal = t.tahun * 12 + (t.bulan - 1);
  let terawal: PeriodeTertutup | null = null;
  let nilaiTerawal = Number.POSITIVE_INFINITY;
  for (const p of periode) {
    if (p.status !== "CLOSED") continue;
    const n = p.year * 12 + (p.month - 1);
    if (n >= awal && n < nilaiTerawal) {
      nilaiTerawal = n;
      terawal = { tahun: p.year, bulan: p.month };
    }
  }
  for (const y of tahun) {
    if (y.status !== "CLOSED") continue;
    const n = y.year * 12; // Januari tahun itu
    const mulai = Math.max(n, awal);
    if (y.year >= t.tahun && mulai < nilaiTerawal) {
      nilaiTerawal = mulai;
      terawal = { tahun: y.year, bulan: null };
    }
  }
  return terawal;
}
