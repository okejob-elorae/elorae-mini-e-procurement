import { bolehPegangToko } from "./penanggung-jawab";
import { cuplikan } from "@/lib/pengumuman/aturan";

/**
 * Catatan bebas per toko — aturan murni, tanpa basis data.
 *
 * "Pemilik libur tiap Jumat", "minta nota dikirim lewat WA", "parkir di
 * belakang". Bukan dokumen uang: tidak ada `AuditLog`; barisnya membawa
 * `updatedAt`, dan dihapus lunak (`deletedAt`) supaya catatan yang terhapus
 * tidak hilang dari basis data.
 */

export const BATAS_CATATAN = 1000;

export type KodeGalatCatatan = "KOSONG" | "TERLALU_PANJANG";

export function validasiCatatan(v: unknown): { ok: true; body: string } | { ok: false; kode: KodeGalatCatatan } {
  const body = typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
  if (!body) return { ok: false, kode: "KOSONG" };
  if (body.length > BATAS_CATATAN) return { ok: false, kode: "TERLALU_PANJANG" };
  return { ok: true, body };
}

/**
 * Bolehkah orang ini mengubah, menghapus, atau menyematkan sebuah catatan.
 * Ketiganya satu hak: milik sendiri, atau `stores:manage` untuk semua catatan.
 */
export function hakCatatan(o: { userId: string; authorId: string; kelolaSemua: boolean }): boolean {
  return o.kelolaSemua || o.userId === o.authorId;
}

/**
 * Bolehkah orang ini membaca dan menambah catatan di toko ini.
 *
 * - Kantor: `stores:view` (detail toko backoffice memakai izin yang sama).
 * - Orang lapangan (`pwa:access`): salesman mengikuti aturan halaman toko di HP
 *   (`bolehPegangToko` — kunci "hanya toko sendiri"); SPG hanya toko tetapnya.
 *   Halaman toko HP sendiri tidak membatasi SPG, tetapi SPG bekerja di satu
 *   toko, dan catatan toko lain bukan urusannya.
 */
export function bolehAksesCatatan(o: {
  userId: string;
  storeId: string;
  kantorLihat: boolean;
  /** null = bukan orang lapangan. */
  lapangan: { tokoTetap: string | null; terkunci: boolean; penanggungJawabId: string | null } | null;
}): boolean {
  if (o.kantorLihat) return true;
  if (!o.lapangan) return false;
  if (o.lapangan.tokoTetap) return o.lapangan.tokoTetap === o.storeId;
  return bolehPegangToko({ terkunci: o.lapangan.terkunci, penanggungJawabId: o.lapangan.penanggungJawabId, userId: o.userId });
}

/** Tersemat di atas; di dalamnya (dan sesudahnya) terbaru dulu. */
export function urutkanCatatan<T extends { id: string; pinned: boolean; createdAt: Date }>(baris: readonly T[]): T[] {
  return [...baris].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}

/** Satu baris pendek untuk rencana kunjungan dan rute. */
export function ringkasCatatan(body: string, maks = 80): string {
  return cuplikan(body, maks);
}
