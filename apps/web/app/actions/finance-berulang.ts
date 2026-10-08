"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { IsianTemplat } from "@/lib/finance/berulang/aturan";
import {
  aktifkanTemplat,
  buatTemplat,
  hapusTemplat,
  hentikanTemplat,
  jalankanJurnalBerulang,
  ubahTemplat,
  type HasilTemplat,
  type RingkasanBerulang,
} from "@/lib/finance/berulang/writer";

/*
 * Aksi jurnal berulang & akrual (rancangan akuntansi & pajak lengkap, bagian
 * D4). Melihat `journals:view`; semua perubahan `journals:manage`. Aktor
 * selalu dari `auth()`; penulisnya menolak penyetuju = pengubah isi terakhir.
 * Tidak pernah melempar ke layar: `{ ok: false, kode }`.
 */

type Gagal = { ok: false; kode: string; baris?: number };

async function pengelola(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE) ? session.user.id : null;
}

function segarkan(id?: string) {
  revalidatePath("/backoffice/finance/jurnal-berulang");
  if (id) revalidatePath(`/backoffice/finance/jurnal-berulang/${id}`);
  revalidatePath("/backoffice/finance/journals");
}

async function aman<T>(nama: string, fn: () => Promise<T | Gagal>): Promise<T | Gagal> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[finance-berulang] ${nama} gagal`, e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function buatTemplatAction(input: IsianTemplat & { idempotencyKey?: string | null }): Promise<HasilTemplat | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("buat", async () => {
    const r = await buatTemplat({ ...input, olehUserId: userId });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

export async function ubahTemplatAction(input: IsianTemplat & { id: string }): Promise<HasilTemplat | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("ubah", async () => {
    const r = await ubahTemplat({ ...input, id: String(input.id ?? ""), olehUserId: userId });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

/**
 * Menyetujui (atau melanjutkan) templat, lalu langsung memposting bulan yang
 * sudah jatuh tempo — kegagalan posting tidak membatalkan persetujuannya.
 */
export async function aktifkanTemplatAction(input: { id: string }): Promise<(HasilTemplat & { disetujui?: boolean; posting?: RingkasanBerulang }) | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("aktifkan", async () => {
    const r = await aktifkanTemplat({ id: String(input.id ?? ""), olehUserId: userId });
    if (!r.ok) return r;
    let posting: RingkasanBerulang | undefined;
    try {
      posting = await jalankanJurnalBerulang({ olehUserId: userId, templatIds: [r.id] });
    } catch (e) {
      console.error("[finance-berulang] posting sesudah aktif gagal", e);
    }
    segarkan(r.id);
    return { ...r, ...(posting ? { posting } : {}) };
  });
}

export async function hentikanTemplatAction(input: { id: string }): Promise<HasilTemplat | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("hentikan", async () => {
    const r = await hentikanTemplat({ id: String(input.id ?? ""), olehUserId: userId });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

export async function hapusTemplatAction(input: { id: string }): Promise<HasilTemplat | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("hapus", async () => {
    const r = await hapusTemplat({ id: String(input.id ?? ""), olehUserId: userId });
    if (r.ok) segarkan();
    return r;
  });
}

/** Memposting sekarang bulan jatuh tempo templat aktif (satu templat, atau semuanya). */
export async function postingBerulangAction(input: { templatId?: string | null }): Promise<({ ok: true } & RingkasanBerulang) | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("posting", async () => {
    const id = typeof input.templatId === "string" && input.templatId ? input.templatId : null;
    const r = await jalankanJurnalBerulang({ olehUserId: userId, ...(id ? { templatIds: [id] } : {}) });
    segarkan(id ?? undefined);
    return { ok: true as const, ...r };
  });
}
