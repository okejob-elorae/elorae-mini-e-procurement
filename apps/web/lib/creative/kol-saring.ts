/**
 * Saringan daftar KOL dari alamat — murni, aman untuk klien (2026-10-07).
 *
 * Semua saringan hidup di alamat (`?cari=&platform=&tier=&label=&status=&urut=
 * &halaman=&ukuran=&tampilan=`) supaya daftar yang sedang dilihat bisa
 * dibagikan dan dimuat ulang tanpa hilang. Nilai yang tidak dikenal dibaca
 * sebagai bawaan, tidak melempar.
 */

import { bacaTampilan, type JenisTampilan } from "@/lib/tampilan/tampilan";
import { SEMUA_PLATFORM, type Platform, type Tier } from "./aturan";
import { SEMUA_TAHAP, type Tahap } from "./tahap";

export const SEMUA_TIER: readonly Tier[] = ["nano", "mikro", "makro", "mega"];

export const URUT_KOL = ["terbaru", "nama", "pengikut", "er", "gmv", "kontak"] as const;
export type UrutKol = (typeof URUT_KOL)[number];

export const UKURAN_HALAMAN_KOL = [25, 50, 100] as const;
export const UKURAN_BAWAAN_KOL = 25;

export const TAMPILAN_KOL: readonly JenisTampilan[] = ["tabel", "galeri"];

/** "" semua · BELUM belum pernah ada kolaborasi · DIBLOKIR · atau tahap kolaborasi TERAKHIR. */
export type StatusSaringKol = "" | "BELUM" | "DIBLOKIR" | Tahap;

export type SaringKol = {
  cari: string;
  platform: Platform | "";
  tier: Tier | "";
  label: string;
  status: StatusSaringKol;
  urut: UrutKol;
  halaman: number;
  ukuran: number;
  tampilan: JenisTampilan;
};

export const SARING_KOL_BAWAAN: SaringKol = {
  cari: "",
  platform: "",
  tier: "",
  label: "",
  status: "",
  urut: "terbaru",
  halaman: 1,
  ukuran: UKURAN_BAWAAN_KOL,
  tampilan: "tabel",
};

type Param = string | string[] | undefined;
const pertama = (v: Param): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

export type ParamSaringKol = Partial<Record<keyof SaringKol, Param>>;

export function bacaSaringKol(sp: ParamSaringKol): SaringKol {
  const platform = pertama(sp.platform).toUpperCase();
  const tier = pertama(sp.tier).toLowerCase();
  const status = pertama(sp.status).toUpperCase();
  const urut = pertama(sp.urut).toLowerCase();
  const halaman = Number.parseInt(pertama(sp.halaman), 10);
  const ukuran = Number.parseInt(pertama(sp.ukuran), 10);
  return {
    cari: pertama(sp.cari).slice(0, 100),
    platform: (SEMUA_PLATFORM as readonly string[]).includes(platform) ? (platform as Platform) : "",
    tier: (SEMUA_TIER as readonly string[]).includes(tier) ? (tier as Tier) : "",
    label: pertama(sp.label).slice(0, 30),
    status:
      status === "BELUM" || status === "DIBLOKIR" || (SEMUA_TAHAP as readonly string[]).includes(status)
        ? (status as StatusSaringKol)
        : "",
    urut: (URUT_KOL as readonly string[]).includes(urut) ? (urut as UrutKol) : "terbaru",
    halaman: Number.isFinite(halaman) && halaman > 1 ? halaman : 1,
    ukuran: (UKURAN_HALAMAN_KOL as readonly number[]).includes(ukuran) ? ukuran : UKURAN_BAWAAN_KOL,
    tampilan: bacaTampilan(pertama(sp.tampilan), TAMPILAN_KOL, "tabel"),
  };
}

/** Alamat membawa `?tampilan=` sendiri — tampilan tersimpan di perangkat tidak dipakai. */
export function alamatMemilihTampilanKol(sp: ParamSaringKol): boolean {
  return pertama(sp.tampilan) !== "";
}

export function alamatSaringKol(pathname: string, s: SaringKol): string {
  const p = new URLSearchParams();
  if (s.cari.trim()) p.set("cari", s.cari.trim());
  if (s.platform) p.set("platform", s.platform);
  if (s.tier) p.set("tier", s.tier);
  if (s.label.trim()) p.set("label", s.label.trim());
  if (s.status) p.set("status", s.status);
  if (s.urut !== "terbaru") p.set("urut", s.urut);
  if (s.halaman > 1) p.set("halaman", String(s.halaman));
  if (s.ukuran !== UKURAN_BAWAAN_KOL) p.set("ukuran", String(s.ukuran));
  if (s.tampilan !== "tabel") p.set("tampilan", s.tampilan);
  const qs = p.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Ada saringan selain urutan/halaman/tampilan — untuk memilih pesan "kosong" yang tepat. */
export function adaSaringanKol(s: SaringKol): boolean {
  return Boolean(s.cari.trim() || s.platform || s.tier || s.label.trim() || s.status);
}
