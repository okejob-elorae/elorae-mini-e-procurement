"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { isSafeR2KeySegment } from "@/lib/r2-key";
import { BATAS_STOK_LURING_MS, jepitWaktuLuring } from "@/lib/pwa/waktu-luring";
import {
  batalkanPenolakanReturPembeli,
  catatReturPembeli,
  catatUangDikembalikan,
  putuskanBarangReturPembeli,
  setujuiReturPembeli,
  tarikReturPembeli,
  tolakReturPembeli,
  type AlasanTolakBatalPenolakan,
  type AlasanTolakKeputusanBarang,
  type AlasanTolakPutusanReturPembeli,
  type AlasanTolakReturPembeli,
  type AlasanTolakUangKembali,
} from "@/lib/spg/retur-pembeli";
import { ubahBesarBebanSpg, type AlasanTolakUbahBeban } from "@/lib/spg/beban-spg-writer";
import { BATAS_ALASAN_RETUR_PEMBELI } from "@/lib/spg/retur-pembeli-status";

/**
 * Aksi retur pembeli SPG (keputusan pemilik 2026-11-02, P12–P14, P77–P83).
 *
 * HP SPG (`spg_sales:record` + toko tetap dari `User.assignedStoreId`, tidak
 * pernah dari HP): melapor, mencatat uang sudah dikembalikan, menarik laporan.
 * Kantor (`spg_returns:approve`, bawaannya admin dan Admin Penjualan; tidak
 * pernah pelapornya sendiri — `PELAPOR_SAMA` di penulis): menyetujui, menolak
 * (termasuk tanda "uang ternyata sudah dikembalikan" dan besar beban),
 * membatalkan penolakan keliru, mengubah besar beban, memutuskan barangnya.
 * Setiap tombol di layar memeriksa izin yang SAMA.
 */

type KodeUmum = "TANPA_AKSES" | "TANPA_TOKO" | "ISIAN_TIDAK_VALID" | "WAKTU_TIDAK_VALID" | "GAGAL";

export type HasilReturPembeliAksi = { ok: true; returnId: string } | { ok: false; kode: KodeUmum | AlasanTolakReturPembeli };

export type HasilPutusanReturPembeliAksi =
  | { ok: true }
  | {
      ok: false;
      kode:
        | KodeUmum
        | AlasanTolakPutusanReturPembeli
        | AlasanTolakUangKembali
        | AlasanTolakBatalPenolakan
        | AlasanTolakKeputusanBarang
        | AlasanTolakUbahBeban;
    };

const alasanSkema = z.string().max(BATAS_ALASAN_RETUR_PEMBELI);
const idSkema = z.string().min(1).max(64);
const kunciR2Skema = z.string().max(191);

// Toko TIDAK diambil dari HP: ditetapkan dari `User.assignedStoreId`. Kunci
// kiriman juga menjadi segmen kunci R2 foto laporannya, jadi kunci yang tidak
// aman ditolak di sini (bukan sebagai "foto wajib" yang menyesatkan).
const skemaLapor = z.object({
  spgSaleId: z.string().min(1),
  alasan: alasanSkema,
  idempotencyKey: z.string().min(1).max(64).refine(isSafeR2KeySegment),
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
  fotoBarangKey: kunciR2Skema.nullable().optional(),
  uangSudahDikembalikan: z.boolean().optional(),
  fotoStrukKey: kunciR2Skema.nullable().optional(),
  /** Dikirim antrean HP (dicatat tanpa sinyal). */
  luring: z.boolean().optional(),
  /** Saat pembeli mengembalikannya di HP (ISO) — hanya bersama `luring`. */
  waktuTangkap: z.string().datetime().optional(),
});

const skemaSetujui = z.object({ returnId: idSkema });

// Alasan kosong diputuskan penulis (`ALASAN_WAJIB`), bukan skema.
const skemaTolak = z.object({
  returnId: idSkema,
  alasan: alasanSkema,
  uangTernyataDikembalikan: z.boolean().optional(),
  alasanUangKembali: alasanSkema.optional(),
  besarBeban: z.number().finite().optional(),
  alasanBesarBeban: alasanSkema.optional(),
});

const skemaTarik = z.object({ returnId: idSkema, alasan: alasanSkema });

const skemaUangKembali = z.object({
  returnId: idSkema,
  fotoStrukKey: kunciR2Skema,
  luring: z.boolean().optional(),
  waktuTangkap: z.string().datetime().optional(),
});

const skemaBatalPenolakan = z.object({ returnId: idSkema, alasan: alasanSkema });

