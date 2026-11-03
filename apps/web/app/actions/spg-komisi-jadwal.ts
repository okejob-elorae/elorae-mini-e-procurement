"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rapikanIsianSel } from "@/lib/spg/shift";
import {
  ajukanJadwalBulan,
  bukaLagiJadwalBulan,
  isiJadwalBulanSaya,
  setujuiJadwalBulan,
  tolakJadwalBulan,
  type KodeJadwalBulan,
} from "@/lib/spg/jadwal-bulan-writer";

/**
 * Jadwal kerja bulanan SPG (P7c) — dasar gaji pokoknya.
 *
 * SPG mengisi dan mengajukan jadwal bulan ini dan bulan depan dari HP (`pwa:access`, toko SELALU
 * dari server lewat `ambilTokoTetap`). Kantor menyetujui, menolak dengan alasan, atau membuka lagi
 * jadwal yang sudah disetujui = `spg_schedules:approve` (bawaannya hanya admin); yang mengajukan
 * tidak pernah menyetujui jadwalnya sendiri (`PEMOHON_SAMA`, diperiksa penulisnya). Tombol di
 * halaman memakai izin yang sama.
 *
 * Hasil dikembalikan sebagai kode, tidak dilempar: di produksi Next menyamarkan pesan galat.
 */

export type HasilJadwalBulanAksi =
  | { ok: true; status: string; versi: number }
  | { ok: false; code: KodeJadwalBulan | "TANPA_AKSES" | "INPUT_TIDAK_SAH" | "GAGAL"; hari?: string[] };

const POLA_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;
const bulanSah = (x: unknown): x is string => typeof x === "string" && POLA_BULAN.test(x);
const versiSah = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

function segarkan() {
  revalidatePath("/pwa/spg/jadwal");
  revalidatePath("/pwa/spg/gaji");
  revalidatePath("/pwa");
  revalidatePath("/backoffice/komisi-spg");
  revalidatePath("/backoffice/jadwal-spg");
}

async function spg(): Promise<{ userId: string; storeId: string } | null> {
  const session = await auth();
  if (!session?.user?.id || pwaAccessGuard(session.user.permissions) !== "render") return null;
  const storeId = await ambilTokoTetap(session.user.id);
  return storeId ? { userId: session.user.id, storeId } : null;
}

async function penyetuju(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SCHEDULES_APPROVE)) return null;
  return session.user.id;
}

function keAksi(r: Awaited<ReturnType<typeof ajukanJadwalBulan>>): HasilJadwalBulanAksi {
  if (r.ok) return { ok: true, status: r.status, versi: r.versi };
  return { ok: false, code: r.kode, ...(r.hari ? { hari: r.hari } : {}) };
}

async function jalankan(kerja: () => Promise<Awaited<ReturnType<typeof ajukanJadwalBulan>>>): Promise<HasilJadwalBulanAksi> {
  try {
    const r = await kerja();
    if (r.ok) segarkan();
    return keAksi(r);
  } catch (e) {
    console.error("[spg-komisi-jadwal]", e);
    return { ok: false, code: "GAGAL" };
  }
}

// ─── SPG (HP) ────────────────────────────────────────────────────────────────

/** Simpan sel jadwal bulanan milik SPG sendiri. Jadwal yang sudah disetujui kembali menunggu. */
export async function simpanJadwalBulanSayaAction(input: { bulan: unknown; isian: unknown }): Promise<HasilJadwalBulanAksi> {
  const s = await spg();
  if (!s) return { ok: false, code: "TANPA_AKSES" };
  // Pemilik sel SELALU SPG yang masuk — userId dari HP tidak pernah dipercaya.
  const mentah = Array.isArray(input?.isian)
    ? input.isian.map((v: unknown) => (v && typeof v === "object" ? { ...(v as Record<string, unknown>), userId: s.userId } : v))
    : input?.isian;
  const isian = rapikanIsianSel(mentah);
  if (!bulanSah(input?.bulan) || !isian) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const bulan = input.bulan;
  return jalankan(() => isiJadwalBulanSaya({ userId: s.userId, storeId: s.storeId, bulan, isian }));
}

/** Ajukan jadwal bulanan untuk disetujui kantor (semua hari dalam masa kerjanya wajib terisi). */
export async function ajukanJadwalBulanAction(input: { bulan: unknown }): Promise<HasilJadwalBulanAksi> {
  const s = await spg();
  if (!s) return { ok: false, code: "TANPA_AKSES" };
  if (!bulanSah(input?.bulan)) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const bulan = input.bulan;
  return jalankan(() => ajukanJadwalBulan({ userId: s.userId, storeId: s.storeId, bulan }));
}

// ─── Kantor ──────────────────────────────────────────────────────────────────

type Keputusan = { userId: unknown; bulan: unknown; versi: unknown };

function isianKeputusan(input: Keputusan | null | undefined): { userId: string; bulan: string; versi: number } | null {
  if (typeof input?.userId !== "string" || !input.userId || !bulanSah(input.bulan) || !versiSah(input.versi)) return null;
  return { userId: input.userId, bulan: input.bulan, versi: input.versi };
}

export async function setujuiJadwalBulanAction(input: Keputusan): Promise<HasilJadwalBulanAksi> {
  const olehUserId = await penyetuju();
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  const k = isianKeputusan(input);
  if (!k) return { ok: false, code: "INPUT_TIDAK_SAH" };
  return jalankan(() => setujuiJadwalBulan({ ...k, olehUserId }));
}

export async function tolakJadwalBulanAction(input: Keputusan & { alasan: unknown }): Promise<HasilJadwalBulanAksi> {
  const olehUserId = await penyetuju();
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  const k = isianKeputusan(input);
  if (!k) return { ok: false, code: "INPUT_TIDAK_SAH" };
  return jalankan(() => tolakJadwalBulan({ ...k, olehUserId, alasan: input.alasan }));
}

/** Buka lagi jadwal yang sudah disetujui — ditolak begitu gaji bulan itu dibayar (`SUDAH_DIBAYAR`). */
export async function bukaLagiJadwalBulanAction(input: Keputusan & { alasan: unknown }): Promise<HasilJadwalBulanAksi> {
  const olehUserId = await penyetuju();
  if (!olehUserId) return { ok: false, code: "TANPA_AKSES" };
  const k = isianKeputusan(input);
  if (!k) return { ok: false, code: "INPUT_TIDAK_SAH" };
  return jalankan(() => bukaLagiJadwalBulan({ ...k, olehUserId, alasan: input.alasan }));
}
