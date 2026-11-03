"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { KodeTolakBerhenti, KodeTolakMulai } from "@/lib/users/spg-berhenti";
import { aturMulaiSpg, batalkanSpgBerhenti, tandaiSpgBerhenti } from "@/lib/users/spg-berhenti-writer";
import { tolakAkunSistem, type KodeAkunSistem } from "@/lib/users/validasi";

/**
 * SPG berhenti, pembatalannya, dan tanggal mulai bekerja SPG (B27, P62, P66) — Pengaturan →
 * Pengguna, `settings_security:manage` (tombolnya memakai izin yang sama), dengan penjaga akun
 * sistem yang sama seperti formulir Pengguna (`tolakAkunSistem`).
 */

type Gagal<K extends string> = { ok: false; code: K | KodeAkunSistem | "TANPA_AKSES" | "INPUT_TIDAK_SAH" | "TIDAK_DITEMUKAN" | "GAGAL" };

export type HasilBerhentiAksi = { ok: true } | Gagal<KodeTolakBerhenti>;
export type HasilBatalBerhentiAksi = { ok: true } | Gagal<"BELUM_BERHENTI" | "SUDAH_DISELESAIKAN" | "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG">;
export type HasilMulaiAksi = { ok: true } | Gagal<KodeTolakMulai>;

/** Pemegang `settings_security:manage` yang boleh menyentuh akun target ini, atau kode tolaknya. */
async function pelaku(targetId: string): Promise<{ ok: true; userId: string } | { ok: false; code: KodeAkunSistem | "TANPA_AKSES" | "TIDAK_DITEMUKAN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTINGS_SECURITY_MANAGE)) return { ok: false, code: "TANPA_AKSES" };
  const [aku, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { roleDefinition: { select: { isSystem: true } } } }),
    prisma.user.findUnique({ where: { id: targetId }, select: { roleDefinition: { select: { isSystem: true } } } }),
  ]);
  if (!target) return { ok: false, code: "TIDAK_DITEMUKAN" };
  const sistem = target.roleDefinition?.isSystem === true;
  const tolak = tolakAkunSistem({ pelakuSistem: aku?.roleDefinition?.isSystem === true, targetSistem: sistem, peranSistem: sistem });
  if (tolak) return { ok: false, code: tolak };
  return { ok: true, userId: session.user.id };
}

function segarkan() {
  revalidatePath("/backoffice/settings/users");
  revalidatePath("/backoffice/komisi-spg");
  revalidatePath("/backoffice/settings/spg-commission");
  revalidatePath("/backoffice/jadwal-spg");
}

export async function tandaiSpgBerhentiAction(input: { userId: unknown; hariTerakhir: unknown; alasan: unknown }): Promise<HasilBerhentiAksi> {
  if (typeof input?.userId !== "string" || !input.userId) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const p = await pelaku(input.userId);
  if (!p.ok) return p;
  try {
    const r = await tandaiSpgBerhenti({ userId: input.userId, hariTerakhir: input.hariTerakhir, alasan: input.alasan, olehUserId: p.userId });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true };
  } catch (e) {
    console.error("[spg-berhenti] tandai", e);
    return { ok: false, code: "GAGAL" };
  }
}

export async function batalkanSpgBerhentiAction(input: { userId: unknown; alasan: unknown }): Promise<HasilBatalBerhentiAksi> {
  if (typeof input?.userId !== "string" || !input.userId) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const p = await pelaku(input.userId);
  if (!p.ok) return p;
  try {
    const r = await batalkanSpgBerhenti({ userId: input.userId, alasan: input.alasan, olehUserId: p.userId });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true };
  } catch (e) {
    console.error("[spg-berhenti] batalkan", e);
    return { ok: false, code: "GAGAL" };
  }
}

export async function aturMulaiSpgAction(input: { userId: unknown; mulai: unknown }): Promise<HasilMulaiAksi> {
  if (typeof input?.userId !== "string" || !input.userId) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const p = await pelaku(input.userId);
  if (!p.ok) return p;
  try {
    const r = await aturMulaiSpg({ userId: input.userId, mulai: input.mulai, olehUserId: p.userId });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    revalidatePath("/pwa/spg/gaji");
    return { ok: true };
  } catch (e) {
    console.error("[spg-berhenti] mulai", e);
    return { ok: false, code: "GAGAL" };
  }
}
