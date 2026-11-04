/**
 * Periode Barang dicari pembeli: `?dari=&sampai=` (hari WIB, kedua ujung
 * termasuk) dari pemilih rentang yang sama dengan Penjualan SPG. Alamat lama
 * `?hari=7|30|90` tetap terbaca sebagai "N hari terakhir termasuk hari ini";
 * tanpa apa pun bawaannya 30 hari terakhir. Murni — dipakai halaman.
 */
import { awalHari, batasRentang, sahKunciHari, type Rentang } from "@/lib/salesman/metrik-lapangan";

const HARI_MS = 86_400_000;
const LAMA = [7, 30, 90] as const;
export const HARI_BAWAAN = 30;

const satu = (x: unknown): string | undefined => (Array.isArray(x) ? x[0] : typeof x === "string" ? x : undefined);

function mundur(hariIni: string, n: number): string {
  return new Date(Date.parse(`${hariIni}T00:00:00Z`) - n * HARI_MS).toISOString().slice(0, 10);
}

export function bacaPeriodeDicari(sp: { dari?: unknown; sampai?: unknown; hari?: unknown }, hariIni: string): Rentang {
  const dari = satu(sp.dari);
  const sampai = satu(sp.sampai);
  if (sahKunciHari(dari) && sahKunciHari(sampai)) return dari <= sampai ? { dari, sampai } : { dari: sampai, sampai: dari };
  const hari = Number(satu(sp.hari));
  const n = (LAMA as readonly number[]).includes(hari) ? hari : HARI_BAWAAN;
  return { dari: mundur(hariIni, n - 1), sampai: hariIni };
}

/** Batas kueri: `createdAt >= sejak` dan `< sebelum` (awal hari WIB sesudah `sampai`). */
export function batasPeriodeDicari(r: Rentang): { sejak: Date; sebelum: Date } {
  return { sejak: awalHari(r.dari), sebelum: batasRentang(r).akhir };
}
