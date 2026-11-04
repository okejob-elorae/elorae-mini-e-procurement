"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rapikanIsianSel } from "@/lib/spg/shift";
import {
  ajukanTukarShift,
  batalkanTukarShift,
  jawabTukarShift,
  setujuiTukarShift,
  simpanJadwalSpg,
  tolakTukarShift,
  type KodeTukar,
} from "@/lib/spg/shift-writer";

/**
 * Aksi jadwal kerja dan tukar shift SPG.
 *
 * Kantor: menyusun jadwal dan memutuskan tukar shift = `stores:manage`
 * (pengelola toko); melihat = `spg_sales:view` (di halamannya). SPG: pengguna
 * lapangan (`pwa:access`) dengan toko tetap — toko SELALU dari server
 * (`ambilTokoTetap`), tidak pernah dari isian HP.
 *
 * Hasil dikembalikan sebagai kode, tidak dilempar: di produksi Next
 * menyamarkan pesan galat menjadi digest acak.
 */

export type KodeJadwalAksi =
  | "TANPA_AKSES"
  | "INPUT_TIDAK_SAH"
  | "TOKO_TIDAK_DITEMUKAN"
  | "KOSONG"
  | "TANGGAL_TIDAK_SAH"
  | "HARI_LEWAT"
  | "BUKAN_SPG_TOKO"
  | "SHIFT_TIDAK_DIKENAL"
  | "GAGAL";

export type HasilSimpanJadwalAksi = { ok: true; berubah: number } | { ok: false; code: KodeJadwalAksi; day?: string; shiftCode?: string };

export type HasilTukarAksi = { ok: true; id: string; status: string } | { ok: false; code: KodeTukar | "TANPA_AKSES" | "GAGAL" };

function segarkan() {
  revalidatePath("/backoffice/jadwal-spg");
  revalidatePath("/pwa/spg/jadwal");
  revalidatePath("/pwa");
}

async function kantor(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) return null;
  return session.user.id;
}

/** SPG yang sedang masuk: id dan toko tetapnya, atau null. */
async function spg(): Promise<{ userId: string; storeId: string } | null> {
  const session = await auth();
  if (!session?.user?.id || pwaAccessGuard(session.user.permissions) !== "render") return null;
  const storeId = await ambilTokoTetap(session.user.id);
  return storeId ? { userId: session.user.id, storeId } : null;
}

const teks = (x: unknown): string => (typeof x === "string" ? x : "");

// ─── Kantor ──────────────────────────────────────────────────────────────────

/** Simpan sel kisi jadwal satu toko (hanya sel yang diubah di layar). */
export async function simpanJadwalSpgAction(input: { storeId: string; isian: unknown }): Promise<HasilSimpanJadwalAksi> {
  const olehUserId = await kantor();
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  const storeId = teks(input?.storeId);
  const isian = rapikanIsianSel(input?.isian);
  if (!storeId || !isian) return { ok: false, code: "INPUT_TIDAK_SAH" };
  try {
    const r = await simpanJadwalSpg({ storeId, olehUserId, isian });
    if (!r.ok) {
      return {
        ok: false,
        code: r.kode,
        ...("day" in r ? { day: r.day } : {}),
        ...("shiftCode" in r ? { shiftCode: r.shiftCode } : {}),
      };
    }
    if (r.berubah > 0) segarkan();
    return { ok: true, berubah: r.berubah };
  } catch (err) {
    console.error("simpanJadwalSpg gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}

export async function setujuiTukarShiftAction(input: { swapId: string; catatan?: string }): Promise<HasilTukarAksi> {
  const olehUserId = await kantor();
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  try {
    const r = await setujuiTukarShift({ swapId: teks(input?.swapId), olehUserId, catatan: input?.catatan });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true, id: r.id, status: r.status };
  } catch (err) {
    console.error("setujuiTukarShift gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}

export async function tolakTukarShiftAction(input: { swapId: string; catatan: string }): Promise<HasilTukarAksi> {
  const olehUserId = await kantor();
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  try {
    const r = await tolakTukarShift({ swapId: teks(input?.swapId), olehUserId, catatan: input?.catatan });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true, id: r.id, status: r.status };
  } catch (err) {
    console.error("tolakTukarShift gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}

// ─── SPG (HP) ────────────────────────────────────────────────────────────────

export async function ajukanTukarShiftAction(input: {
  day: string;
  partnerId: string;
  partnerDay?: string | null;
  alasan: string;
  idempotencyKey: string;
}): Promise<HasilTukarAksi> {
  const saya = await spg();
  if (!saya) return { ok: false, code: "TANPA_AKSES" };
  try {
    const r = await ajukanTukarShift({
      userId: saya.userId,
      storeId: saya.storeId,
      day: input?.day,
      partnerId: input?.partnerId,
      partnerDay: input?.partnerDay ?? null,
      alasan: input?.alasan,
      idempotencyKey: input?.idempotencyKey,
    });
    if (!r.ok) return { ok: false, code: r.kode };
    if (!r.ulang) segarkan();
    return { ok: true, id: r.id, status: r.status };
  } catch (err) {
    console.error("ajukanTukarShift gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}

export async function jawabTukarShiftAction(input: { swapId: string; setuju: boolean; alasan?: string }): Promise<HasilTukarAksi> {
  const saya = await spg();
  if (!saya) return { ok: false, code: "TANPA_AKSES" };
  try {
    const r = await jawabTukarShift({
      swapId: teks(input?.swapId),
      userId: saya.userId,
      storeId: saya.storeId,
      setuju: input?.setuju === true,
      alasan: input?.alasan,
    });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true, id: r.id, status: r.status };
  } catch (err) {
    console.error("jawabTukarShift gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}

export async function batalkanTukarShiftAction(input: { swapId: string }): Promise<HasilTukarAksi> {
  const saya = await spg();
  if (!saya) return { ok: false, code: "TANPA_AKSES" };
  try {
    const r = await batalkanTukarShift({ swapId: teks(input?.swapId), userId: saya.userId, storeId: saya.storeId });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true, id: r.id, status: r.status };
  } catch (err) {
    console.error("batalkanTukarShift gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}
