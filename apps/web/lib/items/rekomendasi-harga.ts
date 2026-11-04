/**
 * Rekomendasi harga jual barang jadi — HANYA SARAN, tidak pernah menulis harga.
 *
 * Murni (tanpa Prisma), jadi aman diimpor komponen klien: formulir barang
 * menghitung ulang rekomendasinya sendiri setiap kali markup/margin atau biaya
 * tambahan diketik.
 *
 * Keputusan pemilik 2026-11-01: HPP yang tampil adalah HPP sebenarnya; sistem
 * boleh memberi rekomendasi harga, tetapi harga jual akhir tetap diketik sendiri
 * dan tidak pernah tertimpa otomatis. Tombol "Pakai rekomendasi" hanya mengisi
 * kolom harga; harga baru tersimpan hanya kalau pengguna menekan Simpan (riwayat
 * harga mencatat `MANUAL_EDIT`).
 *
 * Jawaban pemilik 2026-11-02:
 * - P4: SATU rumus rekomendasi, supaya tidak ada dua harga rekomendasi. Persennya
 *   boleh diisi sebagai MARKUP atau MARGIN, dan keduanya ditampilkan (markup 178%
 *   = margin 64,0%; margin 40% = markup 66,7%). Satu persen per barang plus
 *   dasarnya (`Item.priceRuleBasis`); kosong → pasangan bawaan di Pengaturan
 *   Jubelio, dipakai utuh (persen bawaan tidak pernah dicampur dengan dasar barang).
 * - P4a: isian markup di perintah kerja dihapus; Laporan HPP menampilkan
 *   rekomendasi barang ini juga (`rekomendasi-harga-queries.ts`).
 * - Q5: biaya tambahan barang adalah BANTALAN MARGIN — tetap ditambahkan di atas
 *   hasil markup/margin. Biaya tambahan per pcs di perintah kerja lain hal: itu
 *   biaya produksi dan sudah termasuk HPP.
 * - Persen lama yang sudah tersimpan dibaca sebagai markup (kolom dasar bawaannya
 *   MARKUP), jadi rekomendasi yang tampil sebelum perubahan ini tidak bergeser.
 *
 * Rumus, dibulatkan ke sen (setengah ke atas):
 *   MARKUP k → HPP terbaru × (1 + k ÷ 100) + bantalan margin
 *   MARGIN m → HPP terbaru ÷ (1 − m ÷ 100) + bantalan margin
 * - HPP terbaru = HPP per pcs peristiwa biaya terbaru barang ini
 *   (`hppTerbaruDari` di `./riwayat-hpp.ts`), bukan rata-rata stok.
 * - Bantalan margin = biaya tambahan barang; kosong → bawaan; kosong → 0.
 */
import { Decimal } from "decimal.js";
import { formatRupiah } from "@/lib/format/rupiah";

export type DasarAturanHarga = "MARKUP" | "MARGIN";

/** Satu aturan rekomendasi: persen plus dasarnya. */
export type AturanHarga = { dasar: DasarAturanHarga; persen: number };

export type DasarHppRekomendasi = {
  perPcs: number;
  /** Nomor dokumen peristiwa HPP itu (penerimaan barang jadi atau GRN). */
  dokumen: string;
  /** Waktu peristiwa, ISO. */
  tanggal: string;
};

export type MasukanRekomendasi = {
  hppTerbaru: DasarHppRekomendasi | null;
  aturanBarang: AturanHarga | null;
  biayaBarang: number | null;
  aturanBawaan: AturanHarga | null;
  biayaBawaan: number | null;
};

export type KekuranganRekomendasi = "HPP" | "ATURAN";

export type HasilRekomendasi =
  | {
      ada: true;
      harga: number;
      hpp: number;
      dokumen: string;
      tanggal: string;
      dasar: DasarAturanHarga;
      persen: number;
      /** Markup setara; null hanya untuk margin ≥ 100 (tidak pernah lolos `aturanHargaSah`). */
      markup: number | null;
      /** Margin setara. */
      margin: number;
      /** true = pasangan bawaan Pengaturan Jubelio, bukan aturan barang. */
      aturanBawaan: boolean;
      /** Bantalan margin. */
      biaya: number;
      /** BARANG = biaya barang ini, BAWAAN = biaya bawaan, NOL = keduanya kosong. */
      sumberBiaya: "BARANG" | "BAWAAN" | "NOL";
    }
  | { ada: false; kurang: KekuranganRekomendasi[] };

/** Batas markup = batas kolom `Item.targetMarginPercent` (Decimal(5,2)). */
export const MARKUP_MAKS = 999.99;
/** Batas margin: di bawah 100% (margin 100% = harga tak terhingga). */
export const MARGIN_MAKS = 99.99;

const angkaSah = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Margin setara dari markup: markup ÷ (100 + markup) × 100. */
export function marginDariMarkup(markup: number): number {
  return (markup / (100 + markup)) * 100;
}

