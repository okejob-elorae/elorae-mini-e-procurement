/*
 * Tanggal mulai buku besar (`SystemSetting["finance.glCutoverDate"]`) — bagian
 * MURNI: pemeriksaan isian dan peringatan sebelum menyimpan. Aman untuk klien.
 *
 * Tanggal ini lantai SEMUA jurnal otomatis yang disapu: dokumen sebelum
 * tanggal ini dianggap sudah dibukukan di luar sistem dan tidak pernah
 * dijurnal oleh sapuan penjualan marketplace maupun sapuan dokumen tanpa
 * jurnal. Mengubahnya mengubah apa yang dianggap "kurang jurnal".
 */

import type { KodeGalatPeriode } from "./periode";

const POLA = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" yang benar-benar ada di kalender (2026-02-31 ditolak). */
export function tanggalMulaiSah(teks: string | null | undefined): string | null {
  const t = (teks ?? "").trim();
  if (!POLA.test(t)) return null;
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;
  return t;
}

export type PeriksaTanggalMulai =
  | { ok: true; tanggal: string }
  | { ok: false; kode: Extract<KodeGalatPeriode, "TANGGAL_TIDAK_SAH" | "TANGGAL_SAMA" | "SUDAH_ADA_PERIODE_DITUTUP"> };

/**
 * Isian tanggal mulai baru. Ditolak bila sudah ada bulan yang ditutup:
 * buku yang sudah ditutup tidak boleh dipindah lantainya — memundurkannya
 * membuat sapuan menjurnal dokumen lama ke bulan terbuka (salah periode),
 * memajukannya membuat dokumen yang sudah dilaporkan dianggap tidak pernah ada.
 */
export function periksaTanggalMulaiBaru(
  isian: string | null | undefined,
  ctx: { tanggalLama: string | null; adaPeriodeTertutup: boolean },
): PeriksaTanggalMulai {
  const tanggal = tanggalMulaiSah(isian);
  if (!tanggal) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  if (ctx.tanggalLama === tanggal) return { ok: false, kode: "TANGGAL_SAMA" };
  if (ctx.adaPeriodeTertutup) return { ok: false, kode: "SUDAH_ADA_PERIODE_DITUTUP" };
  return { ok: true, tanggal };
}

export type DampakTanggalMulai = {
  /** Jurnal otomatis berlaku yang tanggalnya SEBELUM tanggal baru — tetap di buku. */
  jurnalOtomatisSebelum: number;
  /** Dokumen sejak tanggal baru yang belum berjurnal (per jenis) — akan disapu. */
  dokumenAkanDisapu: { label: string; jumlah: number }[];
  /** Ada jenis yang jumlahnya terpotong batas hitung. */
  terpotong: boolean;
};

export type PeringatanTanggalMulai =
  | { kunci: "pertamaKali" }
  | { kunci: "mundur" }
  | { kunci: "maju" }
  | { kunci: "masaDepan" }
  | { kunci: "adaJurnalSebelum"; n: number }
  | { kunci: "akanDisapu"; n: number };

/**
 * Peringatan yang WAJIB dibaca sebelum menyimpan (urut penting dulu).
 * `hariIni` = "YYYY-MM-DD" WIB.
 */
export function peringatanTanggalMulai(
  baru: string,
  lama: string | null,
  hariIni: string,
  dampak: DampakTanggalMulai,
): PeringatanTanggalMulai[] {
  const hasil: PeringatanTanggalMulai[] = [];
  if (!lama) hasil.push({ kunci: "pertamaKali" });
  else if (baru < lama) hasil.push({ kunci: "mundur" });
  else hasil.push({ kunci: "maju" });
  if (baru > hariIni) hasil.push({ kunci: "masaDepan" });
  if (dampak.jurnalOtomatisSebelum > 0) hasil.push({ kunci: "adaJurnalSebelum", n: dampak.jurnalOtomatisSebelum });
  const disapu = dampak.dokumenAkanDisapu.reduce((s, d) => s + d.jumlah, 0);
  if (disapu > 0) hasil.push({ kunci: "akanDisapu", n: disapu });
  return hasil;
}
