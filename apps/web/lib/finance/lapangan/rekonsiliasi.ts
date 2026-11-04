/*
 * Rekonsiliasi piutang toko — perhitungan MURNI (aman untuk komponen klien).
 * Datanya dibaca `rekonsiliasi-queries.ts`.
 *
 *   harapan buku besar = Σ sisa piutang modul − kredit retur yang belum dipotong toko
 *   selisih            = saldo AR_STORE buku besar − harapan
 *
 * Toleransi: modul membulatkan sisa SETIAP faktur ke rupiah penuh
 * (`hitungSisaPiutang`), sedangkan buku besar menyimpan sen. Selisih sampai
 * Rp0,50 per faktur adalah pembulatan, bukan kesalahan.
 */

export type BarisRekonsiliasiToko = {
  storeId: string;
  storeName: string;
  /** Saldo akun AR_STORE (debit − kredit) untuk toko ini. */
  bukuBesar: number;
  /** Σ sisa piutang modul (dihitung ulang). */
  modul: number;
  /** Σ kredit retur yang sudah dijurnal tetapi belum dipotong toko di BKM terverifikasi. */
  kreditRetur: number;
  /**
   * Bagian `modul` yang tidak lahir dari jurnal lapangan: faktur impor/manual
   * dan nota sebelum tanggal mulai (seharusnya tercakup jurnal saldo awal), atau
   * nota/faktur yang jurnalnya belum berhasil diposting. Penjelas, tidak ikut rumus.
   */
  diLuarJurnal: number;
  jumlahPiutang: number;
};

export type BarisRekonsiliasiHitung = BarisRekonsiliasiToko & {
  harapan: number;
  selisih: number;
  toleransi: number;
  cocok: boolean;
};

export type RekonsiliasiPiutang = {
  akun: { id: string; kode: string; nama: string } | null;
  /** "YYYY-MM-DD" atau null bila tanggal mulai buku besar belum ditetapkan. */
  tanggalMulai: string | null;
  baris: BarisRekonsiliasiHitung[];
  /** Saldo akun yang sama pada baris jurnal TANPA toko (jurnal lain yang memakai akun ini). */
  tanpaToko: number;
  total: {
    bukuBesar: number;
    modul: number;
    kreditRetur: number;
    diLuarJurnal: number;
    selisih: number;
    tokoTidakCocok: number;
  };
};

const sen = (n: number) => Math.round(n * 100);
const rp = (s: number) => s / 100;

export function toleransiPembulatan(jumlahPiutang: number): number {
  return 0.5 * Math.max(1, jumlahPiutang);
}

export function hitungBarisRekonsiliasi(b: BarisRekonsiliasiToko): BarisRekonsiliasiHitung {
  const harapan = sen(b.modul) - sen(b.kreditRetur);
  const selisih = sen(b.bukuBesar) - harapan;
  const toleransi = toleransiPembulatan(b.jumlahPiutang);
  return { ...b, harapan: rp(harapan), selisih: rp(selisih), toleransi, cocok: Math.abs(selisih) <= sen(toleransi) };
}

export function ringkasRekonsiliasi(input: {
  akun: RekonsiliasiPiutang["akun"];
  tanggalMulai: string | null;
  baris: BarisRekonsiliasiToko[];
  tanpaToko: number;
}): RekonsiliasiPiutang {
  const baris = input.baris
    .map(hitungBarisRekonsiliasi)
    .sort((a, b) => Number(a.cocok) - Number(b.cocok) || Math.abs(b.selisih) - Math.abs(a.selisih) || a.storeName.localeCompare(b.storeName, "id"));
  const jumlah = (f: (b: BarisRekonsiliasiHitung) => number) => rp(baris.reduce((s, b) => s + sen(f(b)), 0));
  return {
    akun: input.akun,
    tanggalMulai: input.tanggalMulai,
    baris,
    tanpaToko: input.tanpaToko,
    total: {
      bukuBesar: jumlah((b) => b.bukuBesar),
      modul: jumlah((b) => b.modul),
      kreditRetur: jumlah((b) => b.kreditRetur),
      diLuarJurnal: jumlah((b) => b.diLuarJurnal),
      selisih: jumlah((b) => b.selisih),
      tokoTidakCocok: baris.filter((b) => !b.cocok).length,
    },
  };
}
