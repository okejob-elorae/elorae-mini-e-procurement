"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarGajiBulananSpg, type BarisGajiBulananSpg } from "@/lib/spg/gaji-pokok-queries";
import { aturGajiBulananSpg, type KodeTolakGaji } from "@/lib/spg/gaji-pokok-writer";

/**
 * Gaji pokok bulanan SPG (P7a) — Pengaturan → Komisi SPG #gaji-pokok, `spg_commission:manage`
 * (melihat dan mengubah; tombol memakai izin yang sama). Satu jumlah per SPG berlaku mulai bulan
 * kerja tertentu; perubahan yang menggeser gaji bulan yang sudah dibayar ditolak
 * (`BULAN_SUDAH_DIBAYAR`, menyebut bulannya). Jejak `SPG_SALARY_SET` di transaksi penulisnya.
 */

export type HasilGajiSpgAksi = { ok: true } | { ok: false; code: KodeTolakGaji | "TANPA_AKSES" | "INPUT_TIDAK_SAH" | "GAGAL"; bulan?: string };

async function pengelola(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_COMMISSION_MANAGE)) return null;
  return session.user.id;
}

export async function daftarGajiBulananSpgAction(): Promise<{ ok: true; baris: BarisGajiBulananSpg[] } | { ok: false; code: "TANPA_AKSES" }> {
  if (!(await pengelola())) return { ok: false, code: "TANPA_AKSES" };
  return { ok: true, baris: await daftarGajiBulananSpg() };
}

export async function aturGajiBulananSpgAction(input: { userId: unknown; jumlah: unknown; berlakuMulai: unknown }): Promise<HasilGajiSpgAksi> {
  const olehUserId = await pengelola();
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  if (typeof input?.userId !== "string" || !input.userId) return { ok: false, code: "INPUT_TIDAK_SAH" };
  try {
    const r = await aturGajiBulananSpg({ userId: input.userId, jumlah: input.jumlah, berlakuMulai: input.berlakuMulai, olehUserId });
    if (!r.ok) return { ok: false, code: r.kode, ...(r.bulan ? { bulan: r.bulan } : {}) };
    revalidatePath("/backoffice/settings/spg-commission");
    revalidatePath("/backoffice/komisi-spg");
    revalidatePath("/pwa/spg/gaji");
    return { ok: true };
  } catch (e) {
    console.error("[spg-gaji] atur", e);
    return { ok: false, code: "GAGAL" };
  }
}
