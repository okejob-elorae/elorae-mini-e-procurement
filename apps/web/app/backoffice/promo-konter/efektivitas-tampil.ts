/**
 * Tampilan angka layar efektivitas promo. Ditulis tangan (bukan `Intl`) supaya
 * teks server dan peramban sama persis — lihat `lib/format/rupiah.ts`.
 */

const SPASI = " ";

const kelompokkan = (bulat: string) => bulat.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** "1.234,5" — pengelompokan titik, koma desimal, ",0" di ujung dibuang. */
export function angkaId(nilai: number, desimal = 0): string {
  if (!Number.isFinite(nilai)) return "—";
  const tetap = Math.abs(nilai).toFixed(desimal);
  const [bulat, pecahan] = tetap.split(".");
  const pecah = pecahan ? pecahan.replace(/0+$/, "") : "";
  const tanda = nilai < 0 && Number(tetap) !== 0 ? "-" : "";
  return `${tanda}${kelompokkan(bulat)}${pecah ? `,${pecah}` : ""}`;
}

/** "Rp 0,28" — rupiah dengan dua desimal, untuk perbandingan per Rp1. */
export function rupiahPecahan(nilai: number): string {
  if (!Number.isFinite(nilai)) return "—";
  const [bulat, pecahan] = Math.abs(nilai).toFixed(2).split(".");
  return `${nilai < 0 ? "-" : ""}Rp${SPASI}${kelompokkan(bulat)},${pecahan}`;
}

export type ArahPerubahan = "naik" | "turun" | "sama";

/** Perubahan persen dengan panah (tidak pernah warna saja). Null = tidak ada pembanding. */
export function perubahanPersen(persen: number | null): { teks: string; arah: ArahPerubahan } | null {
  if (persen === null) return null;
  if (persen > 0) return { teks: `▲ ${angkaId(persen, 1)}%`, arah: "naik" };
  if (persen < 0) return { teks: `▼ ${angkaId(Math.abs(persen), 1)}%`, arah: "turun" };
  return { teks: "= 0%", arah: "sama" };
}

export const KELAS_ARAH: Record<ArahPerubahan, string> = {
  naik: "text-emerald-700 dark:text-emerald-400",
  turun: "text-destructive",
  sama: "text-muted-foreground",
};

/** Akhir periode yang disimpan eksklusif → hari terakhirnya (untuk tanggal tampil). */
export function akhirInklusif(iso: string): Date {
  return new Date(new Date(iso).getTime() - 1);
}
