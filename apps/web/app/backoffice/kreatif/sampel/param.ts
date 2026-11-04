import { bacaTabSampel, type TabSampel } from "@/lib/creative/sampel-aturan";

/**
 * Keadaan layar Sampel di alamat (`?tab=`, `?cari=`, `?campaign=`, `?kolaborasi=`, `?halaman=`),
 * supaya tautan dari Hari ini dan kalender membuka antrean yang sama dengan
 * angkanya, dan muat ulang tidak kembali ke tab pertama. Murni — dipakai
 * halaman server dan klien.
 */

export type ParamSampel = {
  tab: TabSampel;
  cari: string;
  campaign: string | null;
  /** Satu kolaborasi saja — tautan dari Hari ini. */
  kolaborasi: string | null;
  halaman: number;
};

const satu = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

export function bacaParamSampel(sp: Record<string, string | string[] | undefined>): ParamSampel {
  const halaman = Number.parseInt(satu(sp.halaman), 10);
  return {
    tab: bacaTabSampel(satu(sp.tab)),
    cari: satu(sp.cari).trim().slice(0, 100),
    campaign: satu(sp.campaign).trim() || null,
    kolaborasi: satu(sp.kolaborasi).trim() || null,
    halaman: Number.isFinite(halaman) && halaman > 1 ? halaman : 1,
  };
}

/** Alamat layar Sampel; nilai bawaan tidak ditulis. */
export function alamatSampel(p: ParamSampel): string {
  const q = new URLSearchParams();
  if (p.tab !== "perlu-dikirim") q.set("tab", p.tab);
  if (p.cari.trim()) q.set("cari", p.cari.trim());
  if (p.campaign) q.set("campaign", p.campaign);
  if (p.kolaborasi) q.set("kolaborasi", p.kolaborasi);
  if (p.halaman > 1) q.set("halaman", String(p.halaman));
  const s = q.toString();
  return s ? `/backoffice/kreatif/sampel?${s}` : "/backoffice/kreatif/sampel";
}
