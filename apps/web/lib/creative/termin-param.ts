/**
 * Alamat layar Pembayaran KOL per termin — murni, aman untuk klien.
 *
 * Seluruh saringan ada di alamat (`?chip=&cari=&campaign=&kolaborasi=&halaman=&per=`).
 * Chip lama dari layar per-kolaborasi tetap terbaca: LUNAS → Dibayar,
 * SEBAGIAN → Belum dibayar. `?kolaborasi=` dipakai pintasan "Bayar" di Hari ini.
 */

export const RUTE_PEMBAYARAN = "/backoffice/kreatif/pembayaran";

export type ChipTermin = "BELUM" | "JATUH_TEMPO" | "DIBAYAR" | "SEMUA";
export const CHIP_TERMIN: readonly ChipTermin[] = ["BELUM", "JATUH_TEMPO", "DIBAYAR", "SEMUA"];
export const CHIP_TERMIN_BAWAAN: ChipTermin = "BELUM";

export function bacaChipTermin(v: unknown): ChipTermin {
  if (typeof v !== "string") return CHIP_TERMIN_BAWAAN;
  if ((CHIP_TERMIN as readonly string[]).includes(v)) return v as ChipTermin;
  if (v === "LUNAS") return "DIBAYAR";
  if (v === "SEBAGIAN") return "BELUM";
  return CHIP_TERMIN_BAWAAN;
}

export const UKURAN_HALAMAN_TERMIN = [25, 50, 100] as const;

export type ParamTermin = {
  chip: ChipTermin;
  cari: string;
  campaign: string | null;
  kolaborasi: string | null;
  halaman: number;
  per: number;
};

type IsiAlamat = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const pendek = (v: string | undefined, maks: number) => {
  const t = (v ?? "").trim();
  return t.length <= maks ? t : t.slice(0, maks);
};

export function bacaParamTermin(sp: IsiAlamat): ParamTermin {
  const n = Number(satu(sp.halaman));
  const per = Number(satu(sp.per));
  return {
    chip: bacaChipTermin(satu(sp.chip)),
    cari: pendek(satu(sp.cari), 100),
    campaign: pendek(satu(sp.campaign), 64) || null,
    kolaborasi: pendek(satu(sp.kolaborasi), 64) || null,
    halaman: Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1,
    per: (UKURAN_HALAMAN_TERMIN as readonly number[]).includes(per) ? per : UKURAN_HALAMAN_TERMIN[0],
  };
}

export function alamatTermin(p: ParamTermin): string {
  const q = new URLSearchParams();
  if (p.chip !== CHIP_TERMIN_BAWAAN) q.set("chip", p.chip);
  if (p.cari.trim()) q.set("cari", p.cari.trim());
  if (p.campaign) q.set("campaign", p.campaign);
  if (p.kolaborasi) q.set("kolaborasi", p.kolaborasi);
  if (p.halaman > 1) q.set("halaman", String(p.halaman));
  if (p.per !== UKURAN_HALAMAN_TERMIN[0]) q.set("per", String(p.per));
  const qs = q.toString();
  return qs ? `${RUTE_PEMBAYARAN}?${qs}` : RUTE_PEMBAYARAN;
}

/** Masa pajak "YYYY-MM" (bulan WIB); rusak → null. */
export function bacaMasa(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

/** Masa bulan sebelum/sesudah. */
export function geserMasa(masa: string, n: number): string {
  const [t, b] = masa.split("-").map(Number);
  const d = new Date(Date.UTC(t, b - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
