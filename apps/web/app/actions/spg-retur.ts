"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import {
  catatReturPembeli,
  setujuiReturPembeli,
  tarikReturPembeli,
  tolakReturPembeli,
  type AlasanTolakPutusanReturPembeli,
  type AlasanTolakReturPembeli,
  type HasilPutusanReturPembeli,
} from "@/lib/spg/retur-pembeli";
import { BATAS_ALASAN_RETUR_PEMBELI } from "@/lib/spg/retur-pembeli-status";
import { BATAS_STOK_LURING_MS, jepitWaktuLuring } from "@/lib/pwa/waktu-luring";

export type HasilReturPembeliAksi =
  | { ok: true; returnId: string }
  | { ok: false; kode: "TANPA_AKSES" | "TANPA_TOKO" | "ISIAN_TIDAK_VALID" | "WAKTU_TIDAK_VALID" | "GAGAL" | AlasanTolakReturPembeli };

export type HasilPutusanReturPembeliAksi =
  | { ok: true }
  | { ok: false; kode: "TANPA_AKSES" | "TANPA_TOKO" | "ISIAN_TIDAK_VALID" | "GAGAL" | AlasanTolakPutusanReturPembeli };

// Toko TIDAK diambil dari HP: ditetapkan dari `User.assignedStoreId`.
const skema = z.object({
  spgSaleId: z.string().min(1),
  alasan: z.string().max(BATAS_ALASAN_RETUR_PEMBELI),
  idempotencyKey: z.string().min(1).max(100),
  baris: z
    .array(
      z.object({
        saleLineId: z.string().min(1),
        qty: z.number().int().min(0),
        condition: z.enum(["LAYAK", "RUSAK", "EXPIRED"]).optional(),
      }),
    )
    .min(1)
    .max(200),
  /** Dikirim antrean HP (dicatat tanpa sinyal). */
  luring: z.boolean().optional(),
  /** Saat pembeli mengembalikannya di HP (ISO) — hanya bersama `luring`. */
  waktuTangkap: z.string().datetime().optional(),
});

const skemaSetujui = z.object({ returnId: z.string().min(1).max(64) });

// Kantor yang menolak wajib menulis alasannya: SPG membacanya di HP. Alasan
// kosong diputuskan penulis (`ALASAN_WAJIB`), bukan skema — sama seperti menarik.
const skemaTolak = z.object({
  returnId: z.string().min(1).max(64),
  alasan: z.string().max(BATAS_ALASAN_RETUR_PEMBELI),
});

// Alasan kosong diputuskan penulis (`ALASAN_WAJIB`), sama seperti saat melapor.
const skemaTarik = z.object({
  returnId: z.string().min(1).max(64),
  alasan: z.string().max(BATAS_ALASAN_RETUR_PEMBELI),
});

/**
 * Pembeli mengembalikan barang ke counter. SPG MELAPORKANNYA; laporan itu
 * menunggu persetujuan kantor dan belum berpengaruh apa pun (buku stok toko,
 * penjualan bersih, komisi) sampai disetujui. Kasir toko yang mengembalikan
 * uangnya; di sini hanya barang dan jumlahnya yang dicatat (`catatReturPembeli`).
 */
