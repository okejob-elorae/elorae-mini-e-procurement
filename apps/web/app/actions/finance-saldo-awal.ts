"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@elorae/db";
import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pasangTemplatAkun, pratinjauTemplatAkun } from "@/lib/finance/templat-akun/pasang";
import type { RencanaTemplat } from "@/lib/finance/templat-akun/rencana";
import { jenisSah, type JenisSaldoAwal } from "@/lib/finance/saldo-awal/jenis";
import { hapusDrafSaldoAwal, postingSaldoAwal, simpanDrafSaldoAwal, type KodeGalatSaldoAwal } from "@/lib/finance/saldo-awal/writer";
import { bacaStokSaldoAwal } from "@/lib/finance/saldo-awal/hitung-queries";
import {
  JUDUL_TEMPLAT_PERSEDIAAN,
  petakanBerkasKeStok,
  pratinjauPersediaan,
  skuTampil,
  type BarisBerkasHpp,
  type IsianHpp,
  type PratinjauPersediaan,
} from "@/lib/finance/saldo-awal/persediaan";
import { rupiahSah } from "@/lib/finance/saldo-awal/validasi";
import { formatDateOnlyJakarta } from "@/lib/date-only";

/*
 * Aksi Saldo awal dan templat bagan akun. Aktor selalu dari `auth()`.
 * Mengelola saldo awal: `journals:manage`. Memasang templat membuat akun DAN
 * memetakan peran, jadi butuh `coa:manage` DAN `journals:manage`.
 * Tidak pernah melempar ke layar — kegagalan tak terduga menjadi `GAGAL`.
 */

type Gagal<K extends string> = { ok: false; kode: K | "TANPA_AKSES" | "GAGAL" };

const HALAMAN = "/backoffice/finance/saldo-awal";

async function aktor(izin: string[]): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const punya = session.user.permissions ?? [];
  return izin.every((p) => hasPermission(punya, p)) ? userId : null;
}

function segarkan() {
  revalidatePath(HALAMAN);
  revalidatePath("/backoffice/finance/coa");
  revalidatePath("/backoffice/finance/account-mapping");
  revalidatePath("/backoffice/finance/journals");
}

// ── Templat bagan akun ───────────────────────────────────────────────────────

