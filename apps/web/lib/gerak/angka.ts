/**
 * Angka yang berhitung naik (`components/gerak/AngkaNaik`).
 *
 * Murni — tidak menyentuh DOM atau waktu — supaya kurva dan pembulatannya bisa
 * diuji tanpa peramban.
 */

/** Cukup lama untuk terlihat bergerak, cukup singkat untuk tidak ditunggu. */
export const DURASI_ANGKA_MS = 600;

/** Kubik keluar: cepat di awal, melambat di akhir. Masukan dijepit 0–1. */
export function pelanKeluar(k: number): number {
  // NaN dianggap selesai: lebih baik langsung tampil angka akhir daripada macet.
  if (Number.isNaN(k) || k >= 1) return 1;
  if (k <= 0) return 0;
  return 1 - Math.pow(1 - k, 3);
}

/** Bagian waktu yang sudah lewat (0–1). Durasi ≤ 0 berarti langsung selesai. */
export function kemajuan(mulai: number, sekarang: number, durasi: number): number {
  if (!(durasi > 0)) return 1;
  const k = (sekarang - mulai) / durasi;
  if (k <= 0) return 0;
  return k >= 1 ? 1 : k;
}

/**
 * Nilai yang tampil pada kemajuan `k` dari `dari` ke `ke`.
 *
 * Target bulat (jumlah dokumen, unit, rupiah utuh) hanya melewati bilangan
 * bulat — tanpa ini hitungan "3 PO" sempat terbaca "2,999" di tengah gerak.
 */
export function angkaPada(dari: number, ke: number, k: number): number {
  if (k >= 1) return ke;
  const v = dari + (ke - dari) * pelanKeluar(k);
  return Number.isInteger(ke) ? Math.round(v) : v;
}

/**
 * Angka yang dilukis pertama kali.
 *
 * Server dan hidrasi: angka akhir (HTML server sudah memuatnya). Dipasang di
 * klien tanpa hidrasi (dibuka lewat menu): nol, karena gerak akan naik dari
 * nol — bila mulai dari angka akhir, angka itu sempat terlukis sekejap lalu
 * turun ke nol. Kurangi gerakan: angka akhir.
 */
export function tampilAwal(p: { sedangHidrasi: boolean; kurangiGerak: boolean; nilai: number }): number {
  return p.sedangHidrasi || p.kurangiGerak ? p.nilai : 0;
}

export type AwalGerak = { jenis: "diam" } | { jenis: "tunggu-tirai" } | { jenis: "jalan"; dari: number };

/**
 * Apa yang dilakukan angka saat `nilai` diterima.
 *
 * Sesudah gerak pertama (`sudahMulai`), gerak selalu berangkat dari angka yang
 * SEDANG terlihat — bukan dari nilai lama — supaya pembaruan di tengah gerak
 * melanjutkan, tidak melompat balik, dan nilai yang kembali ke nilai lama
 * tidak membuat layar tertinggal di angka antara.
 */
export function awalGerak(p: {
  kurangiGerak: boolean;
  sudahMulai: boolean;
  lahirSaatHidrasi: boolean;
  adaTirai: boolean;
  tampil: number;
  nilai: number;
}): AwalGerak {
  if (p.kurangiGerak) return { jenis: "diam" };
  if (p.sudahMulai) return p.tampil === p.nilai ? { jenis: "diam" } : { jenis: "jalan", dari: p.tampil };
  if (!p.lahirSaatHidrasi) return { jenis: "jalan", dari: 0 };
  if (p.adaTirai) return { jenis: "tunggu-tirai" };
  return { jenis: "diam" };
}
