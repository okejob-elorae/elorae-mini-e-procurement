/**
 * Rate card per format konten (`Kol.rateFormat`, JSON teks) — murni, aman
 * untuk klien.
 *
 * Bentuknya `{ FEED?, REELS?, STORY?, VIDEO?, LIVE?, CAROUSEL? }` dalam rupiah
 * bulat; kuncinya enum `ContentFormat` Prisma. `Kol.rateCard` (tarif umum)
 * tetap ada di sampingnya. Nol berarti "gratis" dan tetap tersimpan; format
 * yang tidak diisi tidak ada kuncinya.
 */

export const FORMAT_RATE = ["FEED", "REELS", "STORY", "VIDEO", "LIVE", "CAROUSEL"] as const;

export type FormatRate = (typeof FORMAT_RATE)[number];

export type RateFormat = Partial<Record<FormatRate, number>>;

/** Batas atas satu tarif (di bawah batas Decimal(15,2) — sama dengan rate card umum). */
export const MAKS_RATE_FORMAT = 999_999_999_999;

const FORMAT_SET: ReadonlySet<string> = new Set(FORMAT_RATE);

const rupiahSah = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAKS_RATE_FORMAT;

function keObjek(nilai: unknown): Record<string, unknown> | null {
  let x = nilai;
  if (typeof x === "string") {
    if (!x.trim()) return null;
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** Pembaca pemaaf untuk isi kolom: kunci tak dikenal dan angka tak sah dibuang satu per satu. */
export function bacaRateFormat(nilai: unknown): RateFormat {
  const o = keObjek(nilai);
  const hasil: RateFormat = {};
  if (!o) return hasil;
  for (const f of FORMAT_RATE) if (rupiahSah(o[f])) hasil[f] = o[f] as number;
  return hasil;
}

export type HasilValidasiRateFormat = { ok: true; rate: RateFormat } | { ok: false; galat: string[] };

/**
 * Validasi isian formulir. `null`/`undefined` per format = tidak diisi.
 * Kunci yang tidak dikenal atau angka yang tidak sah DITOLAK (tidak diam-diam
 * dibuang), supaya orang yang mengetik tahu isiannya tidak tersimpan.
 */
export function validasiRateFormat(input: unknown): HasilValidasiRateFormat {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, galat: [] };
  const o = input as Record<string, unknown>;
  const rate: RateFormat = {};
  const galat: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (!FORMAT_SET.has(k)) {
      galat.push(k);
      continue;
    }
    if (v === null || v === undefined) continue;
    if (!rupiahSah(v)) galat.push(k);
    else rate[k as FormatRate] = v;
  }
  return galat.length ? { ok: false, galat } : { ok: true, rate };
}

/** Bentuk simpan: urutan kunci tetap; tanpa satu tarif pun = `null` (kolom dikosongkan). */
export function tulisRateFormat(rate: RateFormat): string | null {
  const isi = isiRateFormat(rate);
  return isi.length ? JSON.stringify(Object.fromEntries(isi.map((x) => [x.format, x.rupiah]))) : null;
}

/** Tarif yang diisi, dalam urutan `FORMAT_RATE` (untuk ditampilkan). */
export function isiRateFormat(rate: RateFormat): { format: FormatRate; rupiah: number }[] {
  return FORMAT_RATE.filter((f) => rate[f] !== undefined).map((f) => ({ format: f, rupiah: rate[f] as number }));
}
