import { hexKeHsb, normalisasiHex, putarSudut, type Hsb } from './warna';

export type { Hsb };

/**
 * Aturan harmoni, dengan nama dan urutan yang sama seperti di Adobe Color —
 * tim kreatif sudah mengenal nama-nama ini dari sana, dan menerjemahkannya
 * hanya membuat mereka mencocokkan dua kosakata.
 */
export const ATURAN_HARMONI = [
  'ANALOGOUS',
  'MONOCHROMATIC',
  'TRIAD',
  'COMPLEMENTARY',
  'SPLIT_COMPLEMENTARY',
  'SQUARE',
  'COMPOUND',
  'SHADES',
  'CUSTOM',
] as const;

export type AturanHarmoni = (typeof ATURAN_HARMONI)[number];

export const JUMLAH_WARNA = 5;

/** Warna dasar selalu di tengah, seperti di Adobe. */
export const INDEKS_DASAR = 2;

export type KeadaanPalet = { aturan: AturanHarmoni; warna: Hsb[] };

type Langkah = { dh: number; s: number; b: number };

function l(dh = 0, s = 1, b = 1): Langkah {
  return { dh, s, b };
}

/**
 * Tiap aturan adalah lima langkah dari warna dasar: geser rona `dh` derajat
 * di roda pelukis, kalikan kepekatan dengan `s` dan kecerahan dengan `b`.
 * Posisi ke-3 selalu `l()` — warna dasar itu sendiri.
 *
 * Pengali, bukan penambah: warna dasar yang sudah gelap tetap punya lima
 * warna berbeda, alih-alih tiga yang terpotong ke hitam yang sama.
 */
const RESEP: Record<Exclude<AturanHarmoni, 'CUSTOM'>, readonly Langkah[]> = {
  ANALOGOUS: [l(-60), l(-30), l(), l(30), l(60)],
  MONOCHROMATIC: [l(0, 1, 0.4), l(0, 0.55, 1), l(), l(0, 0.55, 0.65), l(0, 1, 0.7)],
  TRIAD: [l(120, 1, 0.6), l(120), l(), l(240), l(240, 1, 0.6)],
  COMPLEMENTARY: [l(0, 1, 0.6), l(0, 0.5, 1), l(), l(180), l(180, 1, 0.6)],
  SPLIT_COMPLEMENTARY: [l(150, 1, 0.6), l(150), l(), l(210), l(210, 1, 0.6)],
  SQUARE: [l(90), l(180), l(), l(270), l(0, 1, 0.6)],
  COMPOUND: [l(30), l(30, 1, 0.6), l(), l(180), l(150, 1, 0.6)],
  SHADES: [l(0, 1, 0.4), l(0, 1, 0.7), l(), l(0, 1, 0.55), l(0, 1, 0.25)],
};

function batas01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Lima warna menurut aturannya. Untuk `CUSTOM` warna yang ada dikembalikan
 * utuh — hanya warna dasarnya yang diganti — karena "bebas" berarti tidak ada
 * yang boleh menyusun ulang pilihan orang.
 */
export function susunHarmoni(aturan: AturanHarmoni, dasar: Hsb, ada: readonly Hsb[]): Hsb[] {
  if (aturan === 'CUSTOM') {
    return ada.map((w, i) => (i === INDEKS_DASAR ? dasar : w));
  }
  return RESEP[aturan].map((langkah, i) =>
    i === INDEKS_DASAR
      ? dasar
      : {
          h: putarSudut(dasar.h + langkah.dh),
          s: batas01(dasar.s * langkah.s),
          b: batas01(dasar.b * langkah.b),
        },
  );
}

export function keadaanDariHex(aturan: AturanHarmoni, hex: readonly string[]): KeadaanPalet {
  return { aturan, warna: hex.map(hexKeHsb) };
}

/**
 * Pegangan di roda digeser ke sudut `h` dan jarak `s` dari tengah.
 *
 * Dengan aturan aktif, pegangan mana pun MEMUTAR seluruh harmoni — geserannya
 * dipindahkan ke warna dasar, lalu keempat warna lain disusun ulang. Jarak dari
 * tengah hanya berarti lewat pegangan dasar; pegangan lain kembali ke jaraknya
 * menurut aturan, karena memegangnya di tempat lain sama dengan melanggar
 * aturan yang sedang dipilih.
 */
export function geserPegangan(keadaan: KeadaanPalet, indeks: number, h: number, s: number): KeadaanPalet {
  const sudut = putarSudut(h);
  const pekat = batas01(s);

  if (keadaan.aturan === 'CUSTOM') {
    return {
      aturan: 'CUSTOM',
      warna: keadaan.warna.map((w, i) => (i === indeks ? { ...w, h: sudut, s: pekat } : w)),
    };
  }

  const dasar = keadaan.warna[INDEKS_DASAR];
  const dasarBaru: Hsb = {
    h: putarSudut(sudut - RESEP[keadaan.aturan][indeks].dh),
    s: indeks === INDEKS_DASAR ? pekat : dasar.s,
    b: dasar.b,
  };
  return { aturan: keadaan.aturan, warna: susunHarmoni(keadaan.aturan, dasarBaru, keadaan.warna) };
}

/**
 * Mengganti satu warna di luar roda (kecerahan atau hex).
 *
 * Warna dasar tetap memegang aturannya dan menyusun ulang yang lain. Warna
 * lain yang disunting MELEPAS aturannya ke `CUSTOM`: kalau aturannya tetap
 * dipegang, suntingan itu hilang begitu pegangan berikutnya disentuh.
 */
function gantiWarna(keadaan: KeadaanPalet, indeks: number, baru: Hsb): KeadaanPalet {
  if (keadaan.aturan !== 'CUSTOM' && indeks === INDEKS_DASAR) {
    return { aturan: keadaan.aturan, warna: susunHarmoni(keadaan.aturan, baru, keadaan.warna) };
  }
  return {
    aturan: 'CUSTOM',
    warna: keadaan.warna.map((w, i) => (i === indeks ? baru : w)),
  };
}

export function ubahKecerahan(keadaan: KeadaanPalet, indeks: number, b: number): KeadaanPalet {
  return gantiWarna(keadaan, indeks, { ...keadaan.warna[indeks], b: batas01(b) });
}

export function gantiHexWarna(keadaan: KeadaanPalet, indeks: number, hex: string): KeadaanPalet {
  const bersih = normalisasiHex(hex);
  if (!bersih) return keadaan;
  const baru = hexKeHsb(bersih);
  // Abu-abu tidak punya rona. Mempertahankan yang lama membuat pegangannya
  // tetap di jari-jari yang sama saat orang menaikkan kepekatannya lagi.
  if (baru.s === 0) baru.h = keadaan.warna[indeks].h;
  return gantiWarna(keadaan, indeks, baru);
}
