/**
 * Bulan siklus pertama konsinyasi di sistem — aturan murni, aman untuk klien (keputusan pemilik
 * 2026-11-02, P59: utang toko konsi di kertas sebelum bulan itu masuk lewat impor/ketik manual,
 * siklus sejak bulan itu ditagih dari angka yang dikunci — supaya tidak ada yang tertagih dua kali).
 */

const POLA_BULAN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `"YYYY-MM"` atau `{ bulan: "YYYY-MM" }` (tahun ≥ 2000); null untuk selain itu. */
export function bacaNilaiSiklusPertama(raw: unknown): string | null {
  let x: unknown = raw;
  if (typeof x === "string") {
    const t = x.trim();
    if (t.startsWith("{")) {
      try {
        x = JSON.parse(t);
      } catch {
        return null;
      }
    } else {
      x = t;
    }
  }
  if (x && typeof x === "object" && !Array.isArray(x)) x = (x as Record<string, unknown>).bulan;
  if (typeof x !== "string") return null;
  const m = POLA_BULAN.exec(x);
  if (!m || Number(m[1]) < 2000) return null;
  return x;
}

/** Bulan siklus `bulan` lebih dulu dari bulan siklus pertama. */
export function sebelumSiklusPertama(bulan: string, pertama: string): boolean {
  return bulan < pertama;
}

/** Faktur konsi (impor/manual) bertanggal sejak bulan siklus pertama — sudah ditagih lewat siklus. */
export function fakturKonsiLewatSiklusPertama(tanggalFaktur: Date, pertama: string | null): boolean {
  if (!pertama) return false;
  const hari = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(tanggalFaktur);
  return hari >= `${pertama}-01`;
}
