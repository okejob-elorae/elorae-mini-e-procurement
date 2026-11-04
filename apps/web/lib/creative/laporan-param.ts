/**
 * Alamat layar Pembayaran dan Laporan Ruang KOL — murni, aman untuk klien.
 *
 * Seluruh keadaan saringan ada di alamat: halaman server membacanya dengan
 * `bacaParam*`, kliennya menulis balik dengan `alamat*`. Tautan yang dibagikan
 * dan tombol Kembali membuka keadaan yang sama. Nilai bawaan tidak ditulis.
 */

import { bacaChipBayar, CHIP_BAYAR_BAWAAN, type ChipBayar } from "./bayar-aturan";
import { bacaPilihanPeriode, paramPeriode, periodeDari, type PilihanPeriode } from "./laporan-periode";
import type { Rentang } from "@/lib/tanggal-isian";

type IsiAlamat = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function bilangan(v: string | undefined, min: number, maks: number, bawaan: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= maks ? n : bawaan;
}

const UKURAN = [25, 50, 100] as const;
const ukuran = (v: string | undefined): number => {
  const n = Number(v);
  return (UKURAN as readonly number[]).includes(n) ? n : UKURAN[0];
};

const teksPendek = (v: string | undefined, maks: number): string => {
  const t = (v ?? "").trim();
  return t.length <= maks ? t : t.slice(0, maks);
};

// ── Pembayaran ────────────────────────────────────────────────────────────

export const RUTE_PEMBAYARAN = "/backoffice/kreatif/pembayaran";

export type ParamBayar = { chip: ChipBayar; cari: string; campaign: string | null; halaman: number; per: number };

export function bacaParamBayar(sp: IsiAlamat): ParamBayar {
  const campaign = teksPendek(satu(sp.campaign), 64);
  return {
    chip: bacaChipBayar(satu(sp.chip)),
    cari: teksPendek(satu(sp.cari), 100),
    campaign: campaign || null,
    halaman: bilangan(satu(sp.halaman), 1, 10_000, 1),
    per: ukuran(satu(sp.per)),
  };
}

export function alamatBayar(p: ParamBayar): string {
  const q = new URLSearchParams();
  if (p.chip !== CHIP_BAYAR_BAWAAN) q.set("chip", p.chip);
  if (p.cari.trim()) q.set("cari", p.cari.trim());
  if (p.campaign) q.set("campaign", p.campaign);
  if (p.halaman > 1) q.set("halaman", String(p.halaman));
  if (p.per !== UKURAN[0]) q.set("per", String(p.per));
  const qs = q.toString();
  return qs ? `${RUTE_PEMBAYARAN}?${qs}` : RUTE_PEMBAYARAN;
}

// ── Laporan ───────────────────────────────────────────────────────────────

export const RUTE_LAPORAN = "/backoffice/kreatif/laporan";

export type TabLaporan = "peringkat" | "rekap";

export type UrutPeringkat = "gmv" | "roas" | "orders" | "views" | "konten" | "cpm" | "biaya";
export const URUT_PERINGKAT: readonly UrutPeringkat[] = ["gmv", "roas", "orders", "views", "konten", "cpm", "biaya"];

export function bacaUrutPeringkat(v: unknown): UrutPeringkat {
  return typeof v === "string" && (URUT_PERINGKAT as readonly string[]).includes(v) ? (v as UrutPeringkat) : "gmv";
}

/** Bawaan periode per tab: Peringkat bulan ini, Rekap hari ini (pola KOL Manager). */
export const PERIODE_BAWAAN: Record<TabLaporan, PilihanPeriode> = { peringkat: "bulanIni", rekap: "hariIni" };

export type ParamLaporan = {
  tab: TabLaporan;
  periode: PilihanPeriode;
  /** Rentang yang berlaku; `null` = Semua. */
  rentang: Rentang | null;
  cari: string;
  urut: string;
  halaman: number;
  per: number;
};

export function bacaParamLaporan(sp: IsiAlamat, hariIni: string): ParamLaporan {
  const tab: TabLaporan = satu(sp.tab) === "rekap" ? "rekap" : "peringkat";
  const periode = bacaPilihanPeriode(satu(sp.periode), PERIODE_BAWAAN[tab]);
  return {
    tab,
    periode,
    rentang: periodeDari({ pilihan: periode, dari: satu(sp.dari), sampai: satu(sp.sampai), hariIni }),
    cari: teksPendek(satu(sp.cari), 100),
    urut: teksPendek(satu(sp.urut), 20),
    halaman: bilangan(satu(sp.halaman), 1, 10_000, 1),
    per: ukuran(satu(sp.per)),
  };
}

export function alamatLaporan(p: ParamLaporan): string {
  const q = new URLSearchParams();
  if (p.tab !== "peringkat") q.set("tab", p.tab);
  for (const [k, v] of Object.entries(paramPeriode(p.periode, p.rentang, PERIODE_BAWAAN[p.tab]))) q.set(k, v);
  if (p.tab === "peringkat") {
    if (p.cari.trim()) q.set("cari", p.cari.trim());
    if (p.urut && p.urut !== "gmv") q.set("urut", p.urut);
    if (p.halaman > 1) q.set("halaman", String(p.halaman));
    if (p.per !== UKURAN[0]) q.set("per", String(p.per));
  }
  const qs = q.toString();
  return qs ? `${RUTE_LAPORAN}?${qs}` : RUTE_LAPORAN;
}

/** Alamat cetak rekap untuk rentang itu. */
export function alamatCetakRekap(rentang: Rentang): string {
  const q = new URLSearchParams({ dari: rentang.dari, sampai: rentang.sampai });
  return `${RUTE_LAPORAN}/cetak?${q.toString()}`;
}

/** "rekap-kol-2026-10-07.txt" / "rekap-kol-2026-10-01_sd_2026-10-07.txt". */
export function namaBerkasRekap(rentang: Rentang): string {
  return rentang.dari === rentang.sampai ? `rekap-kol-${rentang.dari}.txt` : `rekap-kol-${rentang.dari}_sd_${rentang.sampai}.txt`;
}
