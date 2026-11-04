import type { PilihanVarianKirim } from "@/lib/konsinyasi/varian-kirim";
import type { BarangSampel } from "@/lib/creative/sampel-queries";
import type { KurangStokSampel, PindahTahap } from "@/lib/creative/sampel-writer";
import { bacaAngka } from "@/lib/creative/angka-masuk";
import { newLocalId } from "@/lib/pwa/id-lokal";

/**
 * Logika murni isian barang sampel (tanpa React, tanpa Prisma — dari kueri
 * dan penulis hanya `import type`). Dipakai baris antrean Sampel dan dialog
 * di panel Pengiriman.
 *
 * Satu baris = satu barang + satu varian. Barang bervarian WAJIB dipilih
 * ukurannya sebelum berangkat (penulis menolak `VARIAN_WAJIB`), jadi tombol
 * kirim menyebut baris mana yang belum siap.
 */

export type BarisIsian = {
  uid: string;
  itemId: string;
  itemName: string;
  variantSku: string | null;
  variantLabel: string | null;
  qty: number;
  /** Katalog barang punya varian — baris tanpa varian belum siap berangkat. */
  bervarian: boolean;
};

export function dariBarang(baris: readonly BarangSampel[]): BarisIsian[] {
  return baris.map((b) => ({
    uid: newLocalId(),
    itemId: b.itemId,
    itemName: b.itemName,
    variantSku: b.variantSku,
    variantLabel: b.variantLabel,
    qty: b.qty,
    bervarian: b.perluVarian || Boolean(b.variantSku),
  }));
}

/** Baris ini harus memilih ukuran dulu. */
export function perluPilihVarian(b: BarisIsian, pilihan: PilihanVarianKirim | undefined): boolean {
  if (b.variantSku) return false;
  return b.bervarian || Boolean(pilihan?.perluVarian);
}

export type AlasanBelumSiap = { kode: "KOSONG" } | { kode: "QTY"; nama: string } | { kode: "VARIAN"; nama: string };

/** Alasan PERTAMA isian barang belum bisa dikirim, urut formulir; null = siap. */
export function alasanBelumSiap(baris: readonly BarisIsian[], varian: Record<string, PilihanVarianKirim | undefined>): AlasanBelumSiap | null {
  if (baris.length === 0) return { kode: "KOSONG" };
  for (const b of baris) {
    if (!(Number.isInteger(b.qty) && b.qty > 0)) return { kode: "QTY", nama: b.itemName };
    if (perluPilihVarian(b, varian[b.itemId])) return { kode: "VARIAN", nama: b.itemName };
  }
  return null;
}

/** Stok tersedia untuk varian baris ini; null bila belum diketahui. */
export function tersediaBaris(b: BarisIsian, pilihan: PilihanVarianKirim | undefined): number | null {
  if (!pilihan) return null;
  if (!b.variantSku) return pilihan.perluVarian ? null : pilihan.tersediaTanpaVarian ?? (pilihan.varian.length === 1 ? pilihan.varian[0].tersedia : null);
  return pilihan.varian.find((v) => v.sku === b.variantSku)?.tersedia ?? 0;
}

/** Varian yang ditawarkan: yang ada stoknya, ditambah yang sedang terpilih. */
export function varianDitawarkan(pilihan: PilihanVarianKirim, terpilih: string | null): { tampil: PilihanVarianKirim["varian"]; tersembunyi: number } {
  const tampil = pilihan.varian.filter((v) => v.tersedia > 0 || v.sku === terpilih);
  return { tampil, tersembunyi: pilihan.varian.length - tampil.length };
}

/** Satu-satunya varian yang akan dipotong penulis tanpa harus dipilih — diisikan otomatis. */
export function varianOtomatis(pilihan: PilihanVarianKirim): string | null {
  return !pilihan.perluVarian && pilihan.varian.length === 1 ? pilihan.varian[0].sku : null;
}

/** Baris ini termasuk barang/varian yang dilaporkan kurang oleh server. */
export function barisKurang(b: BarisIsian, kurang: readonly KurangStokSampel[]): KurangStokSampel | undefined {
  return kurang.find((k) => k.itemId === b.itemId && k.variantSku === (b.variantSku ?? ""));
}

