"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { approveStoreChangeRequest, rejectStoreChangeRequest } from "@/lib/store-changes/writer";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";

export type StoreChangeActionResult =
  | { ok: true }
  | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" | "INVALID_STATE" | "STORE_GONE" };

/**
 * Kabar ke salesman yang mengusulkan perubahan data toko bahwa usulannya sudah diputuskan.
 * Tanpa ini ia hanya melihat usulannya hilang dari halaman toko tanpa tahu hasilnya.
 * Dipanggil SESUDAH transaksinya selesai dan tidak pernah melempar. Nama tokonya dibaca
 * sesudah keputusan, jadi usulan nama yang disetujui sudah tampil dengan nama barunya.
 */
async function kabarPerubahanToko(requestId: string, alasanTolak: string | null, pelakuId: string): Promise<void> {
  try {
    const usulan = await prisma.storeChangeRequest.findUnique({
      where: { id: requestId },
      select: { storeId: true, requestedById: true, store: { select: { name: true } } },
    });
    if (!usulan || usulan.requestedById === pelakuId) return;
    await kabariPengguna(
      usulan.requestedById,
      alasanTolak === null
        ? {
            jenis: JENIS_KABAR.PERUBAHAN_TOKO_DISETUJUI,
            judul: `Perubahan data ${usulan.store.name} disetujui`,
            isi: "Data toko sudah diperbarui sesuai usulan Anda.",
            data: { storeId: usulan.storeId },
          }
        : {
            jenis: JENIS_KABAR.PERUBAHAN_TOKO_DITOLAK,
            judul: `Perubahan data ${usulan.store.name} ditolak`,
            isi: `Alasan: ${alasanTolak}`,
            data: { storeId: usulan.storeId },
          },
    );
  } catch (err) {
    console.error("[kabar] perubahan toko gagal", requestId, err);
  }
}

async function guard(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

export async function approveStoreChangeRequestAction(requestId: string, storeId: string): Promise<StoreChangeActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  const res = await approveStoreChangeRequest({ requestId, reviewerId: g.userId });
  if (!res.ok) return { ok: false, reason: res.code };
  revalidatePath("/backoffice/stores");
  revalidatePath(`/backoffice/stores/${storeId}`);
  void kabarPerubahanToko(requestId, null, g.userId);
  return { ok: true };
}

export async function rejectStoreChangeRequestAction(requestId: string, storeId: string, reason: string): Promise<StoreChangeActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, reason: "INVALID_STATE" };
  const res = await rejectStoreChangeRequest({ requestId, reviewerId: g.userId, reason: trimmed });
  if (!res.ok) return { ok: false, reason: res.code };
  revalidatePath("/backoffice/stores");
  revalidatePath(`/backoffice/stores/${storeId}`);
  void kabarPerubahanToko(requestId, trimmed, g.userId);
  return { ok: true };
}
