import { hexToRgb, labChroma, labHueRadians, labToHex, rgbToLab } from '@elorae/db/color';

/**
 * Warna merek untuk panel gelap halaman masuk.
 *
 * Halaman masuk mengikuti warna tema — kalau pemiliknya memilih kuning, pintu
 * depannya ikut kuning. Tapi warna tema bebas, dan sebagian besar warna yang
 * masuk akal untuk tombol TIDAK terbaca sebagai tulisan besar di atas panel
 * hampir hitam. Tema bawaan `#334155` adalah contohnya: sebagai tombol ia baik,
 * sebagai wordmark di atas hitam ia praktis tak terlihat.
 *
 * Maka: rona dan kepekatannya DIPERTAHANKAN — itu yang membuat warnanya masih
 * terasa warna yang mereka pilih — sementara terangnya dinaikkan sampai cukup.
 * Yang sudah terang (lime, kuning) dibiarkan apa adanya.
 *
 * Memakai Lab, bukan HSL, karena ini perkakas yang sudah dipakai generator
 * palet tema di sebelahnya — dan karena terang di HSL tidak sepadan dengan
 * terang yang dilihat mata: kuning dan biru pada `L` HSL yang sama berbeda jauh
 * keterbacaannya.
 */

/**
 * Terang minimum di atas panel tinta.
 *
 * 78 kira-kira setara rasio kontras 8:1 terhadap `#12120F` — jauh di atas 4.5:1
 * yang dituntut teks besar, dengan sengaja: ini wordmark, bukan paragraf, dan
 * yang setengah terbaca terlihat seperti kesalahan cetak.
 */
const TERANG_MINIMUM = 78;

export function warnaMerekDiGelap(seedHex: string): string {
  const rgb = amanHexToRgb(seedHex);
  if (!rgb) return seedHex;

  const { L, a, b } = rgbToLab(rgb.r, rgb.g, rgb.b);
  if (L >= TERANG_MINIMUM) return normalHex(seedHex);

  /*
   * Kepekatan sedikit diturunkan saat dinaikkan terangnya. Warna pekat yang
   * dipaksa terang keluar dari gamut layar dan dipotong seenaknya — hasilnya
   * rona bergeser, dan merah tua bisa mendarat jadi merah muda.
   */
  const c = labChroma(a, b);
  const hue = c < 2 ? 0 : labHueRadians(a, b);
  const cBaru = Math.min(c, 42);

  return labToHex(TERANG_MINIMUM, cBaru * Math.cos(hue), cBaru * Math.sin(hue));
}

/**
 * Warna tulisan yang terbaca DI ATAS sebuah warna.
 *
 * Dipakai untuk tombol: tema kuning menuntut tulisan gelap, tema biru tua
 * menuntut tulisan terang. Ambangnya di Lab, sejalan dengan yang di atas.
 */
export function tulisanDiAtas(latarHex: string, gelap: string, terang: string): string {
  const rgb = amanHexToRgb(latarHex);
  if (!rgb) return gelap;
  const { L } = rgbToLab(rgb.r, rgb.g, rgb.b);
  return L >= 60 ? gelap : terang;
}

/**
 * Baca hex apa adanya, kembalikan null kalau bukan hex.
 *
 * Nilai `--primary` datang dari localStorage pengguna dan tidak dijamin
 * bentuknya — ia bisa `oklch(...)`, bisa nama warna, bisa sisa setelan lama.
 * Yang tidak terbaca dikembalikan apa adanya oleh pemanggil, bukan dilempar:
 * halaman masuk yang gagal dirender karena warna tersimpan yang aneh mengunci
 * orang di luar aplikasinya sendiri.
 */
function amanHexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const bersih = normalHex(hex);
  if (!/^#[0-9a-fA-F]{6}$/.test(bersih)) return null;
  try {
    return hexToRgb(bersih);
  } catch {
    return null;
  }
}

function normalHex(hex: string): string {
  const s = hex.trim();
  // Bentuk pendek `#abc` dipanjangkan; `hexToRgb` hanya menerima enam digit.
  const m = /^#([0-9a-fA-F]{3})$/.exec(s);
  return m ? `#${[...m[1]].map((c) => c + c).join('')}` : s;
}
