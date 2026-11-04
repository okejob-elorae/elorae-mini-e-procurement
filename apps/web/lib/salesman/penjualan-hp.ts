import { kunciHariWib } from "@/lib/dashboard/tren";
import type { TitikSalesman } from "./dasbor";
import type { DasarKomisi, PeranTagih, TingkatBerikut, TingkatKomisi } from "./komisi";
import type { Perubahan, TitikBulan } from "./riwayat-penjualan";

/**
 * Angka penjualan yang DIKIRIM KE HP salesman — aturan murni, aman diimpor
 * komponen klien (hanya tipe dan fungsi tanpa Prisma). Kuerinya di
 * `penjualan-hp-queries.ts`.
 *
 * Jawaban pemilik 2026-11-02 (P18 "berikan selengkapnya saja", P56 "tampilkan
 * semuanya saja — rupiah konsi juga di omzet/insentif/target/peringkat"): angka
 * di HP salesman ADALAH angka kantor. Rupiah = putus + konsinyasi LAKU + van;
 * konsinyasi juga tetap ditunjukkan sebagai pcs laku. Nilai konsi = penilaian
 * kantor yang sudah ada (`penjualan-konsi.ts`: laku dengan harga Elorae, milik
 * pemegang toko saat barangnya laku). HP SPG tidak membaca berkas ini.
 */

/** Satu gerakan laku konsinyasi: pcs-nya saja, tanpa nilai. */
export type BarisPcsKonsi = { tanggal: Date; pcs: number };

/** Jumlah di HP: rupiah putus, konsinyasi laku, dan van; `total` = ketiganya; konsinyasi juga dalam pcs. */
export type JumlahHp = { putus: number; konsi: number; van: number; total: number; pcsKonsi: number };
export type TitikTrenHp = { tanggal: string; nilai: number };
export type TitikBulanHp = JumlahHp & { bulan: string };
export type RingkasanBulanHp = {
  bulan: string;
  jumlah: JumlahHp;
  sampaiTanggal: number | null;
  sebulanLalu: Perubahan;
  setahunLalu: Perubahan;
};

/**
 * Halaman Insentif di HP: `komisiSalesman` atas omzet resmi (putus + konsi +
 * van), jadi angkanya sama dengan laporan komisi kantor (P56).
 */
export type InsentifHp = {
  aktif: boolean;
  dasar: DasarKomisi;
  komisi: number;
  dasarNilai: number;
  tarifDasar: number;
  tarifDipakai: number;
  capaianPersen: number | null;
  target: number | null;
  omzet: JumlahHp;
  tingkat: (TingkatKomisi & { tercapai: boolean })[];
  tingkatBerikut: TingkatBerikut | null;
  bagianPenagihPersen: number;
  tertagih: { bagianPenjual: number; bagianPenagih: number; total: number };
  baris: {
    kunci: string;
    docNo: string;
    toko: string;
    invoiceNo: string;
    /** Tanggal verifikasi, sudah diformat di server. */
    tanggal: string;
    nilai: number;
    dilunasi: number;
    peran: PeranTagih;
    bagian: number;
  }[];
};

const sen = (n: number) => Math.round(n * 100);

/** Putus + konsi + van dalam sen, supaya pecahan rupiah tidak bergeser. */
function jumlahRupiah(j: { putus: number; konsi: number; van: number }): number {
  return (sen(j.putus) + sen(j.konsi) + sen(j.van)) / 100;
}

/** Jumlah untuk HP: setiap kanal rupiah, totalnya, dan pcs konsinyasi laku. */
export function jumlahHp(j: { putus: number; konsi: number; van: number }, pcsKonsi: number): JumlahHp {
  return { putus: j.putus, konsi: j.konsi, van: j.van, total: jumlahRupiah(j), pcsKonsi };
}

/** Pcs konsinyasi satu bulan kalender WIB; hari sesudah hari ini (WIB) tidak dihitung. */
export function pcsKonsiBulan(baris: readonly BarisPcsKonsi[], bulan: string, hariIni: Date): number {
  const batas = kunciHariWib(hariIni);
  let n = 0;
  for (const b of baris) {
    const k = kunciHariWib(b.tanggal);
    if (k.startsWith(bulan) && k <= batas) n += b.pcs;
  }
  return n;
}

/** Grafik beranda: satu nilai per hari = putus + konsi + van. */
export function trenHp(titik: readonly TitikSalesman[]): TitikTrenHp[] {
  return titik.map((t) => ({ tanggal: t.tanggal, nilai: jumlahRupiah(t) }));
}

/** Grafik 12 bulan: rupiah putus + konsi + van, ditambah pcs konsinyasi bulan itu. */
export function seriHp(seri: readonly TitikBulan[], pcs: readonly BarisPcsKonsi[], hariIni: Date): TitikBulanHp[] {
  return seri.map((s) => ({ bulan: s.bulan, ...jumlahHp(s, pcsKonsiBulan(pcs, s.bulan, hariIni)) }));
}