export async function pratinjauTemplatAkunAction(): Promise<{ ok: true; rencana: RencanaTemplat } | Gagal<never>> {
  const userId = await aktor([PERMISSIONS.COA_MANAGE, PERMISSIONS.JOURNALS_MANAGE]);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  try {
    return { ok: true, rencana: await pratinjauTemplatAkun() };
  } catch (e) {
    console.error("[templat-akun] pratinjau gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function pasangTemplatAkunAction(): Promise<
  { ok: true; akunDibuat: number; peranDipetakan: number; konflik: number } | Gagal<"BENTROK">
> {
  const userId = await aktor([PERMISSIONS.COA_MANAGE, PERMISSIONS.JOURNALS_MANAGE]);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const h = await pasangTemplatAkun({ olehUserId: userId });
    segarkan();
    return { ok: true, akunDibuat: h.akunDibuat, peranDipetakan: h.peranDipetakan, konflik: h.rencana.konflik.length };
  } catch (e) {
    // Kode akun/peran dibuat orang lain bersamaan: rencana sudah basi, cukup coba lagi.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, kode: "BENTROK" };
    console.error("[templat-akun] pasang gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}

// ── Saldo awal ───────────────────────────────────────────────────────────────

type HasilSaldoAwal = { ok: true } | { ok: false; kode: KodeGalatSaldoAwal | "TANPA_AKSES" | "GAGAL"; baris?: number; peran?: string; periode?: string; rincian?: string };

export async function simpanDrafSaldoAwalAction(input: {
  jenis: JenisSaldoAwal;
  baris: unknown;
  catatan?: string | null;
  namaBerkas?: string | null;
}): Promise<HasilSaldoAwal> {
  const userId = await aktor([PERMISSIONS.JOURNALS_MANAGE]);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  if (!jenisSah(input?.jenis)) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  try {
    // Disusun satu per satu: isian klien tidak boleh membawa `uji` (ruang/tanggal tes).
    const r = await simpanDrafSaldoAwal({ jenis: input.jenis, baris: input.baris, catatan: input.catatan ?? null, namaBerkas: input.namaBerkas ?? null, olehUserId: userId });
    if (!r.ok) return r;
    revalidatePath(HALAMAN);
    return { ok: true };
  } catch (e) {
    console.error("[saldo-awal] simpan draf gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function hapusDrafSaldoAwalAction(input: { jenis: JenisSaldoAwal }): Promise<HasilSaldoAwal> {
  const userId = await aktor([PERMISSIONS.JOURNALS_MANAGE]);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  if (!jenisSah(input?.jenis)) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  try {
    const r = await hapusDrafSaldoAwal({ jenis: input.jenis, olehUserId: userId });
    if (!r.ok) return r;
    revalidatePath(HALAMAN);
    return { ok: true };
  } catch (e) {
    console.error("[saldo-awal] hapus draf gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function postingSaldoAwalAction(input: {
  jenis: JenisSaldoAwal;
  baris: unknown;
  catatan?: string | null;
  namaBerkas?: string | null;
}): Promise<HasilSaldoAwal & { journalId?: string | null }> {
  const userId = await aktor([PERMISSIONS.JOURNALS_MANAGE]);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  if (!jenisSah(input?.jenis)) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  try {
    const r = await postingSaldoAwal({ jenis: input.jenis, baris: input.baris, catatan: input.catatan ?? null, namaBerkas: input.namaBerkas ?? null, olehUserId: userId });
    if (!r.ok) return r;
    segarkan();
    return { ok: true, journalId: r.journalId };
  } catch (e) {
    console.error("[saldo-awal] posting gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Pratinjau persediaan awal dari baris berkas (kunci SKU) ATAU dari isian
 * tersimpan (kunci barang + varian, mis. draf). Yang dikembalikan `isian` —
 * itulah yang disimpan sebagai draf dan dikirim saat posting.
 */
export async function pratinjauPersediaanAwalAction(input: {
  berkas?: BarisBerkasHpp[];
  isian?: IsianHpp[];
}): Promise<
  | { ok: true; pratinjau: PratinjauPersediaan; isian: IsianHpp[]; tidakDikenal: { baris?: number; sku: string }[] }
  | Gagal<"ISIAN_TIDAK_SAH" | "TERLALU_BANYAK">
> {
  const userId = await aktor([PERMISSIONS.JOURNALS_MANAGE]);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const berkas = Array.isArray(input?.berkas) ? input.berkas : null;
  const tersimpan = Array.isArray(input?.isian) ? input.isian : null;
  if (!berkas && !tersimpan) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  if ((berkas?.length ?? 0) + (tersimpan?.length ?? 0) > 50_000) return { ok: false, kode: "TERLALU_BANYAK" };
  const sahBerkas = (berkas ?? []).every((b) => b && typeof b.sku === "string" && rupiahSah(b.hpp));
  const sahIsian = (tersimpan ?? []).every((b) => b && typeof b.itemId === "string" && rupiahSah(b.hpp));
  if (!sahBerkas || !sahIsian) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  try {
    const stok = await bacaStokSaldoAwal();
    const dariBerkas = berkas ? petakanBerkasKeStok(berkas, stok) : { isian: [], tidakDikenal: [] };
    // Isian tersimpan dulu, lalu berkas menimpanya per (barang, varian): unggahan baru mengubah draf, tidak menggandakannya.
    const perKunci = new Map<string, IsianHpp>();
    for (const b of tersimpan ?? []) perKunci.set(`${b.itemId}\u0000${b.variantSku ?? ""}`, { itemId: b.itemId, variantSku: b.variantSku || null, hpp: b.hpp });
    for (const b of dariBerkas.isian) perKunci.set(`${b.itemId}\u0000${b.variantSku ?? ""}`, b);
    const isian = [...perKunci.values()];
    const pratinjau = pratinjauPersediaan(isian, stok);
    return { ok: true, pratinjau, isian, tidakDikenal: [...dariBerkas.tidakDikenal, ...pratinjau.tidakDikenal] };
  } catch (e) {
    console.error("[saldo-awal] pratinjau persediaan gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Daftar stok gudang sebagai berkas Excel isian HPP (kolom "HPP baru" kosong). */
export async function unduhDaftarPersediaanAction(): Promise<{ ok: true; base64: string; namaBerkas: string } | Gagal<never>> {
  const userId = await aktor([PERMISSIONS.JOURNALS_MANAGE]);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const stok = await bacaStokSaldoAwal();
    const baris = stok.map((s) => [skuTampil(s), s.nama, s.variantSku ?? "", s.tipe, s.qty, s.avgCost, ""]);
    const ws = XLSX.utils.aoa_to_sheet([[...JUDUL_TEMPLAT_PERSEDIAAN], ...baris]);
    ws["!cols"] = [{ wch: 24 }, { wch: 32 }, { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Persediaan");
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    return { ok: true, base64: buffer.toString("base64"), namaBerkas: `saldo-awal-persediaan-${formatDateOnlyJakarta(new Date())}.xlsx` };
  } catch (e) {
    console.error("[saldo-awal] unduh daftar persediaan gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}
