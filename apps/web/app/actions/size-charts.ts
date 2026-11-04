"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { IsianTabelUkuran } from "@/lib/items/size-chart";
import { pilihanTabelUkuran, type PilihanTabelUkuran } from "@/lib/items/size-chart-queries";
import {
  hapusTabelUkuran,
  simpanTabelUkuran,
  type HasilHapusTabelUkuran,
  type HasilSimpanTabelUkuran,
} from "@/lib/items/size-chart-writer";

/**
 * Aksi master tabel ukuran. Lihat = `items:view`, ubah = `items:manage`.
 * Hasil berupa kode, tidak pernah melempar: pesan galat aksi server
 * disamarkan menjadi digest di produksi.
 */

type TanpaAkses = { ok: false; code: "TANPA_AKSES" };
type Gagal = { ok: false; code: "GAGAL" };

async function izin(kode: string): Promise<{ userId: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!hasPermission(session.user.permissions ?? [], kode)) return null;
  return { userId: session.user.id };
}

const segarkan = () => {
  revalidatePath("/backoffice/items/size-charts");
  revalidatePath("/backoffice/items");
};

export async function simpanTabelUkuranAction(
  id: string | null,
  isian: IsianTabelUkuran,
): Promise<HasilSimpanTabelUkuran | TanpaAkses | Gagal> {
  const s = await izin(PERMISSIONS.ITEMS_MANAGE);
  if (!s) return { ok: false, code: "TANPA_AKSES" };
  try {
    const hasil = await simpanTabelUkuran({ id, isian, userId: s.userId });
    if (hasil.ok) segarkan();
    return hasil;
  } catch (e) {
    console.error("simpanTabelUkuranAction", e);
    return { ok: false, code: "GAGAL" };
  }
}

export async function hapusTabelUkuranAction(id: string): Promise<HasilHapusTabelUkuran | TanpaAkses | Gagal> {
  const s = await izin(PERMISSIONS.ITEMS_MANAGE);
  if (!s) return { ok: false, code: "TANPA_AKSES" };
  try {
    const hasil = await hapusTabelUkuran({ id, userId: s.userId });
    if (hasil.ok) segarkan();
    return hasil;
  } catch (e) {
    console.error("hapusTabelUkuranAction", e);
    return { ok: false, code: "GAGAL" };
  }
}

/** Pilihan tabel untuk formulir barang (aktif + yang sedang terpasang). */
export async function pilihanTabelUkuranAction(
  sertakanId?: string | null,
): Promise<{ ok: true; data: PilihanTabelUkuran[] } | TanpaAkses | Gagal> {
  const s = await izin(PERMISSIONS.ITEMS_VIEW);
  if (!s) return { ok: false, code: "TANPA_AKSES" };
  try {
    return { ok: true, data: await pilihanTabelUkuran(typeof sertakanId === "string" ? sertakanId : null) };
  } catch (e) {
    console.error("pilihanTabelUkuranAction", e);
    return { ok: false, code: "GAGAL" };
  }
}
