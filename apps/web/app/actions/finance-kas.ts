"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { batalkanVoucher, catatVoucher, type HasilVoucher } from "@/lib/finance/kas/voucher-writer";
import { pasangKategoriBawaan, simpanKategori, type HasilKategori } from "@/lib/finance/kas/kategori-writer";
import { isiUlangKasKecil, simpanPengaturanKasKecil, type HasilIsiUlang } from "@/lib/finance/kas/kas-kecil-writer";
import type { IsianVoucher } from "@/lib/finance/kas/aturan";
import { bacaBerkasMutasi } from "@/lib/finance/bank/berkas";
import {
  abaikanMutasi,
  bukaAbaikan,
  buatVoucherDariMutasi,
  cocokkanManual,
  cocokkanOtomatisAkun,
  hapusImporMutasi,
  imporMutasi,
  lepasCocok,
  PERAN_CEPAT_MUTASI,
  type HasilImpor,
} from "@/lib/finance/bank/mutasi-writer";
import { kandidatJurnal, type KandidatJurnal } from "@/lib/finance/bank/queries";

/*
 * Aksi kas & bank dan rekonsiliasi bank (rancangan D1). Izin di SETIAP aksi:
 * mencatat/membatalkan voucher, kategori, kas kecil, impor & pencocokan mutasi
 * = keuangan (`journals:manage`); membaca kandidat = `journals:view`. Pelaku
 * dari sesi; hasil `{ ok:false, kode }`, tidak pernah melempar ke layar.
 */

type Gagal<K extends string = string> = { ok: false; kode: K; peran?: string; baris?: number };

async function sesi() {
  const s = await auth();
  if (!s?.user?.id) return null;
  const p = s.user.permissions ?? [];
  return { userId: s.user.id, kelola: hasPermission(p, PERMISSIONS.JOURNALS_MANAGE), lihat: hasPermission(p, PERMISSIONS.JOURNALS_VIEW) };
}

function segarkanKas(id?: string) {
  revalidatePath("/backoffice/finance/kas", "layout");
  if (id) revalidatePath(`/backoffice/finance/kas/${id}`);
  revalidatePath("/backoffice/finance/rekonsiliasi-bank");
  revalidatePath("/backoffice/finance/journals");
  revalidatePath("/backoffice/finance/pph-dipotong");
}