/** Markup setara dari margin: margin ÷ (100 − margin) × 100; null bila margin ≥ 100. */
export function markupDariMargin(margin: number): number | null {
  if (margin >= 100) return null;
  return (margin / (100 - margin)) * 100;
}

/** Kedua angka sebuah aturan — yang diketik dan yang dihitung. */
export function pasanganAturan(a: AturanHarga): { markup: number | null; margin: number } {
  return a.dasar === "MARKUP"
    ? { markup: a.persen, margin: marginDariMarkup(a.persen) }
    : { markup: markupDariMargin(a.persen), margin: a.persen };
}

/** Persen terhingga, 0 atau lebih, di bawah batas dasarnya (markup 999,99; margin 99,99). */
export function aturanHargaSah(a: AturanHarga | null | undefined): a is AturanHarga {
  if (!a || !angkaSah(a.persen) || a.persen < 0) return false;
  return a.persen <= (a.dasar === "MARGIN" ? MARGIN_MAKS : MARKUP_MAKS);
}

/** Kolom tersimpan (persen + dasar) → aturan; persen kosong → null. Dasar asing dibaca sebagai markup. */
export function aturanDariKolom(
  persen: { toString(): string } | number | null | undefined,
  dasar: string | null | undefined,
): AturanHarga | null {
  if (persen == null) return null;
  const n = typeof persen === "number" ? persen : Number(persen.toString());
  if (!Number.isFinite(n)) return null;
  return { dasar: dasar === "MARGIN" ? "MARGIN" : "MARKUP", persen: n };
}

/**
 * HPP × (1 + markup ÷ 100), atau HPP ÷ (1 − margin ÷ 100), lalu + bantalan margin, dibulatkan ke
 * sen (setengah ke atas). null bila margin 100% atau lebih.
 */
export function hargaRekomendasi(hpp: number, aturan: AturanHarga, biayaTambahan: number): number | null {
  const dasar = new Decimal(hpp);
  const persen = new Decimal(aturan.persen).div(100);
  let harga: Decimal;
  if (aturan.dasar === "MARGIN") {
    const sisa = new Decimal(1).minus(persen);
    if (sisa.lessThanOrEqualTo(0)) return null;
    harga = dasar.div(sisa);
  } else {
    harga = dasar.mul(new Decimal(1).plus(persen));
  }
  return harga.plus(biayaTambahan).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

const SATU_DESIMAL = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "64,0", "66,7", "999.900,0" — sama di server dan browser. */
export function formatPersenSatuDesimal(n: number): string {
  return SATU_DESIMAL.format(n);
}

export function rekomendasiHargaJual(m: MasukanRekomendasi): HasilRekomendasi {
  const kurang: KekuranganRekomendasi[] = [];
  const hpp = m.hppTerbaru && angkaSah(m.hppTerbaru.perPcs) && m.hppTerbaru.perPcs > 0 ? m.hppTerbaru : null;
  if (!hpp) kurang.push("HPP");
  const aturanBarang = aturanHargaSah(m.aturanBarang) ? m.aturanBarang : null;
  const aturanBawaan = aturanHargaSah(m.aturanBawaan) ? m.aturanBawaan : null;
  const aturan = aturanBarang ?? aturanBawaan;
  if (aturan == null) kurang.push("ATURAN");
  if (!hpp || aturan == null) return { ada: false, kurang };

  const biayaBarang = angkaSah(m.biayaBarang) ? m.biayaBarang : null;
  const biayaBawaan = angkaSah(m.biayaBawaan) ? m.biayaBawaan : null;
  const biaya = biayaBarang ?? biayaBawaan ?? 0;
  const harga = hargaRekomendasi(hpp.perPcs, aturan, biaya);
  if (harga == null) return { ada: false, kurang: ["ATURAN"] };
  const pasangan = pasanganAturan(aturan);
  return {
    ada: true,
    harga,
    hpp: hpp.perPcs,
    dokumen: hpp.dokumen,
    tanggal: hpp.tanggal,
    dasar: aturan.dasar,
    persen: aturan.persen,
    markup: pasangan.markup,
    margin: pasangan.margin,
    aturanBawaan: aturanBarang == null,
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

/** "Rp 72.000" untuk angka bulat, "Rp 75.350,35" bila ada sen — sama di server dan browser. */
export function formatRupiahSen(nilai: number): string {
  const sen = Math.round(Math.abs(nilai) * 100) % 100;
  if (sen === 0) return formatRupiah(nilai);
  const utuh = nilai < 0 ? Math.ceil(nilai) : Math.floor(nilai);
  const dasar = utuh === 0 && nilai < 0 ? `-${formatRupiah(0)}` : formatRupiah(utuh);
  return `${dasar},${String(sen).padStart(2, "0")}`;
}
