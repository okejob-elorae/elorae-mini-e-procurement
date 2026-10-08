import { formatRupiah } from "@/lib/format/rupiah";

/*
 * Satu cara menulis angka di SEMUA laporan keuangan (layar dan cetak):
 * rupiah utuh, negatif dalam kurung — "(Rp 350.000)" — seperti laporan
 * keuangan pada umumnya. Sebelumnya tiap laporan punya `formatRupiah`-nya
 * sendiri dengan tanda minus di depan "Rp", sementara rincian BKM menulis
 * "− Rp 870.000". Murni, aman untuk komponen klien.
 */

const keSen = (n: number): number => Math.round(Number((n * 100).toFixed(4)));

/** "Rp 350.000", atau "(Rp 350.000)" untuk negatif. Nol tidak pernah bertanda. */
export function rupiahLaporan(nilai: number | null | undefined): string {
  const n = Number(nilai ?? 0);
  if (!Number.isFinite(n)) return formatRupiah(0);
  const bulat = Math.sign(n) * Math.round(Math.abs(n));
  if (bulat < 0) return `(${formatRupiah(-bulat)})`;
  return formatRupiah(bulat);
}

/** "12,3%" / "(4,0%)"; null atau tak terhingga → "—". */
export function persenLaporan(nilai: number | null | undefined): string {
  if (nilai == null || !Number.isFinite(nilai)) return "—";
  const teks = Math.abs(nilai).toFixed(1).replace(".", ",");
  return nilai < 0 && teks !== "0,0" ? `(${teks}%)` : `${teks}%`;
}

/** "1,50×"; null → "—". */
export function rasioLaporan(nilai: number | null | undefined): string {
  if (nilai == null || !Number.isFinite(nilai)) return "—";
  return `${nilai.toFixed(2).replace(".", ",")}×`;
}

/** "45 hari"-style angka hari utuh; null → "—". */
export function hariLaporan(nilai: number | null | undefined, satuan = "hari"): string {
  if (nilai == null || !Number.isFinite(nilai)) return "—";
  return `${Math.round(nilai).toLocaleString("id-ID")} ${satuan}`;
}

/**
 * Selisih `nilai − pembanding` (dihitung dalam sen) dan persennya terhadap
 * BESARAN pembanding — rugi 100 menjadi rugi 50 tercatat +50%, membaik.
 * Pembanding nol tidak punya persen (null), bukan tak terhingga.
 */
export function selisihPersen(nilai: number, pembanding: number): { selisih: number; persen: number | null } {
  const selisihSen = keSen(nilai) - keSen(pembanding);
  const pembandingSen = keSen(pembanding);
  return {
    selisih: selisihSen / 100 + 0,
    persen: pembandingSen === 0 ? null : (selisihSen / Math.abs(pembandingSen)) * 100,
  };
}
