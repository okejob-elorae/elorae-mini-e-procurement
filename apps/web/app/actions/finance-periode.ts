"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaKunciBulan, tahunSah, type DaftarPeriksa, type KodeGalatPeriode } from "@/lib/finance/periode/periode";
import { bacaDaftarPeriksa } from "@/lib/finance/periode/queries";
import { bukaBulan, bukaTahun, tutupBulan, tutupTahun } from "@/lib/finance/periode/writer";
import { hitungDampakTanggalMulai, bacaInfoTanggalMulai, tetapkanTanggalMulai } from "@/lib/finance/periode/tanggal-mulai";
import {
  peringatanTanggalMulai,
  periksaTanggalMulaiBaru,
  type DampakTanggalMulai,
  type PeringatanTanggalMulai,
} from "@/lib/finance/periode/tanggal-mulai-aturan";
import { jalankanSapuan } from "@/lib/finance/sapuan/runner";
import { hariIniWib } from "@/lib/tanggal-isian";

/*
 * Aksi tutup buku, tanggal mulai buku besar, dan sapuan dokumen tanpa jurnal
 * (bagian A1). Melihat `journals:view`; mengubah `journals:manage`. Aktor
 * selalu dari `auth()`. Tidak pernah melempar ke layar: `{ ok: false, kode }`.
 */

type Gagal = { ok: false; kode: KodeGalatPeriode; rincian?: Record<string, unknown> };

async function aktor(izin: string): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], izin) ? session.user.id : null;
}

function segarkan() {
  revalidatePath("/backoffice/finance/tutup-buku");
  revalidatePath("/backoffice/finance/integritas");
  revalidatePath("/backoffice/finance/mulai-buku-besar");
  revalidatePath("/backoffice/finance/journals");
}

