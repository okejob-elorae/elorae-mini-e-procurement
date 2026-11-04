"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaAturanShift, KUNCI_SHIFT } from "@/lib/spg/pengaturan";
import { periksaAturanShift, type KodeTolakAturanShift } from "@/lib/spg/shift";

/**
 * Pengaturan → SPG → Shift: daftar jenis shift dan toleransi terlambat
 * (`SystemSetting["spg.shift"]`). Dijaga `stores:manage` — pengelola toko
 * yang menyusun jadwal SPG; izin itu sudah ada, tidak ada yang perlu di-seed.
 *
 * Jadwal yang sudah tersusun MENYALIN jam shift saat disimpan, jadi mengubah
 * atau menghapus jenis shift di sini tidak menggeser jadwal yang sudah ada.
 */

export type HasilSimpanAturanShift = { ok: true } | { ok: false; code: "TANPA_AKSES" | KodeTolakAturanShift | "GAGAL"; indeks?: number };

export async function simpanAturanShiftAction(isi: unknown): Promise<HasilSimpanAturanShift> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, code: "TANPA_AKSES" };
  }
  const r = periksaAturanShift(isi);
  if (!r.ok) return { ok: false, code: r.kode, ...(r.indeks !== undefined ? { indeks: r.indeks } : {}) };
  const nilai = JSON.stringify(r.nilai);
  // Yang disimpan harus terbaca kembali persis sama oleh pembacanya.
  if (JSON.stringify(bacaAturanShift(nilai)) !== nilai) return { ok: false, code: "GAGAL" };
  try {
    await prisma.systemSetting.upsert({ where: { key: KUNCI_SHIFT }, create: { key: KUNCI_SHIFT, value: nilai }, update: { value: nilai } });
  } catch (err) {
    console.error("simpanAturanShift gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
  revalidatePath("/backoffice/settings/spg");
  revalidatePath("/backoffice/jadwal-spg");
  revalidatePath("/pwa/spg/jadwal");
  revalidatePath("/pwa");
  return { ok: true };
}
