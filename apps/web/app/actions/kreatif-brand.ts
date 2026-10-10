"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly } from "@/lib/date-only";
import type { HasilValidasiBrand, PengaturanBrand } from "@/lib/creative/brand-collab";
import { simpanPengaturanBrand } from "@/lib/creative/brand-pengaturan";
import { hapusBrandKol, tambahBrandManual, type KodeTolakBrandManual } from "@/lib/creative/brand-writer";

/*
 * Riwayat brand KOL dan pengaturan "Brand & kompetitor". Setiap aksi memeriksa
 * `creative:manage` sendiri (tidak ada kode izin baru). Penulisnya menulis
 * jejak di transaksinya sendiri. Galat tak terduga dijawab `GAGAL`, tidak
 * dilempar (pesan galat produksi disamarkan Next).
 */

type Gagal = { ok: false; kode: "TANPA_AKSES" | "GAGAL" };

async function pengelola(): Promise<string | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  return hasPermission(s.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE) ? s.user.id : null;
}

export async function simpanPengaturanBrandAction(
  input: unknown,
): Promise<{ ok: true; pengaturan: PengaturanBrand } | Extract<HasilValidasiBrand, { ok: false }> | Gagal> {
  const oleh = await pengelola();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await simpanPengaturanBrand(input, oleh);
    // Lencana Elorae/Kompetitor tampil di direktori Brand dan profil KOL.
    if (r.ok) revalidatePath("/backoffice/kreatif", "layout");
    return r;
  } catch (err) {
    console.error("simpanPengaturanBrand gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function tambahBrandKolAction(input: {
  kolId: string;
  brandHandle: string;
  brandName?: string | null;
  jenis: string;
  postUrl?: string | null;
  /** "YYYY-MM-DD" (hari WIB) atau kosong. */
  tanggal?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; kode: KodeTolakBrandManual } | Gagal> {
  const oleh = await pengelola();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (!input || typeof input.kolId !== "string" || typeof input.brandHandle !== "string" || typeof input.jenis !== "string") {
    return { ok: false, kode: "HANDLE_TIDAK_SAH" };
  }
  let postedAt: Date | null = null;
  if (typeof input.tanggal === "string" && input.tanggal.trim()) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(input.tanggal.trim()) ? parseDateOnly(input.tanggal) : undefined;
    if (!d) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
    postedAt = d;
  }
  try {
    const r = await tambahBrandManual({
      kolId: input.kolId,
      brandHandle: input.brandHandle,
      brandName: typeof input.brandName === "string" ? input.brandName : null,
      jenis: input.jenis,
      postUrl: typeof input.postUrl === "string" ? input.postUrl : null,
      postedAt,
      olehUserId: oleh,
    });
    if (r.ok) segarkan(input.kolId);
    return r;
  } catch (err) {
    console.error("tambahBrandManual gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function hapusBrandKolAction(input: { id: string; kolId: string }): Promise<{ ok: true } | { ok: false; kode: "TIDAK_DITEMUKAN" } | Gagal> {
  const oleh = await pengelola();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (!input || typeof input.id !== "string" || typeof input.kolId !== "string") return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await hapusBrandKol({ id: input.id, kolId: input.kolId, olehUserId: oleh });
    if (r.ok) segarkan(input.kolId);
    return r;
  } catch (err) {
    console.error("hapusBrandKol gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

function segarkan(kolId: string) {
  revalidatePath(`/backoffice/kreatif/kol/${kolId}`);
  revalidatePath("/backoffice/kreatif/brand");
}
