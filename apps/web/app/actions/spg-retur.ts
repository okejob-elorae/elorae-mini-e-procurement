"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { catatReturPembeli, type AlasanTolakReturPembeli } from "@/lib/spg/retur-pembeli";
import { BATAS_STOK_LURING_MS, jepitWaktuLuring } from "@/lib/pwa/waktu-luring";

export type HasilReturPembeliAksi =
  | { ok: true; returnId: string }
  | { ok: false; kode: "TANPA_AKSES" | "TANPA_TOKO" | "ISIAN_TIDAK_VALID" | "WAKTU_TIDAK_VALID" | "GAGAL" | AlasanTolakReturPembeli };

// Toko TIDAK diambil dari HP: ditetapkan dari `User.assignedStoreId`.
const skema = z.object({
  spgSaleId: z.string().min(1),
  alasan: z.string().max(500),
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

/**
 * Pembeli mengembalikan barang ke counter. Kasir toko yang mengembalikan uangnya;
 * di sini hanya barang dan jumlahnya yang dicatat (`catatReturPembeli`).
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
    revalidatePath(`/backoffice/spg-sales/${isi.data.spgSaleId}`);
    return { ok: true, returnId: hasil.returnId };
  } catch (err) {
    console.error("catatReturPembeli gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
