/**
 * Hitungan warna untuk roda palet.
 *
 * Roda ini roda PELUKIS (merah–kuning–biru), bukan roda layar (merah–hijau–
 * biru), karena itu yang dipakai Adobe Color dan Adobe Express. Bedanya bukan
 * selera: di roda layar lawan merah adalah cyan, di roda pelukis lawannya
 * hijau. Art director yang mencocokkan hasil di sini dengan hasil di Adobe
 * harus melihat pasangan yang sama.
 *
 * Posisi di roda disimpan sebagai sudut RYB; warna yang benar-benar tampil
 * dihitung dengan memetakan sudut itu ke rona RGB lalu memakai HSB biasa.
 */

export type Hsb = {
  /** Sudut di roda pelukis, 0–360. */
  h: number;
  /** Kepekatan, 0 di tengah roda sampai 1 di tepinya. */
  s: number;
  /** Kecerahan, 0 hitam sampai 1 penuh. */
  b: number;
};

/**
 * Pasangan [sudut RYB, rona RGB], naik ketat di kedua kolom supaya bisa
 * dibalik. Kuning ada di 120 pada roda pelukis tetapi 60 pada roda layar —
 * separuh pertama roda pelukis "diregangkan" untuk memberi ruang pada jingga,
 * yang di roda layar hanya sepotong sempit.
 */
const PETA_RYB: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [15, 8],
  [30, 17],
  [45, 26],
  [60, 34],
  [75, 41],
  [90, 48],
  [105, 54],
  [120, 60],
  [135, 81],
  [150, 103],
  [165, 123],
  [180, 138],
  [195, 155],
  [210, 171],
  [225, 187],
  [240, 204],
  [255, 219],
  [270, 234],
  [285, 251],
  [300, 267],
  [315, 282],
  [330, 298],
  [345, 329],
  [360, 360],
];

export function putarSudut(sudut: number): number {
  return ((sudut % 360) + 360) % 360;
}

function interpolasi(sudut: number, dari: 0 | 1): number {
  const ke = dari === 0 ? 1 : 0;
  const x = putarSudut(sudut);
  for (let i = 0; i < PETA_RYB.length - 1; i++) {
    const a = PETA_RYB[i];
    const b = PETA_RYB[i + 1];
    if (x >= a[dari] && x <= b[dari]) {
      const t = (x - a[dari]) / (b[dari] - a[dari]);
      return a[ke] + t * (b[ke] - a[ke]);
    }
  }
  return x;
}

/** Sudut roda pelukis → rona roda layar. */
export function rybKeRgb(sudut: number): number {
  return interpolasi(sudut, 0);
}

/** Rona roda layar → sudut roda pelukis. */
export function rgbKeRyb(rona: number): number {
  return interpolasi(rona, 1);
}

/** `ff8800`, `#FF8800`, `#f80` → `#ff8800`. Yang bukan warna → `null`. */
export function normalisasiHex(nilai: string): string | null {
  const bersih = nilai.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(bersih)) {
    return `#${bersih
      .split('')
      .map((c) => c + c)
      .join('')}`;
  }
  return /^[0-9a-f]{6}$/.test(bersih) ? `#${bersih}` : null;
}

export function hexKeRgb(hex: string): { r: number; g: number; b: number } {
  const bersih = normalisasiHex(hex);
  if (!bersih) throw new Error(`Bukan warna hex: ${hex}`);
  return {
    r: Number.parseInt(bersih.slice(1, 3), 16),
    g: Number.parseInt(bersih.slice(3, 5), 16),
    b: Number.parseInt(bersih.slice(5, 7), 16),
  };
}

function keDuaDigit(n: number): string {
  return Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');
}

/** HSB dengan rona RGB (bukan sudut roda) → komponen 0–255. */
export function hsvKeRgb(rona: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const hp = putarSudut(rona) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export function hsbKeHex(warna: Hsb): string {
  const { r, g, b } = hsvKeRgb(rybKeRgb(warna.h), warna.s, warna.b);
  return `#${keDuaDigit(r)}${keDuaDigit(g)}${keDuaDigit(b)}`;
}

/**
 * Hex → posisi di roda. Abu-abu tidak punya rona; ia diberi sudut 0 di sini,
 * dan pemanggil yang tahu rona sebelumnya sebaiknya mempertahankannya.
 */
export function hexKeHsb(hex: string): Hsb {
  const { r, g, b } = hexKeRgb(hex);
  const maks = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = maks - min;
  let rona = 0;
  if (d !== 0) {
    if (maks === r) rona = 60 * (((g - b) / d) % 6);
    else if (maks === g) rona = 60 * ((b - r) / d + 2);
    else rona = 60 * ((r - g) / d + 4);
  }
  return {
    h: d === 0 ? 0 : putarSudut(rgbKeRyb(putarSudut(rona))),
    s: maks === 0 ? 0 : d / maks,
    b: maks / 255,
  };
}

export function rgbKeHex(r: number, g: number, b: number): string {
  return `#${keDuaDigit(r)}${keDuaDigit(g)}${keDuaDigit(b)}`;
}

/**
 * CMYK dalam persen utuh, dengan rumus yang SAMA PERSIS seperti Pantone Studio:
 * aritmetika biasa, tanpa profil cetak.
 *
 * Artinya ini perkiraan. Illustrator dan Photoshop memakai profil ICC (mis.
 * FOGRA39 atau U.S. Web Coated), jadi angkanya bisa berbeda beberapa persen
 * untuk warna yang sama — dan layar menyebutnya perkiraan.
 */
export function rgbKeCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return [0, 0, 0, 100];
  return [
    Math.round(((1 - r / 255 - k) / (1 - k)) * 100),
    Math.round(((1 - g / 255 - k) / (1 - k)) * 100),
    Math.round(((1 - b / 255 - k) / (1 - k)) * 100),
    Math.round(k * 100),
  ];
}

/** Kebalikan `rgbKeCmyk`, masukan dalam persen 0–100. */
export function cmykKeRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  const tinta = (n: number) => Math.min(100, Math.max(0, n)) / 100;
  const sisaHitam = 1 - tinta(k);
  return {
    r: Math.round(255 * (1 - tinta(c)) * sisaHitam),
    g: Math.round(255 * (1 - tinta(m)) * sisaHitam),
    b: Math.round(255 * (1 - tinta(y)) * sisaHitam),
  };
}
