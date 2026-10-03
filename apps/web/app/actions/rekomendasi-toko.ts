"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  batalkanRekomendasi,
  buatRekomendasi,
  tandaiTokoSetuju,
  terimaRekomendasi,
  tolakRekomendasi,
  type HasilBuatRekomendasi,
  type HasilTransisiRekomendasi,
} from "@/lib/salesman/rekomendasi";

/**
 * Aksi rekomendasi barang salesman → toko.
 *
 * - Membuat, menandai "toko setuju", dan membatalkan: SALESMAN keliling
 *   (`pwa:access`, BUKAN SPG). Pembuatnya selalu pengguna sesi, tidak pernah
 *   dari isian HP.
 * - Menerima dan menolak: SPG (`spg_sales:record`), dan tokonya selalu toko
 *   tetapnya dari server (`ambilTokoTetap`) — SPG toko lain ditolak penulis.
 *
 * Setiap aksi mengembalikan KODE, tidak melempar — di produksi Next
 * menyamarkan pesan galat jadi digest acak.
 */

export type HasilBuatRekomendasiAksi = HasilBuatRekomendasi | { ok: false; kode: "TANPA_AKSES" | "GAGAL" };
export type HasilTransisiRekomendasiAksi = HasilTransisiRekomendasi | { ok: false; kode: "TANPA_AKSES" | "TANPA_TOKO" | "GAGAL" };

function segarkan(id?: string, storeId?: string) {
  revalidatePath("/pwa/rekomendasi");
  revalidatePath("/pwa/spg/rekomendasi");
  if (id) {
    revalidatePath(`/pwa/rekomendasi/${id}`);
    revalidatePath(`/pwa/spg/rekomendasi/${id}`);
  }
  if (storeId) revalidatePath(`/pwa/stores/${storeId}/analisa`);
}

/** Salesman keliling: boleh membuka aplikasi HP dan tidak punya toko tetap. */
async function salesmanSesi(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || pwaAccessGuard(session.user.permissions) !== "render") return null;
  if (await ambilTokoTetap(userId)) return null;
  return userId;
}

/** SPG: pencatat penjualan toko dengan toko tetapnya. */
async function spgSesi(): Promise<{ userId: string; storeId: string } | { gagal: "TANPA_AKSES" | "TANPA_TOKO" }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) return { gagal: "TANPA_AKSES" };
  const storeId = await ambilTokoTetap(userId);
  if (!storeId) return { gagal: "TANPA_TOKO" };
  return { userId, storeId };
}

const teksId = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function buatRekomendasiAction(input: {
  storeId: string;
  baris: unknown;
  catatan?: string | null;
  /** Dibuat HP sekali per formulir (`newLocalId`) — dua ketukan Kirim tetap satu rekomendasi. */
  idempotencyKey: string;
}): Promise<HasilBuatRekomendasiAksi> {
  const userId = await salesmanSesi();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const storeId = teksId(input?.storeId);
  if (!storeId) return { ok: false, kode: "TOKO_TIDAK_DITEMUKAN" };
  try {
    const r = await buatRekomendasi({ salesmanId: userId, storeId, baris: input.baris, catatan: input.catatan, idempotencyKey: input.idempotencyKey });
    if (r.ok) segarkan(r.id, storeId);
    return r;
  } catch (err) {
    console.error("buatRekomendasiAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function terimaRekomendasiAction(input: { recommendationId: string; catatan?: string | null }): Promise<HasilTransisiRekomendasiAksi> {
  const spg = await spgSesi();
  if ("gagal" in spg) return { ok: false, kode: spg.gagal };
  const id = teksId(input?.recommendationId);
  if (!id) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await terimaRekomendasi({ recommendationId: id, userId: spg.userId, storeIdTetap: spg.storeId, catatan: input.catatan });
    if (r.ok) segarkan(id, spg.storeId);
    return r;
  } catch (err) {
    console.error("terimaRekomendasiAction gagal", id, err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function tolakRekomendasiAction(input: { recommendationId: string; alasan: string }): Promise<HasilTransisiRekomendasiAksi> {
  const spg = await spgSesi();
  if ("gagal" in spg) return { ok: false, kode: spg.gagal };
  const id = teksId(input?.recommendationId);
  if (!id) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await tolakRekomendasi({ recommendationId: id, userId: spg.userId, storeIdTetap: spg.storeId, alasan: input.alasan });
    if (r.ok) segarkan(id, spg.storeId);
    return r;
  } catch (err) {
    console.error("tolakRekomendasiAction gagal", id, err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function tandaiTokoSetujuAction(input: {
  recommendationId: string;
  sumber: string;
  catatan?: string | null;
}): Promise<HasilTransisiRekomendasiAksi> {
  const userId = await salesmanSesi();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const id = teksId(input?.recommendationId);
  if (!id) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await tandaiTokoSetuju({ recommendationId: id, salesmanId: userId, sumber: input.sumber, catatan: input.catatan });
    if (r.ok) segarkan(id);
    return r;
  } catch (err) {
    console.error("tandaiTokoSetujuAction gagal", id, err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function batalkanRekomendasiAction(input: { recommendationId: string; alasan?: string | null }): Promise<HasilTransisiRekomendasiAksi> {
  const userId = await salesmanSesi();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const id = teksId(input?.recommendationId);
  if (!id) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await batalkanRekomendasi({ recommendationId: id, salesmanId: userId, alasan: input.alasan });
    if (r.ok) segarkan(id);
    return r;
  } catch (err) {
    console.error("batalkanRekomendasiAction gagal", id, err);
    return { ok: false, kode: "GAGAL" };
  }
}
