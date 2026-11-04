import { cariPantone, deltaE2000, hexKeLab, type WarnaPantone } from './pantone';
import { hexKeRgb } from './warna';

/**
 * Menjelajahi katalog Pantone tanpa harus tahu kodenya.
 *
 * Tim memilih kain seperti membuka buku swatch: "yang biru", "yang mirip
 * Blue Surf". Kotak pencarian saja memaksa orang tahu kode atau nama lebih
 * dulu — dan dulu hasilnya pun dipotong di enam. Di sini seluruh katalog
 * bisa dijelajahi per keluarga warna, diurutkan dari terang ke gelap.
 */

export const KELUARGA_WARNA = ['MERAH', 'ORANYE', 'KUNING', 'HIJAU', 'BIRU', 'UNGU', 'PINK', 'COKELAT', 'NETRAL'] as const;

export type KeluargaWarna = (typeof KELUARGA_WARNA)[number];

/** Di bawah kroma Lab ini warna dibaca sebagai netral — abu-abu, putih tulang, hitam. */
const KROMA_NETRAL = 8;

/**
 * Keluarga warna dari hex. Kroma diukur di Lab (setara mata); rona di roda
 * layar, karena batas antar-nama warna sehari-hari ("oranye", "kuning") lebih
 * dekat ke sana daripada ke sudut Lab. Cokelat adalah oranye-kuning yang gelap.
 */
export function keluargaWarna(hex: string): KeluargaWarna {
  const [L, a, b] = hexKeLab(hex);
  if (Math.hypot(a, b) < KROMA_NETRAL) return 'NETRAL';

  const { r, g, b: bl } = hexKeRgb(hex);
  const maks = Math.max(r, g, bl);
  const d = maks - Math.min(r, g, bl);
  let rona = maks === r ? 60 * (((g - bl) / d) % 6) : maks === g ? 60 * ((bl - r) / d + 2) : 60 * ((r - g) / d + 4);
  rona = (rona + 360) % 360;

  if (rona >= 12 && rona < 55 && L < 50) return 'COKELAT';
  if (rona >= 345 || rona < 12) return 'MERAH';
  if (rona < 40) return 'ORANYE';
  if (rona < 70) return 'KUNING';
  if (rona < 165) return 'HIJAU';
  if (rona < 255) return 'BIRU';
  if (rona < 290) return 'UNGU';
  return 'PINK';
}

const cacheKeluarga = new WeakMap<WarnaPantone, KeluargaWarna>();
function keluargaDari(w: WarnaPantone): KeluargaWarna {
  let k = cacheKeluarga.get(w);
  if (!k) {
    k = keluargaWarna(w.hex);
    cacheKeluarga.set(w, k);
  }
  return k;
}

export function hitungKeluarga(katalog: readonly WarnaPantone[]): Record<KeluargaWarna, number> {
  const hitung = Object.fromEntries(KELUARGA_WARNA.map((k) => [k, 0])) as Record<KeluargaWarna, number>;
  for (const w of katalog) hitung[keluargaDari(w)] += 1;
  return hitung;
}

/**
 * Isi katalog yang tampil. Tanpa kueri: seluruh katalog (atau satu keluarga),
 * dikelompokkan per keluarga lalu dari terang ke gelap. Dengan kueri: urutan
 * relevansi pencarian dipertahankan. Tidak ada batas jumlah — memotong hasil
 * adalah urusan layar (tombol "tampilkan lebih banyak"), bukan urusan data.
 */
export function jelajahiKatalog(
  katalog: readonly WarnaPantone[],
  saring: { kueri: string; keluarga: KeluargaWarna | null },
): WarnaPantone[] {
  const cocokKeluarga = (w: WarnaPantone) => saring.keluarga === null || keluargaDari(w) === saring.keluarga;
  if (saring.kueri.trim()) {
    return cariPantone(katalog, saring.kueri, Number.POSITIVE_INFINITY).filter(cocokKeluarga);
  }
  return katalog
    .filter(cocokKeluarga)
    .map((w, i) => ({ w, i, k: KELUARGA_WARNA.indexOf(keluargaDari(w)) }))
    .sort((x, y) => x.k - y.k || y.w.lab[0] - x.w.lab[0] || x.i - y.i)
    .map((x) => x.w);
}

/** Variasi terdekat sebuah warna — "kain yang mirip Blue Surf". CIEDE2000 ke seluruh katalog. */
export function variasiTerdekat(
  katalog: readonly WarnaPantone[],
  hex: string,
  jumlah: number,
): { warna: WarnaPantone; deltaE: number }[] {
  const lab = hexKeLab(hex);
  return katalog
    .map((warna) => ({ warna, deltaE: deltaE2000(lab, warna.lab) }))
    .sort((a, b) => a.deltaE - b.deltaE)
    .slice(0, jumlah);
}
