"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { TanggalMerah } from "@/lib/production/hari-kerja";
import { SARINGAN_FOLLOW_UP, type KodeGalatJadwal, type SaringanFollowUp } from "@/lib/production/jadwal-jejak";
import { ambilKalenderKerja, simpanHariKerjaProduksi, simpanTanggalMerah } from "@/lib/production/jadwal-pengaturan";
import {
  followUpProduksi,
  ikhtisarJadwalTahun,
  kalenderProduksiBulan,
  ruangKerjaTahap,
  tahapBulan,
  type FollowUpProduksi,
  type IkhtisarBulan,
  type KalenderProduksiBulan,
  type RuangKerjaTahap,
  type TahapBulan,
} from "@/lib/production/jadwal-queries";
import {
  aturMulaiJadwal,
  hapusLangkah,
  pindahLangkahKe,
  pindahUrutanLangkah,
  tambahLangkah,
  tarikJadwalDariLeadTime,
  ubahLangkah,
  ubahStatusLangkah,
} from "@/lib/production/jadwal-writer";

/*
 * Aksi server jadwal produksi per tahap (2026-10-07) — pembungkus penulis dan
 * kueri di `lib/production/jadwal-*`.
 *
 *  - baca  = `production_planning:view`; PO/SPK di ruang kerja hanya untuk
 *            pemegang `purchase_orders:view` / `work_orders:view`;
 *  - tulis = `production_planning:manage`;
 *  - kalender kerja: baca = `production_planning:view` ATAU `lead_time:view`,
 *            ubah = `production_planning:manage` ATAU `lead_time:manage`.
 *
 * Pelaku SELALU dari sesi, tidak pernah dari isian. Penolakan dikembalikan
 * sebagai `{ ok:false, code }` (teks: `jadwalProduksi.server.err<KODE>`);
 * tidak ada yang dilempar ke klien — galat tak terduga menjadi `GAGAL`.
 */

export type HasilAksiJadwal<T extends object = object> = ({ ok: true } & T) | { ok: false; code: KodeGalatJadwal };
export type HasilBacaJadwal<T> = { ok: true; data: T } | { ok: false; code: KodeGalatJadwal };

type Sesi = { userId: string; izin: string[] };

async function sesi(): Promise<Sesi | null> {
  const s = await auth();
  const userId = s?.user?.id;
  return userId ? { userId, izin: s.user.permissions ?? [] } : null;
}

const punya = (izin: string[], ...kode: string[]) => kode.some((k) => hasPermission(izin, k));
const bolehBaca = (izin: string[]) => punya(izin, PERMISSIONS.PRODUCTION_PLANNING_VIEW);
const bolehTulis = (izin: string[]) => punya(izin, PERMISSIONS.PRODUCTION_PLANNING_MANAGE);
const bolehBacaKalender = (izin: string[]) => punya(izin, PERMISSIONS.PRODUCTION_PLANNING_VIEW, PERMISSIONS.LEAD_TIME_VIEW);
const bolehAturKalender = (izin: string[]) => punya(izin, PERMISSIONS.PRODUCTION_PLANNING_MANAGE, PERMISSIONS.LEAD_TIME_MANAGE);

const tolak = <K extends KodeGalatJadwal>(code: K) => ({ ok: false as const, code });

function segarkan() {
  revalidatePath("/backoffice/production", "layout");
  revalidatePath("/backoffice/lead-time");
}

