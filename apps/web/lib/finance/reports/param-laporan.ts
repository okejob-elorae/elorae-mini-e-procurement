import { bacaKanalJurnal, type KanalJurnal } from "@/lib/finance/journals/kanal";
import { awalBulanIni, tanggalSah, type RentangTanggal } from "./periode-banding";

/*
 * Parameter alamat halaman laporan perbandingan, rasio, laba per kanal, dan
 * anggaran — satu pembaca untuk halaman, aksi, dan cetak supaya ketiganya
 * memakai periode yang sama. Murni, aman untuk komponen klien.
 */

/**
 * Periode laporan: isian kosong = bulan berjalan (tanggal 1 s.d. hari ini WIB);
 * hanya "sampai" = tanggal 1 bulan itu s.d. tanggal itu; terbalik = ditukar.
 */
export function periodeBulanBerjalan(isian: { dari?: string | null; sampai?: string | null }, hariIni: string): RentangTanggal {
  const sampai = tanggalSah(isian.sampai) ?? hariIni;
  const dari = tanggalSah(isian.dari) ?? awalBulanIni(sampai);
  return dari <= sampai ? { dari, sampai } : { dari: sampai, sampai: dari };
}

export type KelompokLabaKanal = "kanal" | "toko";

export function bacaKelompok(v: string | null | undefined): KelompokLabaKanal {
  return v === "toko" ? "toko" : "kanal";
}

/** Saringan kanal dari alamat (hanya nilai `KANAL_JURNAL`); selain itu semua kanal. */
export function bacaSaringKanal(v: string | null | undefined): KanalJurnal | null {
  return bacaKanalJurnal(v);
}

export type JenisPerbandingan = "laba-rugi" | "neraca";

export function bacaJenisPerbandingan(v: string | null | undefined): JenisPerbandingan {
  return v === "neraca" ? "neraca" : "laba-rugi";
}

/** Tahun dan bulan anggaran dari alamat; bawaan tahun & bulan hari ini. */
export function bacaTahunBulan(
  isian: { tahun?: string | null; bulan?: string | null; cakupan?: string | null },
  hariIni: string,
): { tahun: number; bulan: number; cakupan: "bulan" | "ytd" } {
  const [ty, tm] = hariIni.split("-").map(Number);
  const tahun = Number(isian.tahun);
  const bulan = Number(isian.bulan);
  return {
    tahun: Number.isInteger(tahun) && tahun >= 2000 && tahun <= 2100 ? tahun : ty,
    bulan: Number.isInteger(bulan) && bulan >= 1 && bulan <= 12 ? bulan : tm,
    cakupan: isian.cakupan === "bulan" ? "bulan" : "ytd",
  };
}

/** `?nol=1` = tampilkan akun bernilai nol. */
export function bacaTampilkanNol(v: string | null | undefined): boolean {
  return v === "1";
}
