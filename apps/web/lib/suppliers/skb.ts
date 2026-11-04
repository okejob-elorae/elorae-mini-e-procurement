import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { tanggalKalenderSah } from "@/lib/finance/kas/aturan";

/**
 * Isian SKB (Surat Keterangan Bebas) pemasok — MURNI. Penjahit yang bukan
 * badan usaha diminta SKB; selama SKB berlaku pembayarannya tidak dipotong PPh
 * (`tentukanPotongPemasok`, `lib/finance/pajak/pemotongan.ts`).
 *
 * - `skbNumber` tidak dikirim (undefined) → SKB tidak diubah.
 * - nomor kosong/null → SKB dihapus seluruhnya (tanggal dan foto ikut kosong).
 * - nomor terisi → tanggal "berlaku sampai" (hari WIB, inklusif) WAJIB; foto
 *   opsional dan hanya `/api/foto/<id>` (disimpan di basis data, `KOLOM_FOTO`).
 */

export type KodeGalatSkb = "SKB_TANGGAL_WAJIB" | "SKB_TANGGAL_TIDAK_SAH" | "SKB_FOTO_TIDAK_SAH" | "SKB_NOMOR_TERLALU_PANJANG";

export type DataSkb = { skbNumber?: string | null; skbValidUntil?: Date | null; skbPhotoUrl?: string | null };

const POLA_FOTO = /^\/api\/foto\/[A-Za-z0-9_-]{1,64}$/;
const MAKS_NOMOR = 191;

export function isianSkbPemasok(input: {
  skbNumber?: string | null;
  skbValidUntil?: string | null;
  skbPhotoUrl?: string | null;
}): { ok: true; data: DataSkb } | { ok: false; kode: KodeGalatSkb } {
  if (input.skbNumber === undefined) return { ok: true, data: {} };
  const nomor = input.skbNumber?.trim() ?? "";
  if (!nomor) return { ok: true, data: { skbNumber: null, skbValidUntil: null, skbPhotoUrl: null } };
  if (nomor.length > MAKS_NOMOR) return { ok: false, kode: "SKB_NOMOR_TERLALU_PANJANG" };
  const tanggal = input.skbValidUntil?.trim() ?? "";
  if (!tanggal) return { ok: false, kode: "SKB_TANGGAL_WAJIB" };
  if (!tanggalKalenderSah(tanggal)) return { ok: false, kode: "SKB_TANGGAL_TIDAK_SAH" };
  const foto = input.skbPhotoUrl?.trim() || null;
  if (foto && !POLA_FOTO.test(foto)) return { ok: false, kode: "SKB_FOTO_TIDAK_SAH" };
  return { ok: true, data: { skbNumber: nomor, skbValidUntil: parseDateOnly(tanggal) as Date, skbPhotoUrl: foto } };
}

type SkbTersimpan = { skbNumber: string | null; skbValidUntil: Date | null; skbPhotoUrl: string | null };
type SkbJejak = { skbNumber: string | null; skbValidUntil: string | null; skbPhotoUrl: string | null };

const keJejak = (s: SkbTersimpan): SkbJejak => ({
  skbNumber: s.skbNumber,
  skbValidUntil: s.skbValidUntil ? formatDateOnlyJakarta(s.skbValidUntil) : null,
  skbPhotoUrl: s.skbPhotoUrl,
});

/**
 * Pasangan sebelum/sesudah untuk jejak `SUPPLIER_SKB_CHANGED`, atau null bila
 * SKB tidak berubah. `lama` null = pemasok baru.
 */
export function perubahanSkb(lama: SkbTersimpan | null, baru: DataSkb): { before: SkbJejak; after: SkbJejak } | null {
  const sebelum: SkbTersimpan = lama ?? { skbNumber: null, skbValidUntil: null, skbPhotoUrl: null };
  const sesudah: SkbTersimpan = {
    skbNumber: baru.skbNumber !== undefined ? baru.skbNumber : sebelum.skbNumber,
    skbValidUntil: baru.skbValidUntil !== undefined ? baru.skbValidUntil : sebelum.skbValidUntil,
    skbPhotoUrl: baru.skbPhotoUrl !== undefined ? baru.skbPhotoUrl : sebelum.skbPhotoUrl,
  };
  const a = keJejak(sebelum);
  const b = keJejak(sesudah);
  if (a.skbNumber === b.skbNumber && a.skbValidUntil === b.skbValidUntil && a.skbPhotoUrl === b.skbPhotoUrl) return null;
  return { before: a, after: b };
}

/** Nama tindakan jejak perubahan SKB pemasok (label `auditActions.actions.SUPPLIER_SKB_CHANGED`). */
export const JEJAK_SKB_PEMASOK = "SUPPLIER_SKB_CHANGED";
