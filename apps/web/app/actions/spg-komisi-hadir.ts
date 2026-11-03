"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { uploadToR2 } from "@/lib/r2";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { GalatBaris } from "@/lib/spg/absen-catatan-hadir";
import { bacaBerkasCatatanHadir, templateCatatanHadir } from "@/lib/spg/absen-catatan-hadir-berkas";
import {
  kembalikanCatatanHadir,
  periksaCatatanHadir,
  simpanCatatanHadir,
  type KodePeriksaCatatan,
  type KodeSimpanCatatan,
} from "@/lib/spg/absen-catatan-hadir-writer";
import { bulanSahGaji, masaKerjaBulan } from "@/lib/spg/gaji-pokok";

/**
 * Catatan check-in toko untuk SPG yang tidak mengisi jadwalnya (P7d, P7e, P61a).
 *
 * Memasukkan (diketik atau berkas Excel/CSV) = `spg_attendance:record` (bawaannya admin dan
 * ADMIN_PENJUALAN); memeriksa atau mengembalikan = `spg_attendance:verify` (bawaannya admin dan
 * KEUANGAN) — yang pernah menyimpan catatan itu tidak pernah memeriksanya (`PEMERIKSA_SAMA`, di
 * penulisnya). Tombol di halaman memakai izin yang sama.
 *
 * Berkas asli (Excel/CSV yang diimpor) atau foto kertasnya (diketik) disimpan di R2 — BOLEH, tidak
 * wajib (B13). Kalau penyimpanannya gagal, catatannya tetap disimpan tanpa berkas dan layar
 * diberi tahu (`tanpaBerkas`); bukan alasan menahan catatan yang isinya sudah sah.
 */

const MAKS_BERKAS = 2 * 1024 * 1024;
const JENIS_BERKAS = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "",
]);

export type HasilSimpanCatatanAksi =
  | { ok: true; versi: number; tanpaBerkas: boolean }
  | { ok: false; code: KodeSimpanCatatan | "TANPA_AKSES" | "INPUT_TIDAK_SAH" | "BERKAS_TIDAK_SAH" | "FOTO_TIDAK_SAH" | "GAGAL"; galat?: GalatBaris[] };

export type HasilPeriksaCatatanAksi = { ok: true } | { ok: false; code: KodePeriksaCatatan | "TANPA_AKSES" | "INPUT_TIDAK_SAH" | "GAGAL" };

async function pengguna(izin: string): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], izin)) return null;
  return session.user.id;
}

function segarkan() {
  revalidatePath("/backoffice/komisi-spg");
  revalidatePath("/backoffice/komisi-spg/catatan-hadir");
  revalidatePath("/pwa/spg/gaji");
}

const teks = (x: unknown) => (typeof x === "string" ? x : "");
const versiAtauNull = (x: unknown): number | null | undefined =>
  x === null ? null : typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : undefined;

const MAKS_FOTO = 5 * 1024 * 1024;
const JENIS_FOTO: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Unggah ke R2; `null` kalau gagal (catatannya tetap disimpan tanpa berkas, B13). */
async function unggahBerkas(key: string, isi: ArrayBuffer, jenis: string): Promise<string | null> {
  try {
    await uploadToR2(key, new Uint8Array(isi), jenis);
    return key;
  } catch (e) {
    console.error("[spg-komisi-hadir] unggah berkas", e);
    return null;
  }
}

/**
 * Simpan catatan yang diketik di layar (satu baris per hari masa kerjanya). FormData: `userId`,
 * `bulan`, `versi` ("" = belum ada), `hari` (JSON), dan `foto` kertasnya (boleh kosong).
 */
export async function simpanCatatanHadirAction(form: FormData): Promise<HasilSimpanCatatanAksi> {
  const olehUserId = await pengguna(PERMISSIONS.SPG_ATTENDANCE_RECORD);
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  const userId = teks(form.get("userId"));
  const bulan = teks(form.get("bulan"));
  const versiTeks = teks(form.get("versi"));
  const versi = versiAtauNull(versiTeks === "" ? null : Number(versiTeks));
  let hari: unknown;
  try {
    hari = JSON.parse(teks(form.get("hari")) || "null");
  } catch {
    return { ok: false, code: "INPUT_TIDAK_SAH" };
  }
  if (!userId || !bulanSahGaji(bulan) || versi === undefined) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const isianFoto = form.get("foto");
  const foto = isianFoto instanceof File && isianFoto.size > 0 ? isianFoto : null;
  if (foto && (foto.size > MAKS_FOTO || !JENIS_FOTO[foto.type])) return { ok: false, code: "FOTO_TIDAK_SAH" };
  try {
    const key = foto ? await unggahBerkas(`spg-catatan-hadir/${userId}/${bulan}/${randomUUID()}.${JENIS_FOTO[foto.type]}`, await foto.arrayBuffer(), foto.type) : null;
    const r = await simpanCatatanHadir({ userId, bulan, hari, sumber: "MANUAL", berkasR2Key: key, versi, olehUserId });
    if (!r.ok) return { ok: false, code: r.kode, ...(r.galat ? { galat: r.galat } : {}) };
    segarkan();
    return { ok: true, versi: r.versi, tanpaBerkas: foto !== null && key === null };
  } catch (e) {
    console.error("[spg-komisi-hadir] simpan", e);
    return { ok: false, code: "GAGAL" };
  }
}