const skemaKeputusanBarang = z.object({
  returnId: idSkema,
  keputusan: z.enum(["KEMBALI_STOK", "DIBELI_SPG"]),
  catatan: alasanSkema.optional(),
});

const skemaBesarBeban = z.object({ returnId: idSkema, besar: z.number().finite(), alasan: alasanSkema });

async function sesiDengan(izin: string): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], izin)) return null;
  return session.user.id;
}

/** Jam tangkap antrean HP: masa depan → sekarang, lebih tua dari batas antrean → `undefined` (ditolak). */
function waktuLuring(isi: { luring?: boolean; waktuTangkap?: string }): Date | null | undefined {
  if (!isi.luring || !isi.waktuTangkap) return null;
  return jepitWaktuLuring(isi.waktuTangkap, new Date(), BATAS_STOK_LURING_MS) ?? undefined;
}

/**
 * Halaman yang membaca laporan retur pembeli dan bebannya. Yang disetujui juga
 * mengubah buku stok toko, penjualan bersih, dan komisi; beban mengubah gaji.
 */
function segarkan(spgSaleId: string, returnId: string): void {
  revalidatePath("/backoffice/retur-spg");
  revalidatePath(`/backoffice/retur-spg/${returnId}`);
  revalidatePath(`/backoffice/spg-sales/${spgSaleId}`);
  revalidatePath("/backoffice/komisi-spg");
  revalidatePath("/pwa/spg/retur-pembeli");
  revalidatePath(`/pwa/spg/${spgSaleId}/nota`);
  revalidatePath(`/pwa/spg/${spgSaleId}/kembali`);
  revalidatePath("/pwa/spg/nota");
  revalidatePath("/pwa/spg/stok");
  revalidatePath("/pwa/spg/opname");
  revalidatePath("/pwa/spg/stocktake");
  revalidatePath("/pwa/spg/tutup");
  revalidatePath("/pwa/spg/gaji");
  revalidatePath("/pwa/beban");
  revalidatePath("/pwa");
}

/**
 * Pembeli mengembalikan barang ke counter. SPG MELAPORKANNYA dengan foto barang
 * dan jawaban apakah kasir sudah mengembalikan uangnya ("Sudah" = foto struk
 * wajib). Laporan itu menunggu persetujuan kantor dan belum berpengaruh apa pun.
 */
