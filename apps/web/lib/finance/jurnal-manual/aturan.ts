import { KODE_GALAT_TEMPLAT } from "@/lib/finance/berulang/aturan";

/*
 * Jurnal manual dengan persetujuan (maker-checker) dan pembalikan — bagian
 * MURNI (rancangan akuntansi & pajak lengkap, bagian D4; keputusan sementara
 * pemilik no. 39). Aman untuk komponen klien.
 *
 * Alur:
 *   DRAFT (dibuat / diubah pembuatnya) ──setujui (orang LAIN)──▶ POSTED
 *        └─tolak (orang lain, beralasan) / tarik (pembuatnya)──▶ REJECTED
 * - Pembuat (`Journal.postedById`) TIDAK PERNAH bisa menyetujui jurnalnya
 *   sendiri — admin pun tidak (sama dengan `PEMERIKSA_SAMA` pada BKM).
 * - Menyetujui mengunci periode tanggal jurnalnya (`lockPeriodForPosting`) dan
 *   menolak bila bulannya sudah ditutup.
 * - Hanya pembuatnya yang boleh mengubah drafnya; draf pembalik tidak bisa
 *   diubah (barisnya harus cermin jurnal aslinya) — tarik lalu ajukan ulang.
 * - Jurnal yang sudah POSTED tidak pernah dihapus atau diubah. Membatalkannya =
 *   tombol "Balik": draf jurnal pembalik (debit ↔ kredit) bertanggal pilihan,
 *   `reversalOfId` = jurnal aslinya, lewat persetujuan yang sama. Satu jurnal
 *   hanya bisa dibalik sekali (`reversalOfId` unik); pembalik yang ditolak
 *   melepas tautannya supaya bisa diajukan lagi.
 */

export const KODE_GALAT_JURNAL_MANUAL = [
  ...KODE_GALAT_TEMPLAT,
  "KETERANGAN_WAJIB",
  "TANGGAL_TIDAK_SAH",
  "NON_POSTABLE_ACCOUNT",
  "PERIOD_CLOSED",
  "TIDAK_DITEMUKAN",
  "BUKAN_JURNAL_MANUAL",
  "BUKAN_DRAF",
  "PEMBUAT_SAMA",
  "HANYA_PEMBUAT",
  "ALASAN_WAJIB",
  "PEMBALIK_TIDAK_BISA_DIUBAH",
  "TIDAK_BISA_DIBALIK",
  "SUDAH_DIBALIK",
  "PEMBALIK_MENUNGGU",
  "TANGGAL_SEBELUM_ASLI",
  "ASLI_TIDAK_BERLAKU",
  "TANPA_AKSES",
  "GAGAL",
] as const;

export type KodeGalatJurnalManual = (typeof KODE_GALAT_JURNAL_MANUAL)[number];

/** Panjang minimum alasan penolakan / pembalikan. */
export const MIN_ALASAN_JURNAL = 5;

export function alasanJurnalCukup(alasan: string | null | undefined): boolean {
  return (alasan ?? "").trim().length >= MIN_ALASAN_JURNAL;
}

/** Jurnal berulang (`RECURRING`) boleh dibalik seperti jurnal manual — pembaliknya jurnal manual. */
export const SUMBER_BOLEH_DIBALIK: readonly string[] = ["RECURRING"];

export function jenisBolehDibalik(j: { isManual: boolean; sourceType: string | null }): boolean {
  return j.isManual || (j.sourceType != null && SUMBER_BOLEH_DIBALIK.includes(j.sourceType));
}

export type BarisCermin = { chartAccountId: string; debit: number; credit: number; memo: string | null; channel: string | null; storeId: string | null };

/** Baris pembalik: debit ↔ kredit, memo/kanal/toko sama. */
export function barisPembalik(baris: BarisCermin[]): BarisCermin[] {
  return baris.map((b) => ({ ...b, debit: b.credit, credit: b.debit }));
}

/**
 * Tombol yang tampil untuk penonton sebuah jurnal. Murni supaya layar dan tes
 * memakai aturan yang sama dengan penulisnya.
 */
export function aksiJurnalManual(isi: {
  status: string;
  isManual: boolean;
  sourceType: string | null;
  pembuatId: string;
  penontonId: string;
  bolehMengelola: boolean;
  /** Ada pembalik (draf atau terposting) yang menunjuk jurnal ini. */
  adaPembalik: boolean;
  /** Jurnal ini sendiri draf pembalik. */
  adalahPembalik: boolean;
}): { setujui: boolean; tolak: boolean; tarik: boolean; ubah: boolean; balik: boolean; alasanTidakBisaSetujui: "PEMBUAT_SAMA" | null } {
  const draf = isi.status === "DRAFT" && isi.isManual;
  const pembuat = isi.pembuatId === isi.penontonId;
  return {
    setujui: isi.bolehMengelola && draf && !pembuat,
    tolak: isi.bolehMengelola && draf && !pembuat,
    tarik: isi.bolehMengelola && draf && pembuat,
    ubah: isi.bolehMengelola && draf && pembuat && !isi.adalahPembalik,
    balik: isi.bolehMengelola && isi.status === "POSTED" && jenisBolehDibalik(isi) && !isi.adaPembalik,
    alasanTidakBisaSetujui: draf && pembuat ? "PEMBUAT_SAMA" : null,
  };
}
