/**
 * Rekomendasi harga jual barang jadi — HANYA SARAN, tidak pernah menulis harga.
 *
 * Murni (tanpa Prisma), jadi aman diimpor komponen klien: formulir barang
 * menghitung ulang rekomendasinya sendiri setiap kali margin atau biaya
 * tambahan diketik.
 *
 * Keputusan pemilik 2026-11-01: HPP yang tampil adalah HPP sebenarnya; sistem
 * boleh memberi rekomendasi harga dengan rumus versi tim, tetapi harga jual
 * akhir tetap diketik sendiri dan tidak pernah tertimpa otomatis. Tombol
 * "Pakai rekomendasi" hanya mengisi kolom harga; harga baru tersimpan hanya
 * kalau pengguna menekan Simpan (riwayat harga mencatat `MANUAL_EDIT`).
 *
 * Rumus (versi tim, dulu di `packages/db/src/item-price-writer.ts`):
 *   harga = HPP terbaru × (1 + margin ÷ 100) + biaya tambahan per pcs,
 *   dibulatkan ke sen.
 * - HPP terbaru = HPP per pcs peristiwa biaya terbaru barang ini
 *   (`hppTerbaruDari` di `./riwayat-hpp.ts`), bukan rata-rata stok.
 * - Margin = target margin barang; kosong → margin bawaan di Pengaturan
 *   Jubelio; keduanya kosong → tidak ada rekomendasi.
 * - Biaya tambahan = biaya tambahan barang; kosong → bawaan; kosong → 0.
 *   Biaya tambahan per pcs di WO sudah termasuk HPP, jadi yang ini adalah
 *   biaya DI LUAR HPP.
 */
import { Decimal } from "decimal.js";
import { formatRupiah } from "@/lib/format/rupiah";

export type DasarHppRekomendasi = {
  perPcs: number;
  /** Nomor dokumen peristiwa HPP itu (penerimaan barang jadi atau GRN). */
  dokumen: string;
  /** Waktu peristiwa, ISO. */
  tanggal: string;
};

export type MasukanRekomendasi = {
  hppTerbaru: DasarHppRekomendasi | null;
  marginBarang: number | null;
  biayaBarang: number | null;
  marginBawaan: number | null;
  biayaBawaan: number | null;
};

export type KekuranganRekomendasi = "HPP" | "MARGIN";

export type HasilRekomendasi =
  | {
      ada: true;
      harga: number;
      hpp: number;
      dokumen: string;
      tanggal: string;
      margin: number;
      /** true = margin bawaan Pengaturan Jubelio, bukan margin barang. */
      marginBawaan: boolean;
      biaya: number;
      /** BARANG = biaya barang ini, BAWAAN = biaya bawaan, NOL = keduanya kosong. */
      sumberBiaya: "BARANG" | "BAWAAN" | "NOL";
    }
  | { ada: false; kurang: KekuranganRekomendasi[] };

const angkaSah = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** HPP × (1 + margin ÷ 100) + biaya tambahan, dibulatkan ke sen (setengah ke atas). */
export function hargaRekomendasi(hpp: number, marginPersen: number, biayaTambahan: number): number {
  return new Decimal(hpp)
    .mul(new Decimal(1).plus(new Decimal(marginPersen).div(100)))
    .plus(biayaTambahan)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function rekomendasiHargaJual(m: MasukanRekomendasi): HasilRekomendasi {
  const kurang: KekuranganRekomendasi[] = [];
  const hpp = m.hppTerbaru && angkaSah(m.hppTerbaru.perPcs) && m.hppTerbaru.perPcs > 0 ? m.hppTerbaru : null;
  if (!hpp) kurang.push("HPP");
  const marginBarang = angkaSah(m.marginBarang) ? m.marginBarang : null;
  const marginBawaan = angkaSah(m.marginBawaan) ? m.marginBawaan : null;
  const margin = marginBarang ?? marginBawaan;
  if (margin == null) kurang.push("MARGIN");
  if (!hpp || margin == null) return { ada: false, kurang };

  const biayaBarang = angkaSah(m.biayaBarang) ? m.biayaBarang : null;
  const biayaBawaan = angkaSah(m.biayaBawaan) ? m.biayaBawaan : null;
  const biaya = biayaBarang ?? biayaBawaan ?? 0;
  return {
    ada: true,
    harga: hargaRekomendasi(hpp.perPcs, margin, biaya),
    hpp: hpp.perPcs,
    dokumen: hpp.dokumen,
    tanggal: hpp.tanggal,
    margin,
    marginBawaan: marginBarang == null,
    biaya,
    sumberBiaya: biayaBarang != null ? "BARANG" : biayaBawaan != null ? "BAWAAN" : "NOL",
  };
}

/**
 * Isian angka opsional dari kolom `type="number"`: kosong → null, bukan angka
 * → NaN (ditolak saat simpan), selain itu angkanya. Koma desimal diterima.
 */
export function bacaAngkaOpsional(teks: string): number | null {
  const t = teks.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Batas kolom `Item.targetMarginPercent` (Decimal(5,2)). */
export const MARGIN_MAKS = 999.99;

/** "Rp 72.000" untuk angka bulat, "Rp 75.350,35" bila ada sen — sama di server dan browser. */
export function formatRupiahSen(nilai: number): string {
  const sen = Math.round(Math.abs(nilai) * 100) % 100;
  if (sen === 0) return formatRupiah(nilai);
  const utuh = nilai < 0 ? Math.ceil(nilai) : Math.floor(nilai);
  const dasar = utuh === 0 && nilai < 0 ? `-${formatRupiah(0)}` : formatRupiah(utuh);
  return `${dasar},${String(sen).padStart(2, "0")}`;
}
