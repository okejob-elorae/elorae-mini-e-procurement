"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import type { GalatPengumuman } from "@/lib/pengumuman/aturan";
import {
  arsipkanPengumuman,
  hapusPengumuman,
  konfirmasiPengumuman,
  pulihkanPengumuman,
  simpanPengumuman,
  tandaiPengumumanDibaca,
} from "@/lib/pengumuman/writer";

/**
 * Aksi pengumuman. Kantor: membuat, mengubah, mengarsipkan, memulihkan,
 * menghapus = `field_sales_orders:approve` (keputusan atas tim lapangan, sama
 * dengan menyetujui pesanannya); melihat = `field_sales_orders:view` (di
 * halaman). HP: membaca dan "Saya mengerti" = `pwa:access`, dan pengumumannya
 * harus terlihat untuk perannya (dijaga penulis).
 *
 * Mengembalikan `{ ok: false, kode }`, tidak melempar — galat yang dilempar
 * disamarkan menjadi digest di produksi.
 */

export type KodeAksiPengumuman = "TANPA_IZIN" | "TIDAK_ADA" | "DIARSIPKAN" | "SUDAH_DIBACA" | "TIDAK_PERLU" | "GAGAL";

export type HasilSimpanPengumumanAksi =
  | { ok: true; id: string; dikabarkan: number; konfirmasiDireset: number }
  | { ok: false; kode: "TIDAK_SAH"; galat: GalatPengumuman[] }
  | { ok: false; kode: KodeAksiPengumuman };

export type HasilAksiPengumuman = { ok: true } | { ok: false; kode: KodeAksiPengumuman };

async function penjagaKantor(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) return null;
  return session.user.id;
}

async function penjagaHp(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (pwaAccessGuard(session.user.permissions) !== "render") return null;
  return session.user.id;
}

function bacaId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

function segarkan(id?: string) {
  revalidatePath("/backoffice/pengumuman");
  if (id) revalidatePath(`/backoffice/pengumuman/${id}`);
  revalidatePath("/pwa");
  revalidatePath("/pwa/pengumuman");
  if (id) revalidatePath(`/pwa/pengumuman/${id}`);
}

/** Simpan: tanpa `id` = buat, dengan `id` = ubah. Isiannya divalidasi ulang di penulis. */
export async function simpanPengumumanAction(input: {
  id?: string | null;
  title: unknown;
  body: unknown;
  audience: unknown;
  pinned?: unknown;
  requireAck?: unknown;
  publishedAt?: unknown;
  expiresAt?: unknown;
  mintaKonfirmasiUlang?: unknown;
}): Promise<HasilSimpanPengumumanAksi> {
  const userId = await penjagaKantor();
  if (!userId) return { ok: false, kode: "TANPA_IZIN" };
  let id: string | undefined;
  if (input.id !== undefined && input.id !== null) {
    const v = bacaId(input.id);
    if (!v) return { ok: false, kode: "TIDAK_ADA" };
    id = v;
  }
  try {
    const r = await simpanPengumuman({
      id,
      userId,
      isian: {
        title: input.title,
        body: input.body,
        audience: input.audience,
        pinned: input.pinned,
        requireAck: input.requireAck,
        publishedAt: input.publishedAt,
        expiresAt: input.expiresAt,
        mintaKonfirmasiUlang: input.mintaKonfirmasiUlang,
      },
    });
    if (r.ok) segarkan(r.id);
    return r;
  } catch (err) {
    console.error("[pengumuman] simpan gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

async function aksiKantor(
  idMentah: unknown,
  jalankan: (id: string, userId: string) => Promise<{ ok: true } | { ok: false; kode: KodeAksiPengumuman }>,
): Promise<HasilAksiPengumuman> {
  const userId = await penjagaKantor();
  if (!userId) return { ok: false, kode: "TANPA_IZIN" };
  const id = bacaId(idMentah);
  if (!id) return { ok: false, kode: "TIDAK_ADA" };
  try {
    const r = await jalankan(id, userId);
    if (r.ok) segarkan(id);
    return r.ok ? { ok: true } : r;
  } catch (err) {
    console.error("[pengumuman] aksi kantor gagal", id, err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Arsipkan: hilang dari HP, laporan bacanya tetap. Idempoten. */
export async function arsipkanPengumumanAction(id: unknown): Promise<HasilAksiPengumuman> {
  return aksiKantor(id, (x, userId) => arsipkanPengumuman({ id: x, userId }));
}

/** Kembalikan dari arsip. */
export async function pulihkanPengumumanAction(id: unknown): Promise<HasilAksiPengumuman> {
  return aksiKantor(id, (x, userId) => pulihkanPengumuman({ id: x, userId }));
}

/** Hapus — hanya selama belum ada yang membaca. */
export async function hapusPengumumanAction(id: unknown): Promise<HasilAksiPengumuman> {
  return aksiKantor(id, (x, userId) => hapusPengumuman({ id: x, userId }));
}

/**
 * HP: pengumuman dibuka = dibaca. `kabarDitandai` > 0 berarti kabar lonceng
 * untuk pengumuman ini ikut ditandai dibaca — layar memancarkan peristiwa
 * supaya lencananya turun.
 */
export async function tandaiPengumumanDibacaAction(
  id: unknown,
): Promise<{ ok: true; kabarDitandai: number } | { ok: false; kode: KodeAksiPengumuman }> {
  const userId = await penjagaHp();
  if (!userId) return { ok: false, kode: "TANPA_IZIN" };
  const x = bacaId(id);
  if (!x) return { ok: false, kode: "TIDAK_ADA" };
  try {
    const r = await tandaiPengumumanDibaca({ id: x, userId });
    if (!r.ok) return r;
    if (r.baru) {
      revalidatePath("/pwa");
      revalidatePath("/pwa/pengumuman");
    }
    return { ok: true, kabarDitandai: r.kabarDitandai };
  } catch (err) {
    console.error("[pengumuman] tandai dibaca gagal", x, err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** HP: "Saya mengerti". Idempoten. */
export async function konfirmasiPengumumanAction(id: unknown): Promise<HasilAksiPengumuman> {
  const userId = await penjagaHp();
  if (!userId) return { ok: false, kode: "TANPA_IZIN" };
  const x = bacaId(id);
  if (!x) return { ok: false, kode: "TIDAK_ADA" };
  try {
    const r = await konfirmasiPengumuman({ id: x, userId });
    if (!r.ok) return r;
    revalidatePath("/pwa");
    revalidatePath("/pwa/pengumuman");
    revalidatePath(`/pwa/pengumuman/${x}`);
    revalidatePath(`/backoffice/pengumuman/${x}`);
    return { ok: true };
  } catch (err) {
    console.error("[pengumuman] konfirmasi gagal", x, err);
    return { ok: false, kode: "GAGAL" };
  }
}