async function aman<T>(nama: string, fn: () => Promise<T | Gagal>): Promise<T | Gagal> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[finance-periode] ${nama} gagal`, e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function bacaDaftarPeriksaAction(input: { bulan: string }): Promise<{ ok: true; daftar: DaftarPeriksa } | Gagal> {
  if (!(await aktor(PERMISSIONS.JOURNALS_VIEW))) return { ok: false, kode: "TANPA_AKSES" };
  const tb = bacaKunciBulan(input.bulan);
  if (!tb) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  return aman("daftar periksa", async () => ({ ok: true as const, daftar: await bacaDaftarPeriksa(tb) }));
}

export async function tutupBulanAction(input: {
  bulan: string;
  catatan?: string | null;
  setujuPeringatan: boolean;
}): Promise<{ ok: true } | Gagal> {
  const userId = await aktor(PERMISSIONS.JOURNALS_MANAGE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const tb = bacaKunciBulan(input.bulan);
  if (!tb) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  return aman("tutup bulan", async () => {
    const r = await tutupBulan({ tb, olehUserId: userId, catatan: input.catatan ?? null, setujuPeringatan: input.setujuPeringatan === true });
    if (r.ok) segarkan();
    return r.ok ? { ok: true as const } : r;
  });
}

export async function bukaBulanAction(input: { bulan: string; alasan: string }): Promise<{ ok: true } | Gagal> {
  const userId = await aktor(PERMISSIONS.JOURNALS_MANAGE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const tb = bacaKunciBulan(input.bulan);
  if (!tb) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  return aman("buka bulan", async () => {
    const r = await bukaBulan({ tb, olehUserId: userId, alasan: String(input.alasan ?? "") });
    if (r.ok) segarkan();
    return r.ok ? { ok: true as const } : r;
  });
}

export async function tutupTahunAction(input: { tahun: number }): Promise<{ ok: true; journalId: string | null; labaBersih: number } | Gagal> {
  const userId = await aktor(PERMISSIONS.JOURNALS_MANAGE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const tahun = Number(input.tahun);
  if (!tahunSah(tahun)) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  return aman("tutup tahun", async () => {
    const r = await tutupTahun({ tahun, olehUserId: userId });
    if (!r.ok) return r;
    segarkan();
    revalidatePath("/backoffice/finance/reports/balance-sheet");
    return { ok: true as const, journalId: r.journalId ?? null, labaBersih: r.labaBersih ?? 0 };
  });
}

export async function bukaTahunAction(input: { tahun: number; alasan: string }): Promise<{ ok: true } | Gagal> {
  const userId = await aktor(PERMISSIONS.JOURNALS_MANAGE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const tahun = Number(input.tahun);
  if (!tahunSah(tahun)) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  return aman("buka tahun", async () => {
    const r = await bukaTahun({ tahun, olehUserId: userId, alasan: String(input.alasan ?? "") });
    if (r.ok) {
      segarkan();
      revalidatePath("/backoffice/finance/reports/balance-sheet");
    }
    return r.ok ? { ok: true as const } : r;
  });
}

export async function pratinjauTanggalMulaiAction(input: {
  tanggal: string;
}): Promise<{ ok: true; tanggal: string; peringatan: PeringatanTanggalMulai[]; dampak: DampakTanggalMulai } | Gagal> {
  if (!(await aktor(PERMISSIONS.JOURNALS_MANAGE))) return { ok: false, kode: "TANPA_AKSES" };
  return aman("pratinjau tanggal mulai", async () => {
    const info = await bacaInfoTanggalMulai();
    const periksa = periksaTanggalMulaiBaru(input.tanggal, { tanggalLama: info.tanggal, adaPeriodeTertutup: info.adaPeriodeTertutup });
    if (!periksa.ok) return { ok: false as const, kode: periksa.kode };
    const dampak = await hitungDampakTanggalMulai(periksa.tanggal);
    return {
      ok: true as const,
      tanggal: periksa.tanggal,
      peringatan: peringatanTanggalMulai(periksa.tanggal, info.tanggal, hariIniWib(), dampak),
      dampak,
    };
  });
}

/**
 * Menyimpan tanggal mulai. `setuju` wajib: layar hanya mengirimnya sesudah
 * peringatan pratinjau ditampilkan dan dicentang.
 */
export async function tetapkanTanggalMulaiAction(input: { tanggal: string; setuju: boolean }): Promise<{ ok: true; tanggal: string } | Gagal> {
  const userId = await aktor(PERMISSIONS.JOURNALS_MANAGE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  if (input.setuju !== true) return { ok: false, kode: "PERINGATAN_BELUM_DISETUJUI" };
  return aman("tetapkan tanggal mulai", async () => {
    const r = await tetapkanTanggalMulai({ tanggal: String(input.tanggal ?? ""), olehUserId: userId });
    if (r.ok) {
      segarkan();
      revalidatePath("/backoffice/finance/reports", "layout");
    }
    return r;
  });
}

export type RingkasSapuanLayar = {
  dilewati: string | null;
  sumber: Array<{ sourceType: string; label: string; ditemukan: number; diposting: number; gagal: number; galat: string | null }>;
};

/** Tombol "Sapu sekarang" di Integritas buku besar — sapuan yang sama dengan cron harian. */
export async function jalankanSapuanAction(): Promise<{ ok: true; hasil: RingkasSapuanLayar } | Gagal> {
  const userId = await aktor(PERMISSIONS.JOURNALS_MANAGE);
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  return aman("sapuan", async () => {
    const r = await jalankanSapuan({ olehUserId: userId });
    segarkan();
    return {
      ok: true as const,
      hasil: {
        dilewati: r.dilewati,
        sumber: r.dilewati
          ? []
          : r.sumber.map((s) => ({
              sourceType: s.sourceType,
              label: s.label,
              ditemukan: s.ditemukan,
              diposting: s.diposting,
              gagal: s.gagal.length,
              galat: s.galat,
            })),
      },
    };
  });
}
