"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { tambahPelanggan, ubahPelanggan } from "@/lib/spg/pelanggan-writer";

/**
 * Data pembeli dari HP SPG. Toko TIDAK PERNAH diambil dari layar: selalu toko
 * tetap SPG (`User.assignedStoreId`), jadi SPG hanya pernah mencatat dan
 * mengubah pelanggan tokonya sendiri. Hasil dikembalikan sebagai kode, tidak
 * dilempar, supaya pesan galat tidak disamarkan Next di produksi.
 */

export type HasilPelangganAksi =
  | { ok: true; id: string; sudahAda?: boolean; nama?: string }
  | { ok: false; code: string; idLain?: string; namaLain?: string };

async function konteks(): Promise<{ userId: string; storeId: string } | { ok: false; code: "FORBIDDEN" | "NO_ASSIGNED_STORE" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const storeId = await ambilTokoTetap(session.user.id);
  if (!storeId) return { ok: false, code: "NO_ASSIGNED_STORE" };
  return { userId: session.user.id, storeId };
}

const segarkan = (id?: string) => {
  revalidatePath("/pwa/spg/pelanggan");
  if (id) revalidatePath(`/pwa/spg/pelanggan/${id}`);
  revalidatePath("/backoffice/spg-pelanggan");
};

const isianSchema = z.object({
  nama: z.string().max(200),
  hp: z.string().max(40),
  setuju: z.boolean().optional(),
  catatan: z.string().max(1000).nullable().optional(),
});

export async function tambahPelangganAction(input: unknown): Promise<HasilPelangganAksi> {
  const parsed = isianSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteks();
  if ("ok" in k) return k;
  const hasil = await tambahPelanggan({ storeId: k.storeId, userId: k.userId, isian: parsed.data });
  if (!hasil.ok) return { ok: false, code: hasil.code };
  segarkan(hasil.id);
  return { ok: true, id: hasil.id, sudahAda: hasil.sudahAda, nama: hasil.nama };
}

const ubahSchema = isianSchema.extend({ id: z.string().min(1).max(100) });

export async function ubahPelangganAction(input: unknown): Promise<HasilPelangganAksi> {
  const parsed = ubahSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteks();
  if ("ok" in k) return k;
  const { id, ...isian } = parsed.data;
  const hasil = await ubahPelanggan({ storeId: k.storeId, userId: k.userId, id, isian });
  if (!hasil.ok) {
    return hasil.code === "HP_DIPAKAI" ? { ok: false, code: hasil.code, idLain: hasil.idLain, namaLain: hasil.namaLain } : { ok: false, code: hasil.code };
  }
  segarkan(id);
  return { ok: true, id };
}