/**
 * Label varian tanpa SKU di ujungnya ("Hitam · M (KAOS-HTM-M)" → "Hitam · M") untuk
 * tombol ukuran dan baris ringkas; label lengkapnya tetap di `title`.
 */
export function labelVarianPendek(label: string | null | undefined): string | null {
  if (!label) return null;
  const pendek = label.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return pendek || label;
}

/** "Kaos Basic — M ×2" untuk daftar barang ringkas. */
export function teksBaris(b: { itemName: string; variantLabel: string | null; qty: number }): string {
  const v = labelVarianPendek(b.variantLabel);
  return `${b.itemName}${v ? ` — ${v}` : ""} ×${b.qty}`;
}

/**
 * Isian barang masih sama dengan asalnya (rencana atau pengiriman yang ada) —
 * barang, varian, dan qty; urutan diabaikan. Bila sama, barang tidak dikirim
 * ulang ke server.
 */
export function barisSamaIsian(
  isian: readonly BarisIsian[],
  asal: readonly { itemId: string; variantSku: string | null; qty: number }[],
): boolean {
  if (isian.length !== asal.length) return false;
  const kunci = (x: { itemId: string; variantSku: string | null; qty: number }) => `${x.itemId}::${x.variantSku ?? ""}::${x.qty}`;
  const a = isian.map(kunci).sort();
  const b = asal.map(kunci).sort();
  return a.every((x, i) => x === b[i]);
}

/** Bentuk yang dikirim ke server. */
export function untukServer(baris: readonly BarisIsian[]): { itemId: string; variantSku: string | null; qty: number }[] {
  return baris.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku?.trim() || null, qty: b.qty }));
}

/** Isian ongkir yang diketik ("12.000", "12rb", "Rp 12.000") → angka; kosong → null; rusak/negatif → NaN. */
export function bacaOngkir(teks: string): number | null {
  if (!teks.trim()) return null;
  const n = bacaAngka(teks);
  return n !== null && n >= 0 ? n : Number.NaN;
}

/** Penerjemah `kreatifRuang` dengan kunci dirakit (lihat `lib/i18n/dinamis.ts`). */
export type Terjemah = (kunci: string, nilai?: Record<string, string | number>) => string;

/** Kode galat yang punya kalimatnya sendiri; selain ini jatuh ke "GAGAL". */
export const KODE_GALAT_SAMPEL = [
  "KOLABORASI_TIDAK_DITEMUKAN",
  "PENGIRIMAN_TIDAK_DITEMUKAN",
  "KOLABORASI_TUTUP",
  "TANPA_BARIS",
  "QTY_TIDAK_VALID",
  "TERLALU_BANYAK_BARIS",
  "TERLALU_PANJANG",
  "ONGKIR_TIDAK_VALID",
  "BARANG_TIDAK_DITEMUKAN",
  "VARIAN_WAJIB",
  "VARIAN_TIDAK_DIKENAL",
  "STOK_KURANG",
  "SUDAH_BERANGKAT",
  "RESI_WAJIB",
  "TANGGAL_KIRIM_WAJIB",
  "BELUM_BERANGKAT",
  "TANGGAL_DI_DEPAN",
  "TERIMA_SEBELUM_KIRIM",
  "TANGGAL_TIDAK_VALID",
  "TANPA_AKSES",
  "GAGAL",
] as const;

export function teksGagal(t: Terjemah, r: { kode: string; detail?: string }): string {
  const kode = (KODE_GALAT_SAMPEL as readonly string[]).includes(r.kode) ? r.kode : "GAGAL";
  return t(`sampel.err.${kode}`, { barang: r.detail ?? "" });
}

/** "Resi tersimpan · tahap → Sampel dikirim"; kiriman ulang menyebut bahwa sudah tercatat. */
export function teksBerhasil(
  t: Terjemah,
  jenis: "resi" | "terima" | "simpan" | "hapus",
  r: { ulang?: boolean; tahap?: PindahTahap },
): string {
  if (r.ulang) return t("sampel.ok.ulang");
  const dasar = t(`sampel.ok.${jenis}`);
  return r.tahap ? t("sampel.ok.tahap", { pesan: dasar, tahap: t(`tahap.${r.tahap.ke}`) }) : dasar;
}