export async function catatReturPembeliAction(input: unknown): Promise<HasilReturPembeliAksi> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  const isi = skema.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  const storeId = await ambilTokoTetap(session.user.id);
  if (!storeId) return { ok: false, kode: "TANPA_TOKO" };

  // Retur dari antrean HP dicatat pada jam ia dilakukan (dijepit: masa depan →
  // sekarang, lebih tua dari batas stok tanpa sinyal → ditolak).
  let waktuTangkap: Date | null = null;
  if (isi.data.luring && isi.data.waktuTangkap) {
    waktuTangkap = jepitWaktuLuring(isi.data.waktuTangkap, new Date(), BATAS_STOK_LURING_MS);
    if (!waktuTangkap) return { ok: false, kode: "WAKTU_TIDAK_VALID" };
  }

  try {
    const hasil = await catatReturPembeli({
      spgSaleId: isi.data.spgSaleId,
      alasan: isi.data.alasan,
      idempotencyKey: isi.data.idempotencyKey,
      baris: isi.data.baris,
      storeId,
      userId: session.user.id,
      waktuTangkap,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    revalidatePath(`/pwa/spg/${isi.data.spgSaleId}/nota`);
    revalidatePath(`/pwa/spg/${isi.data.spgSaleId}/kembali`);
    revalidatePath("/pwa/spg/nota");
    revalidatePath("/pwa/spg/stok");
    revalidatePath("/pwa/spg/tutup");
    revalidatePath("/pwa/spg/retur-pembeli");
    revalidatePath(`/backoffice/spg-sales/${isi.data.spgSaleId}`);
    revalidatePath("/backoffice/retur-spg");
    return { ok: true, returnId: hasil.returnId };
  } catch (err) {
    console.error("catatReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Halaman yang membaca laporan retur pembeli. Laporan yang ditolak atau ditarik
 * hanya melepas jumlah yang tadinya ditahan; yang disetujui juga mengubah buku
 * stok toko, penjualan bersih, dan komisi, jadi halaman stok, gaji, dan Beranda
 * HP ikut disegarkan.
 */
function segarkanSesudahPutusan(hasil: Extract<HasilPutusanReturPembeli, { ok: true }>): void {
  revalidatePath("/backoffice/retur-spg");
  revalidatePath(`/backoffice/retur-spg/${hasil.returnId}`);
  revalidatePath(`/backoffice/spg-sales/${hasil.spgSaleId}`);
  revalidatePath("/pwa/spg/retur-pembeli");
  revalidatePath(`/pwa/spg/${hasil.spgSaleId}/nota`);
  revalidatePath(`/pwa/spg/${hasil.spgSaleId}/kembali`);
  revalidatePath("/pwa/spg/tutup");
  if (hasil.status === "DISETUJUI") {
    revalidatePath("/pwa/spg/nota");
    revalidatePath("/pwa/spg/stok");
    revalidatePath("/pwa/spg/gaji");
    revalidatePath("/pwa");
  }
}

/**
 * Kantor menyetujui laporan retur pembeli: baru sekarang retur berpengaruh.
 * Hanya `spg_returns:approve` — tombolnya di halaman retur SPG memeriksa izin
 * yang sama. Pelapor tidak bisa menyetujui laporannya sendiri (`PELAPOR_SAMA`,
 * di penulis).
 */
export async function setujuiReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_RETURNS_APPROVE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  const isi = skemaSetujui.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  try {
    const hasil = await setujuiReturPembeli({ returnId: isi.data.returnId, olehUserId: session.user.id });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkanSesudahPutusan(hasil);
    return { ok: true };
  } catch (err) {
    console.error("setujuiReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Kantor menolak laporan retur pembeli, dengan alasan. Tidak ada yang bergerak. */
export async function tolakReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_RETURNS_APPROVE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  const isi = skemaTolak.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  try {
    const hasil = await tolakReturPembeli({
      returnId: isi.data.returnId,
      olehUserId: session.user.id,
      alasan: isi.data.alasan,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkanSesudahPutusan(hasil);
    return { ok: true };
  } catch (err) {
    console.error("tolakReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * SPG menarik laporannya sendiri selama belum diputuskan kantor. Toko diambil
 * dari `User.assignedStoreId`, tidak pernah dari HP — penulis menolak laporan
 * milik orang lain atau toko lain (`BUKAN_MILIK`).
 */
export async function tarikReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  const isi = skemaTarik.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  const storeId = await ambilTokoTetap(session.user.id);
  if (!storeId) return { ok: false, kode: "TANPA_TOKO" };
  try {
    const hasil = await tarikReturPembeli({
      returnId: isi.data.returnId,
      userId: session.user.id,
      storeId,
      alasan: isi.data.alasan,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkanSesudahPutusan(hasil);
    return { ok: true };
  } catch (err) {
    console.error("tarikReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
