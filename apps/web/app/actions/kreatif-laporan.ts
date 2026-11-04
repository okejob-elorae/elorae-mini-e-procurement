"use server";

import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { csvPerforma, namaBerkasPeriode } from "@/lib/creative/laporan-csv";
import { bacaPilihanPeriode, periodeDari } from "@/lib/creative/laporan-periode";
import { barisPerforma } from "@/lib/creative/laporan-queries";

/*
 * Laporan Ruang KOL. Peringkat dan rekap dibaca halaman server dari alamat;
 * yang perlu aksi hanya unduhan CSV. Izin diperiksa di aksi itu sendiri.
 */

/** CSV "Performa" untuk periode (dan pencarian) yang sedang dibuka di Peringkat. */
export async function eksporPerformaAction(input: {
  periode?: string;
  dari?: string | null;
  sampai?: string | null;
  cari?: string | null;
}): Promise<{ ok: true; isi: string; namaBerkas: string } | { ok: false; kode: "TANPA_AKSES" | "GAGAL" }> {
  const s = await auth();
  if (!s?.user?.id || !hasPermission(s.user.permissions ?? [], PERMISSIONS.CREATIVE_VIEW)) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const hariIni = hariIniWib();
    const periode = periodeDari({
      pilihan: bacaPilihanPeriode(input?.periode, "bulanIni"),
      dari: typeof input?.dari === "string" ? input.dari : null,
      sampai: typeof input?.sampai === "string" ? input.sampai : null,
      hariIni,
    });
    const baris = await barisPerforma({ periode, cari: typeof input?.cari === "string" ? input.cari : null });
    return {
      ok: true,
      isi: csvPerforma(baris, periode),
      namaBerkas: periode ? namaBerkasPeriode("performa-kol", periode.dari, periode.sampai) : `performa-kol-semua-${hariIni}.csv`,
    };
  } catch (err) {
    console.error("eksporPerforma gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
