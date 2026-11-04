/**
 * Harga pesaing — murni. Salesman mencatat harga merek lain yang tergantung di
 * dekat rak Elorae (merek, produk, kategori, harga, foto label). Kantor
 * membacanya per merek × kategori untuk melihat di mana harga Elorae berdiri.
 *
 * Merek dan kategori diketik bebas di HP, jadi pengelompokannya memakai kunci
 * yang mengabaikan huruf besar/kecil dan spasi berlebih — "Nevada" dan
 * "nevada " adalah merek yang sama.
 */

export const BATAS_HARGA_PESAING = {
  merek: 60,
  produk: 120,
  kategori: 60,
  catatan: 500,
  hargaMaks: 100_000_000,
} as const;

/** Kiriman berisi sama dari orang yang sama di toko yang sama dalam jeda ini dianggap ketukan ulang. */
export const JEDA_KIRIM_ULANG_MS = 10 * 60 * 1000;

export type KodeTolakHargaPesaing =
  | "MEREK_WAJIB"
  | "PRODUK_WAJIB"
  | "HARGA_TIDAK_SAH"
  | "TEKS_TERLALU_PANJANG"
  | "FOTO_TIDAK_SAH";

export type HargaPesaingSah = {
  brand: string;
  productName: string;
  category: string | null;
  price: number;
  note: string | null;
  photoUrl: string | null;
};

export type HasilPeriksaHargaPesaing = { ok: true; nilai: HargaPesaingSah } | { ok: false; kode: KodeTolakHargaPesaing };

const rapi = (s: unknown) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "");

/**
 * Foto hanya dari unggahan kita sendiri (`/api/foto/<id>`). URL luar akan
 * dimuat oleh layar kantor setiap kali laporan dibuka — alamat siapa pun yang
 * membukanya bocor ke pemilik URL itu.
 */
const POLA_FOTO = /^\/api\/foto\/[A-Za-z0-9_-]{1,64}$/;

export function periksaHargaPesaing(raw: unknown): HasilPeriksaHargaPesaing {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const brand = rapi(o.brand);
  if (!brand) return { ok: false, kode: "MEREK_WAJIB" };
  const productName = rapi(o.productName);
  if (!productName) return { ok: false, kode: "PRODUK_WAJIB" };
  const category = rapi(o.category) || null;
  // Catatan boleh berbaris — hanya ujungnya yang dirapikan.
  const note = (typeof o.note === "string" ? o.note.trim() : "") || null;
  if (
    brand.length > BATAS_HARGA_PESAING.merek ||
    productName.length > BATAS_HARGA_PESAING.produk ||
    (category?.length ?? 0) > BATAS_HARGA_PESAING.kategori ||
    (note?.length ?? 0) > BATAS_HARGA_PESAING.catatan
  ) {
    return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  }

  const p = o.price;
  if (typeof p !== "number" || !Number.isFinite(p) || p <= 0 || p > BATAS_HARGA_PESAING.hargaMaks) {
    return { ok: false, kode: "HARGA_TIDAK_SAH" };
  }
  const price = Math.round(p * 100) / 100;

  let photoUrl: string | null = null;
  if (o.photoUrl !== undefined && o.photoUrl !== null && o.photoUrl !== "") {
    if (typeof o.photoUrl !== "string" || !POLA_FOTO.test(o.photoUrl)) return { ok: false, kode: "FOTO_TIDAK_SAH" };
    photoUrl = o.photoUrl;
  }

  return { ok: true, nilai: { brand, productName, category, price, note, photoUrl } };
}

/** Kunci pengelompokan teks bebas: huruf kecil, spasi dirapatkan. */
export function kunciTeks(s: string | null | undefined): string {
  return rapi(s).toLowerCase();
}

/**
 * Kiriman ini ulangan dari baris terakhir? Tabel harga pesaing tidak punya
 * kunci idempoten, dan HP yang kehilangan jawaban server akan mengirim ulang —
 * dua baris identik akan menggandakan bobot satu harga di rata-rata.
 */
export function kirimanUlang(
  baru: { brand: string; productName: string; category: string | null; price: number },
  terakhir: { brand: string; productName: string; category: string | null; price: number | string; createdAt: Date },
  sekarang: Date,
): boolean {
  if (sekarang.getTime() - terakhir.createdAt.getTime() > JEDA_KIRIM_ULANG_MS) return false;
  return (
    kunciTeks(baru.brand) === kunciTeks(terakhir.brand) &&
    kunciTeks(baru.productName) === kunciTeks(terakhir.productName) &&
    kunciTeks(baru.category) === kunciTeks(terakhir.category) &&
    Math.round(baru.price * 100) === Math.round(Number(terakhir.price) * 100)
  );
}

export type RingkasHargaPesaing = {
  merek: string;
  kategori: string | null;
  jumlah: number;
  min: number;
  rata: number;
  maks: number;
};

/** Ejaan yang paling sering dipakai untuk satu kunci; seri → yang pertama terlihat. */
function ejaanTerbanyak(hitung: Map<string, number>): string {
  let terbaik = "";
  let n = -1;
  for (const [ejaan, c] of hitung) {
    if (c > n) {
      terbaik = ejaan;
      n = c;
    }
  }
  return terbaik;
}

/** Min/rata/maks per merek × kategori. Kategori kosong adalah kelompoknya sendiri, diurutkan terakhir. */
export function ringkasHargaPesaing(
  rows: { brand: string; category: string | null; price: number }[],
): RingkasHargaPesaing[] {
  type Grup = { merek: Map<string, number>; kategori: Map<string, number>; adaKategori: boolean; harga: number[] };
  const grup = new Map<string, Grup>();
  for (const r of rows) {
    const kMerek = kunciTeks(r.brand);
    const kKategori = kunciTeks(r.category);
    const k = `${kMerek}|${kKategori}`;
    let g = grup.get(k);
    if (!g) {
      g = { merek: new Map(), kategori: new Map(), adaKategori: kKategori !== "", harga: [] };
      grup.set(k, g);
    }
    const m = rapi(r.brand);
    g.merek.set(m, (g.merek.get(m) ?? 0) + 1);
    if (g.adaKategori) {
      const c = rapi(r.category);
      g.kategori.set(c, (g.kategori.get(c) ?? 0) + 1);
    }
    g.harga.push(r.price);
  }

  const hasil: RingkasHargaPesaing[] = [...grup.values()].map((g) => ({
    merek: ejaanTerbanyak(g.merek),
    kategori: g.adaKategori ? ejaanTerbanyak(g.kategori) : null,
    jumlah: g.harga.length,
    min: Math.min(...g.harga),
    rata: Math.round(g.harga.reduce((s, x) => s + x, 0) / g.harga.length),
    maks: Math.max(...g.harga),
  }));

  return hasil.sort((a, b) => {
    const m = a.merek.localeCompare(b.merek, "id", { sensitivity: "base" });
    if (m !== 0) return m;
    if (a.kategori === null) return b.kategori === null ? 0 : 1;
    if (b.kategori === null) return -1;
    return a.kategori.localeCompare(b.kategori, "id", { sensitivity: "base" });
  });
}
