"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { setujuiUsulanToko, tolakUsulanToko, type KodeGagalSetujui } from "@/lib/stores/usulan-writer";
import type { MasukanPersetujuan } from "@/lib/stores/usulan-toko";

/**
 * Aksi backoffice untuk usulan toko baru. Melihat butuh `stores:view`
 * (digerbangi halamannya); menyetujui dan menolak butuh `stores:manage` —
 * izin yang sama dengan membuat toko langsung dari Master Toko.
 */

async function pengelola(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE) ? session.user.id : null;
}

function segarkan(proposalId: string) {
  revalidatePath("/backoffice/stores");
  revalidatePath("/backoffice/stores/usulan");
  revalidatePath(`/backoffice/stores/usulan/${proposalId}`);
  revalidatePath("/pwa/stores");
  revalidatePath("/pwa/stores/usulan");
}

export async function setujuiUsulanTokoAction(
  proposalId: string,
  masukan: MasukanPersetujuan,
): Promise<{ ok: true; storeId: string } | { ok: false; code: KodeGagalSetujui | "TANPA_AKSES" }> {
  const userId = await pengelola();
  if (!userId) return { ok: false, code: "TANPA_AKSES" };
  if (typeof proposalId !== "string" || proposalId === "") return { ok: false, code: "TIDAK_DITEMUKAN" };
  const hasil = await setujuiUsulanToko({ proposalId, reviewerId: userId, masukan: masukan ?? {} });
  if (hasil.ok) segarkan(proposalId);
  return hasil;
}

export async function tolakUsulanTokoAction(
  proposalId: string,
  alasan: string,
): Promise<
  | { ok: true }
  | { ok: false; code: "TANPA_AKSES" | "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG" | "TIDAK_DITEMUKAN" | "SUDAH_DIPUTUSKAN" }
> {
  const userId = await pengelola();
  if (!userId) return { ok: false, code: "TANPA_AKSES" };
  if (typeof proposalId !== "string" || proposalId === "") return { ok: false, code: "TIDAK_DITEMUKAN" };
  const hasil = await tolakUsulanToko({ proposalId, reviewerId: userId, alasan: typeof alasan === "string" ? alasan : "" });
  if (hasil.ok) segarkan(proposalId);
  return hasil;
}
