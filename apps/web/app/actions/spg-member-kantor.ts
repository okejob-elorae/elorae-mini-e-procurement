"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { aturAktifMember } from "@/lib/spg/member-writer";

/**
 * Kantor menonaktifkan (alasan wajib) atau mengaktifkan kembali member, dari
 * Kantor → Pelanggan SPG → Member. Izinnya `promos:manage`, sama dengan kartu
 * pengaturan member (melihat halamannya cukup `spg_sales:view`) — tidak ada izin baru. Jejak `AuditLog` ditulis penulisnya di dalam
 * transaksinya; pelakunya selalu dari sesi, tidak pernah dari pemanggil.
 */

export type HasilAktifMember = { ok: true; berubah: boolean } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "TIDAK_ADA" | "ALASAN_WAJIB" | "GAGAL" };

export async function aturAktifMemberAction(isi: { memberId: string; aktif: boolean; alasan?: string | null }): Promise<HasilAktifMember> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.PROMOS_MANAGE)) return { ok: false, code: "FORBIDDEN" };
  if (!isi || typeof isi.memberId !== "string" || typeof isi.aktif !== "boolean") return { ok: false, code: "TIDAK_ADA" };
  const alasan = typeof isi.alasan === "string" ? isi.alasan : null;
  try {
    const r = await aturAktifMember({ memberId: isi.memberId, aktif: isi.aktif, alasan, userId });
    if (r.ok) revalidatePath("/backoffice/spg-pelanggan");
    return r;
  } catch (e) {
    console.error("[aturAktifMemberAction]", e);
    return { ok: false, code: "GAGAL" };
  }
}