/** Jalankan penulis/kueri; galat tak terduga dicatat dan menjadi `GAGAL`. */
async function jaga<T>(nama: string, fn: () => Promise<T>): Promise<T | { ok: false; code: "GAGAL" }> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[jadwal-produksi] ${nama}`, e);
    return tolak("GAGAL");
  }
}

const idWajib = z.string().min(1).max(64);
const teksTanggal = z.string().max(20);
const mode = z.enum(["MAJU", "MUNDUR"]);

// ─── Baca ───────────────────────────────────────────────────────────────────

export async function ambilRuangKerjaTahapAction(planStageId: string): Promise<HasilBacaJadwal<RuangKerjaTahap>> {
  const s = await sesi();
  if (!s || !bolehBaca(s.izin)) return tolak("TANPA_AKSES");
  if (!idWajib.safeParse(planStageId).success) return tolak("ISIAN_TIDAK_SAH");
  return jaga("ambilRuangKerjaTahap", async () => {
    const data = await ruangKerjaTahap(planStageId, {
      lihatPo: hasPermission(s.izin, PERMISSIONS.PURCHASE_ORDERS_VIEW),
      lihatSpk: hasPermission(s.izin, PERMISSIONS.WORK_ORDERS_VIEW),
    });
    return data ? { ok: true as const, data } : tolak("TAHAP_TIDAK_ADA");
  });
}

const tahunSah = z.number().int().min(2000).max(2100);
const bulanSah = z.number().int().min(1).max(12);

export async function ambilIkhtisarJadwalAction(tahun: number): Promise<HasilBacaJadwal<IkhtisarBulan[]>> {
  const s = await sesi();
  if (!s || !bolehBaca(s.izin)) return tolak("TANPA_AKSES");
  if (!tahunSah.safeParse(tahun).success) return tolak("ISIAN_TIDAK_SAH");
  return jaga("ambilIkhtisarJadwal", async () => ({ ok: true as const, data: await ikhtisarJadwalTahun(tahun) }));
}

export async function ambilTahapBulanAction(tahun: number, bulan: number): Promise<HasilBacaJadwal<TahapBulan[]>> {
  const s = await sesi();
  if (!s || !bolehBaca(s.izin)) return tolak("TANPA_AKSES");
  if (!tahunSah.safeParse(tahun).success || !bulanSah.safeParse(bulan).success) return tolak("ISIAN_TIDAK_SAH");
  return jaga("ambilTahapBulan", async () => ({
    ok: true as const,
    data: await tahapBulan(tahun, bulan, {
      lihatPo: hasPermission(s.izin, PERMISSIONS.PURCHASE_ORDERS_VIEW),
      lihatSpk: hasPermission(s.izin, PERMISSIONS.WORK_ORDERS_VIEW),
    }),
  }));
}

const skemaFollowUp = z.object({
  saring: z.enum(SARINGAN_FOLLOW_UP),
  supplierId: idWajib.nullish(),
  halaman: z.number().int().min(1).max(10_000).optional(),
});

export async function ambilFollowUpAction(opsi: {
  saring: SaringanFollowUp;
  supplierId?: string | null;
  halaman?: number;
}): Promise<HasilBacaJadwal<FollowUpProduksi>> {
  const s = await sesi();
  if (!s || !bolehBaca(s.izin)) return tolak("TANPA_AKSES");
  const p = skemaFollowUp.safeParse(opsi);
  if (!p.success) return tolak("ISIAN_TIDAK_SAH");
  return jaga("ambilFollowUp", async () => ({ ok: true as const, data: await followUpProduksi(p.data) }));
}

export async function ambilKalenderProduksiAction(
  tahun: number,
  bulan: number,
  opsi: { supplierId?: string | null } = {},
): Promise<HasilBacaJadwal<KalenderProduksiBulan>> {
  const s = await sesi();
  if (!s || !bolehBaca(s.izin)) return tolak("TANPA_AKSES");
  const p = z.object({ supplierId: idWajib.nullish() }).safeParse(opsi ?? {});
  if (!tahunSah.safeParse(tahun).success || !bulanSah.safeParse(bulan).success || !p.success) return tolak("ISIAN_TIDAK_SAH");
  return jaga("ambilKalenderProduksi", async () => ({ ok: true as const, data: await kalenderProduksiBulan(tahun, bulan, p.data) }));
}

export async function ambilHariKerjaAction(): Promise<HasilBacaJadwal<{ hariKerja: number[]; tanggalMerah: TanggalMerah[] }>> {
  const s = await sesi();
  if (!s || !bolehBacaKalender(s.izin)) return tolak("TANPA_AKSES");
  return jaga("ambilHariKerja", async () => {
    const { hariKerja, tanggalMerah } = await ambilKalenderKerja();
    return { ok: true as const, data: { hariKerja, tanggalMerah } };
  });
}

// ─── Tulis ──────────────────────────────────────────────────────────────────

const skemaTarik = z.object({
  planStageId: idWajib,
  langkah: z.array(z.object({ supplierId: idWajib, sequence: z.number().int() })).max(200),
  mode,
  tanggal: teksTanggal,
  cara: z.enum(["TAMBAH", "GANTI"]),
});

export async function tarikJadwalAction(masukan: z.infer<typeof skemaTarik>): Promise<HasilAksiJadwal<{ jumlah: number }>> {
  const s = await sesi();
  if (!s || !bolehTulis(s.izin)) return tolak("TANPA_AKSES");
  const p = skemaTarik.safeParse(masukan);
  if (!p.success) return tolak("ISIAN_TIDAK_SAH");
  const hasil = await jaga("tarikJadwal", () => tarikJadwalDariLeadTime({ ...p.data, olehUserId: s.userId }));
  if (hasil.ok) segarkan();
  return hasil;
}

const skemaTambah = z.object({
  planStageId: idWajib,
  name: z.string().max(1000),
  durationDays: z.number(),
  supplierId: idWajib.nullish(),
  note: z.string().max(5000).nullish(),
});

export async function tambahLangkahAction(masukan: z.infer<typeof skemaTambah>): Promise<HasilAksiJadwal<{ id: string }>> {
  const s = await sesi();
  if (!s || !bolehTulis(s.izin)) return tolak("TANPA_AKSES");
  const p = skemaTambah.safeParse(masukan);
  if (!p.success) return tolak("ISIAN_TIDAK_SAH");
  const hasil = await jaga("tambahLangkah", () => tambahLangkah({ ...p.data, olehUserId: s.userId }));
  if (hasil.ok) segarkan();
  return hasil;
}

const skemaUbah = z.object({
  stepId: idWajib,
  name: z.string().max(1000).optional(),
  durationDays: z.number().optional(),
  supplierId: idWajib.nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
});

export async function ubahLangkahAction(masukan: z.infer<typeof skemaUbah>): Promise<HasilAksiJadwal> {
  const s = await sesi();
  if (!s || !bolehTulis(s.izin)) return tolak("TANPA_AKSES");
  const p = skemaUbah.safeParse(masukan);
  if (!p.success) return tolak("ISIAN_TIDAK_SAH");
  const hasil = await jaga("ubahLangkah", () => ubahLangkah({ ...p.data, olehUserId: s.userId }));
  if (hasil.ok) segarkan();
  return hasil;
}

const skemaStatus = z.object({
  stepId: idWajib,
  status: z.enum(["BELUM", "PROSES", "SELESAI"]),
  doneDate: teksTanggal.nullish(),
});

export async function ubahStatusLangkahAction(masukan: z.infer<typeof skemaStatus>): Promise<HasilAksiJadwal> {
  const s = await sesi();
  if (!s || !bolehTulis(s.izin)) return tolak("TANPA_AKSES");
  const p = skemaStatus.safeParse(masukan);
  if (!p.success) return tolak("ISIAN_TIDAK_SAH");
  const hasil = await jaga("ubahStatusLangkah", () => ubahStatusLangkah({ ...p.data, olehUserId: s.userId }));
  if (hasil.ok) segarkan();
  return hasil;
}

const skemaPindah = z.object({ stepId: idWajib, arah: z.enum(["NAIK", "TURUN"]) });

export async function pindahUrutanLangkahAction(masukan: z.infer<typeof skemaPindah>): Promise<HasilAksiJadwal> {
  const s = await sesi();
  if (!s || !bolehTulis(s.izin)) return tolak("TANPA_AKSES");
  const p = skemaPindah.safeParse(masukan);
  if (!p.success) return tolak("ISIAN_TIDAK_SAH");
  const hasil = await jaga("pindahUrutanLangkah", () => pindahUrutanLangkah({ ...p.data, olehUserId: s.userId }));
  if (hasil.ok) segarkan();
  return hasil;
}

const skemaPindahKe = z.object({ stepId: idWajib, posisi: z.number().int().min(0).max(10_000) });

/** Seret-lepas: pindahkan langkah langsung ke `posisi` (indeks 0 = paling atas). */
export async function pindahLangkahKeAction(masukan: z.infer<typeof skemaPindahKe>): Promise<HasilAksiJadwal> {
  const s = await sesi();
  if (!s || !bolehTulis(s.izin)) return tolak("TANPA_AKSES");
  const p = skemaPindahKe.safeParse(masukan);
  if (!p.success) return tolak("ISIAN_TIDAK_SAH");
  const hasil = await jaga("pindahLangkahKe", () => pindahLangkahKe({ ...p.data, olehUserId: s.userId }));
  if (hasil.ok) segarkan();
  return hasil;
}

export async function hapusLangkahAction(masukan: { stepId: string }): Promise<HasilAksiJadwal> {
  const s = await sesi();
  if (!s || !bolehTulis(s.izin)) return tolak("TANPA_AKSES");
  const p = z.object({ stepId: idWajib }).safeParse(masukan);
  if (!p.success) return tolak("ISIAN_TIDAK_SAH");
  const hasil = await jaga("hapusLangkah", () => hapusLangkah({ ...p.data, olehUserId: s.userId }));
  if (hasil.ok) segarkan();
  return hasil;
}

const skemaMulai = z.object({ planStageId: idWajib, mode, tanggal: teksTanggal });

export async function aturMulaiJadwalAction(masukan: z.infer<typeof skemaMulai>): Promise<HasilAksiJadwal> {
  const s = await sesi();
  if (!s || !bolehTulis(s.izin)) return tolak("TANPA_AKSES");
  const p = skemaMulai.safeParse(masukan);
  if (!p.success) return tolak("ISIAN_TIDAK_SAH");
  const hasil = await jaga("aturMulaiJadwal", () => aturMulaiJadwal({ ...p.data, olehUserId: s.userId }));
  if (hasil.ok) segarkan();
  return hasil;
}

export async function simpanHariKerjaAction(masukan: { hariKerja: number[] }): Promise<HasilAksiJadwal<{ hariKerja: number[] }>> {
  const s = await sesi();
  if (!s || !bolehAturKalender(s.izin)) return tolak("TANPA_AKSES");
  if (!masukan || typeof masukan !== "object") return tolak("ISIAN_TIDAK_SAH");
  const hasil = await jaga("simpanHariKerja", () => simpanHariKerjaProduksi({ hariKerja: masukan.hariKerja, olehUserId: s.userId }));
  if (hasil.ok) segarkan();
  return hasil;
}

export async function simpanTanggalMerahAction(masukan: {
  daftar: TanggalMerah[];
}): Promise<HasilAksiJadwal<{ tanggalMerah: TanggalMerah[] }>> {
  const s = await sesi();
  if (!s || !bolehAturKalender(s.izin)) return tolak("TANPA_AKSES");
  if (!masukan || typeof masukan !== "object") return tolak("ISIAN_TIDAK_SAH");
  const hasil = await jaga("simpanTanggalMerah", () => simpanTanggalMerah({ daftar: masukan.daftar, olehUserId: s.userId }));
  if (hasil.ok) segarkan();
  return hasil;
}
