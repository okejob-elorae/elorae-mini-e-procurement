/**
 * Cari + halaman untuk daftar kantor modul piutang dan konsinyasi.
 *
 * Setiap daftar ini menghitung keadaannya sendiri dari banyak tabel (sisa
 * faktur dihitung ulang, langkah retur, tahap siklus), jadi saringan dan
 * pemotongan halamannya dikerjakan sesudah keadaan itu ada — di server, supaya
 * peramban hanya menerima satu halaman. Kata kunci dan halaman hidup di alamat
 * (`?cari=`, `?halaman=`), jadi tautannya bisa dibagikan.
 *
 * Murni — dipakai halaman server, diuji tanpa basis data.
 */

/** Baris per halaman. Satu angka untuk semua daftar modul ini. */
export const UKURAN_HALAMAN = 25;

/** Panjang kata kunci maksimum yang dibaca dari alamat. */
const PANJANG_CARI = 100;

export function bacaHalaman(raw: string | undefined | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function bacaCari(raw: string | undefined | null): string {
  return (raw ?? "").trim().slice(0, PANJANG_CARI);
}

/** Huruf kecil tanpa tanda aksen — "Eloraé" ditemukan dengan "elorae". */
function lipat(teks: string): string {
  return teks.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Apakah kata kunci muncul di salah satu teks (abai huruf besar-kecil dan aksen). */
export function cocokCari(cari: string, ...teks: (string | null | undefined)[]): boolean {
  const k = lipat(cari.trim());
  if (!k) return true;
  return teks.some((t) => t != null && lipat(t).includes(k));
}

export type Halaman<T> = {
  baris: T[];
  /** Halaman yang benar-benar ditampilkan — dijepit ke halaman terakhir. */
  halaman: number;
  totalHalaman: number;
  total: number;
  ukuran: number;
};

export function potongHalaman<T>(baris: T[], halaman: number, ukuran = UKURAN_HALAMAN): Halaman<T> {
  const totalHalaman = Math.max(1, Math.ceil(baris.length / ukuran));
  const h = Math.min(Math.max(1, halaman), totalHalaman);
  return {
    baris: baris.slice((h - 1) * ukuran, h * ukuran),
    halaman: h,
    totalHalaman,
    total: baris.length,
    ukuran,
  };
}

/** Alamat dengan parameter diganti; `null`/'' menghapus parameternya. */
export function denganParam(
  jalur: string,
  sekarang: URLSearchParams | Record<string, string | undefined>,
  ganti: Record<string, string | null | undefined>,
): string {
  const p =
    sekarang instanceof URLSearchParams
      ? new URLSearchParams(sekarang.toString())
      : new URLSearchParams(
          Object.entries(sekarang).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""),
        );
  for (const [k, v] of Object.entries(ganti)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `${jalur}?${qs}` : jalur;
}
