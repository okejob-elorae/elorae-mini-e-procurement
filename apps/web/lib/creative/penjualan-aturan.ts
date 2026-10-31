/**
 * Penjualan afiliasi KOL — aturan murni, aman untuk klien.
 *
 * Diketik per kolaborasi (keputusan sementara pemilik 2026-10-07 no. 5):
 * tanggal, order, GMV, komisi, sumber. Impor berkas TikTok Shop/Shopee belum
 * ada (menunggu berkas contoh). Uang dijumlah dalam sen supaya total tabel
 * sama persis dengan jumlah barisnya.
 */

import { dariSen, keSen } from "./angka-konten";

export const SUMBER_PENJUALAN = ["TikTok Shop", "Shopee", "Lainnya"] as const;
export type SumberPenjualan = (typeof SUMBER_PENJUALAN)[number];

export function sumberSah(v: unknown): v is SumberPenjualan {
  return typeof v === "string" && (SUMBER_PENJUALAN as readonly string[]).includes(v);
}

/** Batas atas satu baris: kolom Decimal(15,2). */
export const MAKS_UANG = 9_999_999_999_999;
export const MAKS_ORDER = 2_147_483_647;
export const MAKS_CATATAN = 1000;

export type KodeGagalPenjualan = "TANGGAL_WAJIB" | "ANGKA_TIDAK_SAH" | "PENJUALAN_KOSONG" | "SUMBER_TIDAK_SAH" | "CATATAN_TERLALU_PANJANG";

/** Rupiah ≥ 0 yang muat di kolomnya. Pecahan di bawah sen dibulatkan penulis (`keSen`). */
const uangSah = (n: unknown): boolean => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAKS_UANG;

/**
 * Periksa isian satu baris penjualan. Baris tanpa order DAN tanpa GMV ditolak:
 * ia tidak mencatat apa pun selain komisi yang tidak punya penjualan.
 * Kolom yang `undefined` (tidak dikirim saat mengubah) tidak diperiksa.
 */
export function periksaPenjualan(isi: {
  date?: Date | null;
  orders?: number;
  gmv?: number;
  commission?: number;
  source?: string | null;
  note?: string | null;
  baru: boolean;
}): KodeGagalPenjualan | null {
  if (isi.baru || isi.date !== undefined) {
    if (!(isi.date instanceof Date) || Number.isNaN(isi.date.getTime())) return "TANGGAL_WAJIB";
  }
  if (isi.orders !== undefined && (!Number.isInteger(isi.orders) || isi.orders < 0 || isi.orders > MAKS_ORDER)) return "ANGKA_TIDAK_SAH";
  if (isi.gmv !== undefined && !uangSah(isi.gmv)) return "ANGKA_TIDAK_SAH";
  if (isi.commission !== undefined && !uangSah(isi.commission)) return "ANGKA_TIDAK_SAH";
  if (isi.source !== undefined && isi.source !== null && !sumberSah(isi.source)) return "SUMBER_TIDAK_SAH";
  if (isi.note && isi.note.length > MAKS_CATATAN) return "CATATAN_TERLALU_PANJANG";
  return null;
}

/** Setelah digabung dengan nilai lama: baris yang tidak mencatat order maupun GMV. */
export function penjualanKosong(orders: number, gmv: number): boolean {
  return orders <= 0 && keSen(gmv) <= 0;
}

export type TotalPenjualan = { orders: number; gmv: number; komisi: number };

export function jumlahPenjualan(baris: readonly { orders: number; gmv: number; commission: number }[]): TotalPenjualan {
  let orders = 0;
  let gmv = 0;
  let komisi = 0;
  for (const b of baris) {
    orders += Number.isFinite(b.orders) ? b.orders : 0;
    gmv += keSen(b.gmv);
    komisi += keSen(b.commission);
  }
  return { orders, gmv: dariSen(gmv), komisi: dariSen(komisi) };
}