export async function catatReturPembeliAction(input: unknown): Promise<HasilReturPembeliAksi> {
  const userId = await sesiDengan(PERMISSIONS.SPG_SALES_RECORD);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const isi = skemaLapor.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  const storeId = await ambilTokoTetap(userId);
  if (!storeId) return { ok: false, kode: "TANPA_TOKO" };
  const waktuTangkap = waktuLuring(isi.data);
  if (waktuTangkap === undefined) return { ok: false, kode: "WAKTU_TIDAK_VALID" };

  try {
    const hasil = await catatReturPembeli({
      spgSaleId: isi.data.spgSaleId,
      alasan: isi.data.alasan,
      idempotencyKey: isi.data.idempotencyKey,
      baris: isi.data.baris,
      storeId,
      userId,
      waktuTangkap,
      fotoBarangKey: isi.data.fotoBarangKey ?? null,
      uangSudahDikembalikan: isi.data.uangSudahDikembalikan ?? null,
      fotoStrukKey: isi.data.fotoStrukKey ?? null,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan(isi.data.spgSaleId, hasil.returnId);
    return { ok: true, returnId: hasil.returnId };
  } catch (err) {
    console.error("catatReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Kantor menyetujui laporan retur pembeli: baru sekarang retur berpengaruh, dan
 * HP menyuruh SPG mengembalikan uangnya lewat kasir (kalau belum).
 */
export async function setujuiReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  const userId = await sesiDengan(PERMISSIONS.SPG_RETURNS_APPROVE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const isi = skemaSetujui.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  try {
    const hasil = await setujuiReturPembeli({ returnId: isi.data.returnId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan(hasil.spgSaleId, hasil.returnId);
    return { ok: true };
  } catch (err) {
    console.error("setujuiReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Kantor menolak laporan, dengan alasan. Tanpa uang dikembalikan: barang
 * kembali ke pembeli. Uang sudah dikembalikan (dicatat SPG, atau ditandai
 * sekarang dengan alasan — P78): beban SPG sebesar harga bersih nota, atau
 * angka struk dengan alasan (P81).
 */
export async function tolakReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  const userId = await sesiDengan(PERMISSIONS.SPG_RETURNS_APPROVE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const isi = skemaTolak.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  try {
    const hasil = await tolakReturPembeli({
      returnId: isi.data.returnId,
      olehUserId: userId,
      alasan: isi.data.alasan,
      uangTernyataDikembalikan: isi.data.uangTernyataDikembalikan ?? false,
      alasanUangKembali: isi.data.alasanUangKembali ?? null,
      besarBeban: isi.data.besarBeban ?? null,
      alasanBesarBeban: isi.data.alasanBesarBeban ?? null,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan(hasil.spgSaleId, hasil.returnId);
    return { ok: true };
  } catch (err) {
    console.error("tolakReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * SPG menarik laporannya sendiri selama belum diputuskan dan uangnya belum
 * tercatat dikembalikan (`UANG_SUDAH_DIKEMBALIKAN` sesudahnya).
 */
export async function tarikReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  const userId = await sesiDengan(PERMISSIONS.SPG_SALES_RECORD);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const isi = skemaTarik.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  const storeId = await ambilTokoTetap(userId);
  if (!storeId) return { ok: false, kode: "TANPA_TOKO" };
  try {
    const hasil = await tarikReturPembeli({ returnId: isi.data.returnId, userId, storeId, alasan: isi.data.alasan });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan(hasil.spgSaleId, hasil.returnId);
    return { ok: true };
  } catch (err) {
    console.error("tarikReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * SPG mencatat kasir sudah mengembalikan uang pembeli, dengan foto struk (P77)
 * — sesudah disetujui, atau selama menunggu (kantor diberi tahu). Dari antrean
 * HP: dicatat pada jam ia dilakukan.
 */
export async function catatUangDikembalikanAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  const userId = await sesiDengan(PERMISSIONS.SPG_SALES_RECORD);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const isi = skemaUangKembali.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  const storeId = await ambilTokoTetap(userId);
  if (!storeId) return { ok: false, kode: "TANPA_TOKO" };
  const waktuTangkap = waktuLuring(isi.data);
  if (waktuTangkap === undefined) return { ok: false, kode: "WAKTU_TIDAK_VALID" };
  try {
    const hasil = await catatUangDikembalikan({
      returnId: isi.data.returnId,
      userId,
      storeId,
      fotoStrukKey: isi.data.fotoStrukKey,
      waktuTangkap,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan(hasil.spgSaleId, hasil.returnId);
    return { ok: true };
  } catch (err) {
    console.error("catatUangDikembalikan gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Kantor membatalkan penolakan yang keliru, dengan alasan (P82), selama belum ada yang diambil dari SPG. */
export async function batalkanPenolakanReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  const userId = await sesiDengan(PERMISSIONS.SPG_RETURNS_APPROVE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const isi = skemaBatalPenolakan.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  try {
    const hasil = await batalkanPenolakanReturPembeli({ returnId: isi.data.returnId, olehUserId: userId, alasan: isi.data.alasan });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan(hasil.spgSaleId, hasil.returnId);
    return { ok: true };
  } catch (err) {
    console.error("batalkanPenolakanReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Kantor memutuskan barang beban yang sudah diganti penuh (P79): kembali ke stok, atau dibeli SPG. */
export async function putuskanBarangReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  const userId = await sesiDengan(PERMISSIONS.SPG_RETURNS_APPROVE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const isi = skemaKeputusanBarang.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  try {
    const hasil = await putuskanBarangReturPembeli({
      returnId: isi.data.returnId,
      keputusan: isi.data.keputusan,
      olehUserId: userId,
      catatan: isi.data.catatan ?? null,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan(hasil.spgSaleId, hasil.returnId);
    return { ok: true };
  } catch (err) {
    console.error("putuskanBarangReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Kantor mengubah besar beban menjadi angka struk, dengan alasan (P81), selama belum ada yang dipotong. */
export async function ubahBesarBebanSpgAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  const userId = await sesiDengan(PERMISSIONS.SPG_RETURNS_APPROVE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const isi = skemaBesarBeban.safeParse(input);
  if (!isi.success) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
  try {
    const hasil = await ubahBesarBebanSpg({ returnId: isi.data.returnId, olehUserId: userId, besar: isi.data.besar, alasan: isi.data.alasan });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    revalidatePath("/backoffice/retur-spg");
    revalidatePath(`/backoffice/retur-spg/${hasil.returnId}`);
    revalidatePath("/backoffice/komisi-spg");
    revalidatePath("/pwa/beban");
    revalidatePath("/pwa/spg/gaji");
    revalidatePath("/pwa");
    return { ok: true };
  } catch (err) {
    console.error("ubahBesarBebanSpg gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
