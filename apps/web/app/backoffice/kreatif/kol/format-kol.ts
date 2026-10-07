import type { StatusTone } from "@/components/ui/status-pill";
import type { Tier } from "@/lib/creative/aturan";

/*
 * Format angka layar KOL — murni, aman untuk klien. Ringkasan memakai koma
 * desimal ("1,2 jt"), bukan gaya "1.5jt" KOL Manager yang membingungkan di
 * format Indonesia.
 */

export function ringkasAngka(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  const abs = Math.abs(v);
  const fmt = (x: number) => x.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  if (abs >= 1_000_000_000) return `${fmt(v / 1_000_000_000)} M`;
  if (abs >= 1_000_000) return `${fmt(v / 1_000_000)} jt`;
  if (abs >= 1_000) return `${fmt(v / 1_000)} rb`;
  return Math.round(v).toLocaleString("id-ID");
}

export function angkaPenuh(n: number | null | undefined): string {
  return Math.round(Number(n ?? 0)).toLocaleString("id-ID");
}

export function rupiahLayar(n: number | null | undefined): string {
  return `Rp ${angkaPenuh(n)}`;
}

/** "4,8%", atau "—" bila kosong. */
export function persenTeks(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
}

/** "2,35×", atau "—" bila belum bisa dihitung. */
export function roasTeks(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

type Penerjemah = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

/** Pesan galat aksi KOL; kode yang tidak dikenal jatuh ke "Gagal menyimpan". */
export function pesanGagalKol(t: Penerjemah, kode: string, detail?: string): string {
  if (kode === "TIDAK_VALID" && detail && t.has(`kol.err.field.${detail}`)) return t(`kol.err.field.${detail}`);
  return t.has(`kol.err.${kode}`) ? t(`kol.err.${kode}`) : t("kol.err.GAGAL");
}

/** Tier makin tinggi makin menonjol, tapi tidak ada yang "buruk" — nano bukan cacat. */
export const NADA_TIER: Record<Tier, StatusTone> = { nano: "inactive", mikro: "waiting", makro: "progress", mega: "settled" };
