import { kunciHariWib } from "@/lib/dashboard/tren";
import type { BarisJual, TitikSalesman } from "./dasbor";
import type { DasarKomisi, PeranTagih, TingkatBerikut, TingkatKomisi } from "./komisi";
import type { Perubahan, TitikBulan } from "./riwayat-penjualan";

/**
 * Angka penjualan yang DIKIRIM KE HP salesman — aturan murni, aman diimpor
 * komponen klien (hanya tipe dan fungsi tanpa Prisma). Kuerinya di
 * `penjualan-hp-queries.ts`.
 *
 * Aturan mutlak pemilik: harga dan total konsinyasi tidak pernah sampai ke
 * aplikasi salesman, tidak di layar dan tidak di payload. Jadi di HP:
 * - rupiah hanya putus + van, dan setiap total rupiah = putus + van;
 * - konsinyasi hanya sebagai pcs (pesanan konsi yang disetujui, baris bonus
 *   tidak dihitung, menurut tanggal disetujui — tanggal yang sama dengan
 *   `penjualanSalesman`).
 *
 * Total yang memuat konsi pun dibuang, bukan hanya kanal konsinya: total −
 * putus − van = konsi, dan konsi ÷ pcs konsi = harga satuan konsinyasi.
 * Perhitungan resmi kantor (komisi, target, peringkat) TIDAK berubah; yang
 * berubah hanya angka yang dibentuk untuk HP.
 */

/** Satu pesanan konsinyasi yang disetujui: pcs-nya saja, tanpa nilai. */
export type BarisPcsKonsi = { tanggal: Date; pcs: number };

/** Jumlah di HP: rupiah putus + van, konsinyasi dalam pcs. Tidak ada kunci `konsi`. */
export type JumlahHp = { putus: number; van: number; total: number; pcsKonsi: number };
export type TitikTrenHp = { tanggal: string; nilai: number };
export type TitikBulanHp = JumlahHp & { bulan: string };
export type RingkasanBulanHp = {
  bulan: string;
  jumlah: JumlahHp;
  sampaiTanggal: number | null;
  sebulanLalu: Perubahan;
  setahunLalu: Perubahan;
};

/** Omzet dengan bentuk `OmzetBulan` (komisi) — konsinyasi selalu nol. */
export type OmzetTanpaKonsi = { putus: number; konsi: 0; van: number; total: number };

/**
 * Halaman Insentif di HP. Komisi, capaian, tingkat, dan kekurangan ke tingkat
 * berikut dihitung atas putus + van (`komisiUntukHp`) — angka resmi kantor yang
 * memuat konsi akan membuka omzet konsi lewat komisi ÷ tarif atau capaian ×
 * target. `omzet.pcsKonsi` > 0 berarti layar harus berkata jujur bahwa kantor
 * ikut menghitung konsinyasi.
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

/** Baris penjualan tanpa konsinyasi — bahan setiap angka rupiah di HP. */
export function tanpaKonsi(baris: readonly BarisJual[]): BarisJual[] {
  return baris.filter((b) => b.jenis !== "konsi");
}

/** Putus + van dalam sen, supaya pecahan rupiah tidak bergeser. */
function putusVan(j: { putus: number; van: number }): number {
  return (sen(j.putus) + sen(j.van)) / 100;
}

/**
 * Jumlah untuk HP. Kunci `konsi` dan `total` masukan sengaja diabaikan — apa
 * pun yang masuk, yang keluar hanya putus, van, putus + van, dan pcs konsi.
 */
export function jumlahHp(j: { putus: number; van: number }, pcsKonsi: number): JumlahHp {
  return { putus: j.putus, van: j.van, total: putusVan(j), pcsKonsi };
}

/** Bahan perkiraan komisi di HP: omzet putus + van, konsinyasi nol. */
export function omzetTanpaKonsi(j: { putus: number; van: number }): OmzetTanpaKonsi {
  return { putus: j.putus, konsi: 0, van: j.van, total: putusVan(j) };
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

/** Grafik 30 hari di beranda: satu nilai per hari = putus + van. */
export function trenHp(titik: readonly TitikSalesman[]): TitikTrenHp[] {
  return titik.map((t) => ({ tanggal: t.tanggal, nilai: putusVan(t) }));
}

/** Grafik 12 bulan: rupiah putus + van, konsinyasi sebagai pcs bulan itu. */
export function seriHp(seri: readonly TitikBulan[], pcs: readonly BarisPcsKonsi[], hariIni: Date): TitikBulanHp[] {
  return seri.map((s) => ({ bulan: s.bulan, ...jumlahHp(s, pcsKonsiBulan(pcs, s.bulan, hariIni)) }));
}

/**
 * Apakah komisi final kantor (yang memuat konsi) BISA lebih tinggi dari
 * perkiraan HP (putus + van)? Hanya bila bulan itu ada konsinyasi DAN konsi
 * menyentuh komisinya: dasar PENJUALAN (konsi masuk nilai dasar), atau masih
 * ada tingkat tarif di atas (konsi ikut capaian). Dasar TERTAGIH tanpa tingkat
 * berikut: konsi tidak mengubah apa pun, jadi kalimat "bisa lebih tinggi"
 * tidak jujur.
 */
export function komisiBisaNaikOlehKonsi(m: {
  pcsKonsi: number;
  dasar: DasarKomisi;
  tingkatBerikut: TingkatBerikut | null;
}): boolean {
  return m.pcsKonsi > 0 && (m.dasar === "PENJUALAN" || m.tingkatBerikut !== null);
}
