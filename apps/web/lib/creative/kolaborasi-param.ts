/**
 * Keadaan daftar Kolaborasi di alamat — murni, aman untuk klien.
 *
 * `?tahap=&campaign=&platform=&pic=&cari=&tampilan=&halaman=`. Semua keadaan
 * ada di alamat (perbaikan KOL Manager yang tidak punya alamat sama sekali):
 * tautan "Lihat kolaborasi" dari Campaign, tombol Kembali, dan muat ulang
 * membuka daftar yang sama persis.
 */

import { SEMUA_PLATFORM, type Platform } from "./aturan";
import { SEMUA_TAHAP, type Tahap } from "./tahap";

/** Chip "Keluar" = ketiga jalur keluar sekaligus. */
export const TAHAP_KELUAR = "KELUAR" as const;
export type SaringTahap = Tahap | typeof TAHAP_KELUAR | null;

export const TAMPILAN_KOLABORASI = ["tabel", "papan"] as const;
export type TampilanKolaborasi = (typeof TAMPILAN_KOLABORASI)[number];

export const UKURAN_HALAMAN_KOLABORASI = 25;

/** Papan memuat sekian kartu paling banyak; sisanya diberi tahu, tidak disembunyikan diam-diam. */
export const BATAS_PAPAN = 400;

export type ParamKolaborasi = {
  tahap: SaringTahap;
  campaign: string | null;
  platform: Platform | null;
  pic: string | null;
  cari: string;
  tampilan: TampilanKolaborasi;
  halaman: number;
};

export const PARAM_KOLABORASI_AWAL: ParamKolaborasi = {
  tahap: null,
  campaign: null,
  platform: null,
  pic: null,
  cari: "",
  tampilan: "tabel",
  halaman: 1,
};

type Mentah = Record<string, string | string[] | undefined>;

const satu = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

export function bacaParamKolaborasi(sp: Mentah): ParamKolaborasi {
  const tahapMentah = satu(sp.tahap).toUpperCase();
  const tahap: SaringTahap =
    tahapMentah === TAHAP_KELUAR
      ? TAHAP_KELUAR
      : (SEMUA_TAHAP as readonly string[]).includes(tahapMentah)
        ? (tahapMentah as Tahap)
        : null;
  const platformMentah = satu(sp.platform).toUpperCase();
  const platform = (SEMUA_PLATFORM as readonly string[]).includes(platformMentah) ? (platformMentah as Platform) : null;
  const tampilanMentah = satu(sp.tampilan);
  const tampilan = (TAMPILAN_KOLABORASI as readonly string[]).includes(tampilanMentah)
    ? (tampilanMentah as TampilanKolaborasi)
    : "tabel";
  const halaman = Number.parseInt(satu(sp.halaman), 10);
  return {
    tahap,
    campaign: satu(sp.campaign) || null,
    platform,
    pic: satu(sp.pic) || null,
    cari: satu(sp.cari).slice(0, 100),
    tampilan,
    halaman: Number.isFinite(halaman) && halaman > 0 ? halaman : 1,
  };
}

/** Alamat daftar untuk keadaan ini; nilai bawaan tidak ditulis supaya alamatnya pendek. */
export function alamatKolaborasi(p: ParamKolaborasi, dasar = "/backoffice/kreatif/kolaborasi"): string {
  const q = new URLSearchParams();
  if (p.tahap) q.set("tahap", p.tahap);
  if (p.campaign) q.set("campaign", p.campaign);
  if (p.platform) q.set("platform", p.platform);
  if (p.pic) q.set("pic", p.pic);
  if (p.cari.trim()) q.set("cari", p.cari.trim());
  if (p.tampilan !== "tabel") q.set("tampilan", p.tampilan);
  if (p.halaman > 1) q.set("halaman", String(p.halaman));
  const s = q.toString();
  return s ? `${dasar}?${s}` : dasar;
}

/** Alamat memilih tampilan sendiri — pilihan tersimpan di perangkat tidak dipakai. */
export function alamatMemilihTampilan(sp: Mentah): boolean {
  return satu(sp.tampilan) !== "";
}

/** Ada saringan selain tahap dan tampilan (untuk keadaan kosong yang tepat). */
export function adaSaringan(p: ParamKolaborasi): boolean {
  return Boolean(p.campaign || p.platform || p.pic || p.cari.trim());
}
