/**
 * Kreatif → Brand — alamat halaman (murni, aman untuk klien).
 *
 * Direktori brand yang pernah ditandai KOL (riwayat `KolBrandCollab`):
 * saringan, pencarian, halaman, dan brand yang sedang dibuka tinggal di alamat
 * (`?cari=&saring=&halaman=&brand=`), jadi tautannya bisa dibagikan. Kueri di
 * `brand-queries.ts` (server; klien hanya `import type`).
 */

import { normalBrand } from "./brand-collab";

export const RUTE_BRAND = "/backoffice/kreatif/brand";
export const PER_HALAMAN_BRAND = 50;

export const SARING_BRAND = ["semua", "kompetitor", "elorae"] as const;
export type SaringBrand = (typeof SARING_BRAND)[number];

export type ParamBrand = {
  cari: string;
  saring: SaringBrand;
  halaman: number;
  /** Brand yang dibuka (daftar KOL-nya); null = direktori. */
  brand: string | null;
};

type IsiAlamat = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function bacaParamBrand(sp: IsiAlamat): ParamBrand {
  const cari = (satu(sp.cari) ?? "").trim().slice(0, 100);
  const s = satu(sp.saring);
  const saring = (SARING_BRAND as readonly string[]).includes(s ?? "") ? (s as SaringBrand) : "semua";
  const h = Number(satu(sp.halaman));
  const halaman = Number.isInteger(h) && h >= 1 && h <= 100_000 ? h : 1;
  const brand = normalBrand(satu(sp.brand) ?? "") || null;
  return { cari, saring, halaman, brand };
}

/** Alamat untuk keadaan `p`; nilai bawaan tidak ditulis supaya alamatnya pendek. */
export function alamatBrand(p: Partial<ParamBrand>): string {
  const q = new URLSearchParams();
  if (p.brand) q.set("brand", p.brand);
  if (p.cari) q.set("cari", p.cari);
  if (p.saring && p.saring !== "semua") q.set("saring", p.saring);
  if (p.halaman && p.halaman > 1) q.set("halaman", String(p.halaman));
  const qs = q.toString();
  return qs ? `${RUTE_BRAND}?${qs}` : RUTE_BRAND;
}
