"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaKunciBulan, bulanSudahBerakhir } from "@/lib/finance/periode/periode";
import type { IsianAset } from "@/lib/finance/aset/aturan";
import { batalkanAset, batalkanPelepasan, catatAset, lepasAset, ubahAset, type HasilAset } from "@/lib/finance/aset/writer";
import { postingPenyusutan, type RingkasanPenyusutan } from "@/lib/finance/aset/penyusutan";

/*
 * Aksi aset tetap (rancangan akuntansi & pajak lengkap, bagian D3). Melihat
 * `journals:view`; mencatat, mengubah, melepas, membatalkan, dan memposting
 * penyusutan `journals:manage`. Aktor selalu dari `auth()`. Tidak pernah
 * melempar ke layar: `{ ok: false, kode }`.
 */

type Gagal = { ok: false; kode: string; peran?: string };

async function pengelola(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE) ? session.user.id : null;
}

function segarkan(id?: string) {
  revalidatePath("/backoffice/finance/aset-tetap");
  if (id) revalidatePath(`/backoffice/finance/aset-tetap/${id}`);
  revalidatePath("/backoffice/finance/journals");
}

async function aman<T>(nama: string, fn: () => Promise<T | Gagal>): Promise<T | Gagal> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[finance-aset] ${nama} gagal`, e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function catatAsetAction(input: IsianAset & { idempotencyKey?: string | null }): Promise<HasilAset | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("catat", async () => {
    const r = await catatAset({ ...input, olehUserId: userId });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

export async function ubahAsetAction(input: IsianAset & { id: string }): Promise<HasilAset | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("ubah", async () => {
    const r = await ubahAset({ ...input, id: String(input.id ?? ""), olehUserId: userId });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

export async function batalkanAsetAction(input: { id: string; alasan: string }): Promise<HasilAset | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("batal", async () => {
    const r = await batalkanAset({ id: String(input.id ?? ""), alasan: String(input.alasan ?? ""), olehUserId: userId });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

export async function lepasAsetAction(input: {
  id: string;
  tanggal: string;
  hasilJual: string;
  akunPenerimaanId?: string | null;
  catatan?: string | null;
}): Promise<HasilAset | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("lepas", async () => {
    const r = await lepasAset({
      id: String(input.id ?? ""),
      tanggal: String(input.tanggal ?? ""),
      hasilJual: input.hasilJual,
      akunPenerimaanId: input.akunPenerimaanId ?? null,
      catatan: input.catatan ?? null,
      olehUserId: userId,
    });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

export async function batalkanPelepasanAction(input: { id: string; alasan: string }): Promise<HasilAset | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("batal lepas", async () => {
    const r = await batalkanPelepasan({ id: String(input.id ?? ""), alasan: String(input.alasan ?? ""), olehUserId: userId });
    if (r.ok) segarkan(r.id);
    return r;
  });
}

/**
 * Posting penyusutan sampai bulan `bulan` ("YYYY-MM") untuk semua aset, atau
 * `asetIds`. Bulan sesudah bulan ini tidak sah; bulan berjalan ditolak
 * (`BULAN_BELUM_BERAKHIR`) sampai hari terakhirnya lewat (WIB) — cron
 * memposting bulan lalu di tanggal 1.
 */
export async function postingPenyusutanAction(input: { bulan: string; asetIds?: string[] }): Promise<({ ok: true } & RingkasanPenyusutan) | Gagal> {
  const userId = await pengelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const tb = bacaKunciBulan(input.bulan);
  if (!tb || input.bulan > hariIniWib().slice(0, 7)) return { ok: false, kode: "BULAN_TIDAK_SAH" };
  if (!bulanSudahBerakhir(tb, new Date())) return { ok: false, kode: "BULAN_BELUM_BERAKHIR" };
  return aman("posting penyusutan", async () => {
    const asetIds = Array.isArray(input.asetIds) ? input.asetIds.filter((x) => typeof x === "string" && x).slice(0, 500) : undefined;
    const r = await postingPenyusutan({ sampai: tb, olehUserId: userId, ...(asetIds ? { asetIds } : {}) });
    segarkan(asetIds?.length === 1 ? asetIds[0] : undefined);
    return { ok: true as const, ...r };
  });
}
