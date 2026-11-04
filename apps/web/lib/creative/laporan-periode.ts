/**
 * Pilihan periode Laporan Ruang KOL (Peringkat & Rekap) — murni, aman untuk
 * klien. Semua hari WIB "YYYY-MM-DD".
 *
 * Chip: Hari ini · 7 hari · 30 hari · Bulan ini · Bulan lalu · Semua ·
 * Rentang. "Rentang" tanpa tanggal yang sah langsung terisi 30 hari terakhir
 * (pola KOL Manager), supaya memilihnya tidak pernah menghasilkan layar kosong.
 * "Semua" = tanpa batas (`null`); Rekap yang butuh tanggal awal memakai hari
 * KOL pertama dibuat.
 */

import { bacaTanggal, rentangCepat, urutkanRentang, type Rentang } from "@/lib/tanggal-isian";

export type PilihanPeriode = "hariIni" | "tujuhHari" | "tigaPuluhHari" | "bulanIni" | "bulanLalu" | "semua" | "rentang";

export const PILIHAN_PERIODE: readonly PilihanPeriode[] = [
  "hariIni",
  "tujuhHari",
  "tigaPuluhHari",
  "bulanIni",
  "bulanLalu",
  "semua",
  "rentang",
];

export function bacaPilihanPeriode(v: unknown, bawaan: PilihanPeriode): PilihanPeriode {
  return typeof v === "string" && (PILIHAN_PERIODE as readonly string[]).includes(v) ? (v as PilihanPeriode) : bawaan;
}

/** Rentang sebuah pilihan, atau `null` untuk "Semua" (tanpa batas). */
export function periodeDari(input: { pilihan: PilihanPeriode; dari?: string | null; sampai?: string | null; hariIni: string }): Rentang | null {
  const { pilihan, hariIni } = input;
  switch (pilihan) {
    case "semua":
      return null;
    case "rentang": {
      const a = input.dari?.trim() ?? "";
      const b = input.sampai?.trim() ?? "";
      if (bacaTanggal(a) && bacaTanggal(b)) return urutkanRentang(a, b);
      if (bacaTanggal(a)) return urutkanRentang(a, a);
      return rentangCepat("tigaPuluhHari", hariIni);
    }
    default:
      return rentangCepat(pilihan, hariIni);
  }
}

/**
 * Rentang untuk rekap: "Semua" menjadi sejak hari KOL pertama dibuat sampai
 * hari ini (atau hari ini saja bila belum ada KOL).
 */
export function periodeRekap(periode: Rentang | null, awalSemua: string | null, hariIni: string): Rentang {
  if (periode) return periode;
  const awal = awalSemua && bacaTanggal(awalSemua) && awalSemua <= hariIni ? awalSemua : hariIni;
  return { dari: awal, sampai: hariIni };
}

/** Parameter URL sebuah periode — yang bawaan tidak ditulis. */
export function paramPeriode(pilihan: PilihanPeriode, rentang: Rentang | null, bawaan: PilihanPeriode): Record<string, string> {
  if (pilihan === "rentang" && rentang) return { periode: "rentang", dari: rentang.dari, sampai: rentang.sampai };
  return pilihan === bawaan ? {} : { periode: pilihan };
}