/**
 * Impor berkas Excel/CSV. Berkas dibaca di server (`raw: true`), galatnya disebut per baris berkas.
 * Berkas aslinya disimpan di R2 sebagai lampiran (boleh, B13): kalau penyimpanannya gagal, catatan
 * tetap ditulis tanpa lampiran dan layar memberi tahu (`tanpaBerkas`).
 */
export async function imporCatatanHadirAction(form: FormData): Promise<HasilSimpanCatatanAksi> {
  const olehUserId = await pengguna(PERMISSIONS.SPG_ATTENDANCE_RECORD);
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  const userId = teks(form.get("userId"));
  const bulan = teks(form.get("bulan"));
  const versiTeks = teks(form.get("versi"));
  const versi = versiTeks === "" ? null : Number(versiTeks);
  const berkas = form.get("berkas");
  if (!userId || !bulanSahGaji(bulan) || (versi !== null && (!Number.isInteger(versi) || versi < 0))) return { ok: false, code: "INPUT_TIDAK_SAH" };
  if (!(berkas instanceof File) || berkas.size === 0 || berkas.size > MAKS_BERKAS || !JENIS_BERKAS.has(berkas.type)) return { ok: false, code: "BERKAS_TIDAK_SAH" };
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { spgStartedOn: true, spgEndedOn: true } });
    if (!u) return { ok: false, code: "BUKAN_SPG" };
    const isi = await berkas.arrayBuffer();
    const baca = bacaBerkasCatatanHadir(isi, masaKerjaBulan(bulan, u.spgStartedOn, u.spgEndedOn), kunciHariWib(new Date()));
    if (!baca.ok) return { ok: false, code: baca.galat[0]?.kode ?? "BERKAS_TIDAK_SAH", galat: baca.galat };
    const csv = /\.csv$/i.test(berkas.name);
    const key = await unggahBerkas(
      `spg-catatan-hadir/${userId}/${bulan}/${randomUUID()}.${csv ? "csv" : "xlsx"}`,
      isi,
      csv ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const r = await simpanCatatanHadir({ userId, bulan, hari: baca.hari, sumber: "EXCEL", berkasR2Key: key, versi, olehUserId });
    if (!r.ok) return { ok: false, code: r.kode, ...(r.galat ? { galat: r.galat } : {}) };
    segarkan();
    return { ok: true, versi: r.versi, tanpaBerkas: key === null };
  } catch (e) {
    console.error("[spg-komisi-hadir] impor", e);
    return { ok: false, code: "GAGAL" };
  }
}

/** Templat berkas berisi hari masa kerja SPG di bulan itu (base64 untuk diunduh di peramban). */
export async function unduhTemplateCatatanHadirAction(input: {
  userId: unknown;
  bulan: unknown;
}): Promise<{ ok: true; base64: string; filename: string } | { ok: false; code: "TANPA_AKSES" | "INPUT_TIDAK_SAH" | "BUKAN_SPG" }> {
  const olehUserId = await pengguna(PERMISSIONS.SPG_ATTENDANCE_RECORD);
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  const userId = teks(input?.userId);
  if (!userId || !bulanSahGaji(input?.bulan)) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const bulan = input.bulan as string;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { spgStartedOn: true, spgEndedOn: true } });
  if (!u) return { ok: false, code: "BUKAN_SPG" };
  const isi = templateCatatanHadir(masaKerjaBulan(bulan, u.spgStartedOn, u.spgEndedOn));
  return { ok: true, base64: Buffer.from(isi).toString("base64"), filename: `catatan-checkin-${bulan}.xlsx` };
}

const versiSah = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1;

export async function periksaCatatanHadirAction(input: { recordId: unknown; versi: unknown }): Promise<HasilPeriksaCatatanAksi> {
  const olehUserId = await pengguna(PERMISSIONS.SPG_ATTENDANCE_VERIFY);
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  const recordId = teks(input?.recordId);
  if (!recordId || !versiSah(input?.versi)) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const versi = input.versi;
  try {
    const r = await periksaCatatanHadir({ recordId, versi, olehUserId });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true };
  } catch (e) {
    console.error("[spg-komisi-hadir] periksa", e);
    return { ok: false, code: "GAGAL" };
  }
}

export async function kembalikanCatatanHadirAction(input: { recordId: unknown; versi: unknown; catatan: unknown }): Promise<HasilPeriksaCatatanAksi> {
  const olehUserId = await pengguna(PERMISSIONS.SPG_ATTENDANCE_VERIFY);
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  const recordId = teks(input?.recordId);
  if (!recordId || !versiSah(input?.versi)) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const versi = input.versi;
  try {
    const r = await kembalikanCatatanHadir({ recordId, versi, olehUserId, catatan: input.catatan });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true };
  } catch (e) {
    console.error("[spg-komisi-hadir] kembalikan", e);
    return { ok: false, code: "GAGAL" };
  }
}