async function aman<T>(nama: string, fn: () => Promise<T>): Promise<T | Gagal<"GAGAL">> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[${nama}] gagal`, e);
    return { ok: false, kode: "GAGAL" };
  }
}

// ───────────────────── Voucher ─────────────────────

export async function catatVoucherAction(input: IsianVoucher & { idempotencyKey?: string | null }): Promise<HasilVoucher | Gagal<"TANPA_AKSES" | "GAGAL">> {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" };
  return aman("catatVoucher", async () => {
    const r = await catatVoucher({ ...(input ?? ({} as IsianVoucher)), olehUserId: s.userId });
    if (r.ok) segarkanKas(r.id);
    return r;
  });
}

export async function batalkanVoucherAction(input: { id: string; alasan: string }): Promise<HasilVoucher | Gagal<"TANPA_AKSES" | "GAGAL">> {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" };
  return aman("batalkanVoucher", async () => {
    const r = await batalkanVoucher({ id: String(input?.id ?? ""), alasan: String(input?.alasan ?? ""), olehUserId: s.userId });
    if (r.ok) segarkanKas(r.id);
    return r;
  });
}

// ───────────────────── Kategori ─────────────────────

export async function simpanKategoriAction(input: {
  id?: string | null;
  nama: string;
  jenis: string;
  akunId: string;
  jenisPotong?: string | null;
  aktif?: boolean;
  urutan?: number;
}): Promise<HasilKategori | Gagal<"TANPA_AKSES" | "GAGAL">> {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" };
  return aman("simpanKategori", async () => {
    const r = await simpanKategori({ ...input, olehUserId: s.userId });
    if (r.ok) segarkanKas();
    return r;
  });
}

export async function pasangKategoriBawaanAction() {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  return aman("pasangKategoriBawaan", async () => {
    const r = await pasangKategoriBawaan(s.userId);
    if (r.ok) segarkanKas();
    return r;
  });
}

// ───────────────────── Kas kecil ─────────────────────

export async function simpanKasKecilAction(input: { dana: Array<{ akunId: string; danaTetap: string | number; pemegang?: string | null; rekeningSumberId?: string | null }> }) {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  return aman("simpanKasKecil", async () => {
    const r = await simpanPengaturanKasKecil(input, s.userId);
    if (r.ok) segarkanKas();
    return r;
  });
}

export async function isiUlangKasKecilAction(input: { akunId: string; rekeningSumberId?: string | null; idempotencyKey?: string | null }): Promise<HasilIsiUlang | Gagal<"TANPA_AKSES" | "GAGAL">> {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" };
  return aman("isiUlangKasKecil", async () => {
    const r = await isiUlangKasKecil({
      akunId: String(input?.akunId ?? ""),
      rekeningSumberId: input?.rekeningSumberId ?? null,
      idempotencyKey: input?.idempotencyKey ?? null,
      olehUserId: s.userId,
    });
    if (r.ok) segarkanKas(r.voucherId);
    return r;
  });
}

// ───────────────────── Rekonsiliasi bank ─────────────────────

const MAKS_UKURAN_BERKAS = 5 * 1024 * 1024;

/** Impor mutasi: FormData `akunId` + `berkas` (CSV/XLS/XLSX). Dibaca di server dengan `raw: true`. */
export async function imporMutasiAction(form: FormData): Promise<HasilImpor | Gagal<"TANPA_AKSES" | "GAGAL" | "BERKAS_WAJIB" | "BERKAS_TERLALU_BESAR" | "BERKAS_RUSAK" | "KEPALA_TIDAK_DITEMUKAN" | "TAHUN_TIDAK_DIKETAHUI" | "TERLALU_BANYAK_BARIS">> {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" };
  const akunId = String(form.get("akunId") ?? "");
  const berkas = form.get("berkas");
  if (!(berkas instanceof File) || berkas.size === 0) return { ok: false, kode: "BERKAS_WAJIB" };
  if (berkas.size > MAKS_UKURAN_BERKAS) return { ok: false, kode: "BERKAS_TERLALU_BESAR" };
  return aman("imporMutasi", async () => {
    const nama = berkas.name || "mutasi";
    const isi = /\.(csv|txt)$/i.test(nama) ? await berkas.text() : new Uint8Array(await berkas.arrayBuffer());
    const baca = bacaBerkasMutasi(isi);
    if (!baca.ok) return baca.kode === "TANPA_BARIS" ? ({ ok: false, kode: "TANPA_BARIS" } as const) : ({ ok: false, kode: baca.kode } as const);
    const r = await imporMutasi({
      akunId,
      namaBerkas: nama,
      format: baca.format,
      baris: baca.baris,
      periodeDari: baca.periodeDari,
      periodeSampai: baca.periodeSampai,
      saldoAwalSen: baca.saldoAwalSen,
      saldoAkhirSen: baca.saldoAkhirSen,
      olehUserId: s.userId,
    });
    if (r.ok) segarkanKas();
    return r;
  });
}

export async function cocokkanOtomatisAction(input: { akunId: string }) {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  return aman("cocokkanOtomatis", async () => {
    const r = await cocokkanOtomatisAkun({ akunId: String(input?.akunId ?? ""), olehUserId: s.userId });
    if (r.ok) segarkanKas();
    return r;
  });
}

export async function cocokkanManualAction(input: { mutasiId: string; barisJurnalId: string }) {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  return aman("cocokkanManual", async () => {
    const r = await cocokkanManual({ mutasiId: String(input?.mutasiId ?? ""), barisJurnalId: String(input?.barisJurnalId ?? ""), olehUserId: s.userId });
    if (r.ok) segarkanKas();
    return r;
  });
}

export async function lepasCocokAction(input: { mutasiId: string }) {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  return aman("lepasCocok", async () => {
    const r = await lepasCocok({ mutasiId: String(input?.mutasiId ?? ""), olehUserId: s.userId });
    if (r.ok) segarkanKas();
    return r;
  });
}

export async function abaikanMutasiAction(input: { mutasiId: string; alasan: string }) {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  return aman("abaikanMutasi", async () => {
    const r = await abaikanMutasi({ mutasiId: String(input?.mutasiId ?? ""), alasan: String(input?.alasan ?? ""), olehUserId: s.userId });
    if (r.ok) segarkanKas();
    return r;
  });
}

export async function bukaAbaikanAction(input: { mutasiId: string }) {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  return aman("bukaAbaikan", async () => {
    const r = await bukaAbaikan({ mutasiId: String(input?.mutasiId ?? ""), olehUserId: s.userId });
    if (r.ok) segarkanKas();
    return r;
  });
}

export async function buatVoucherDariMutasiAction(input: {
  mutasiId: string;
  akunId?: string | null;
  kategoriId?: string | null;
  peranCepat?: string | null;
  keterangan?: string | null;
}) {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  const peran = input?.peranCepat && input.peranCepat in PERAN_CEPAT_MUTASI ? (input.peranCepat as keyof typeof PERAN_CEPAT_MUTASI) : null;
  return aman("buatVoucherDariMutasi", async () => {
    const r = await buatVoucherDariMutasi({
      mutasiId: String(input?.mutasiId ?? ""),
      akunId: input?.akunId ?? null,
      kategoriId: input?.kategoriId ?? null,
      peranCepat: peran,
      keterangan: input?.keterangan ?? null,
      olehUserId: s.userId,
    });
    if (r.ok) segarkanKas(r.voucherId);
    return r;
  });
}

export async function hapusImporMutasiAction(input: { importId: string }) {
  const s = await sesi();
  if (!s?.kelola) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  return aman("hapusImporMutasi", async () => {
    const r = await hapusImporMutasi({ importId: String(input?.importId ?? ""), olehUserId: s.userId });
    if (r.ok) segarkanKas();
    return r;
  });
}

export async function kandidatJurnalAction(input: { mutasiId: string }): Promise<{ ok: true; kandidat: KandidatJurnal[] } | Gagal<"TANPA_AKSES" | "GAGAL">> {
  const s = await sesi();
  if (!s?.lihat) return { ok: false, kode: "TANPA_AKSES" };
  return aman("kandidatJurnal", async () => ({ ok: true as const, kandidat: await kandidatJurnal(String(input?.mutasiId ?? "")) }));
}
