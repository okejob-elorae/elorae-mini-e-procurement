import { describe, expect, it } from 'vitest';
import { cmykKeRgb, hexKeHsb, hexKeRgb, hsbKeHex, normalisasiHex, rgbKeCmyk, rgbKeHex, rgbKeRyb, rybKeRgb } from './warna';

describe('roda RYB', () => {
  /*
   * Roda Adobe adalah roda pelukis, bukan roda layar. Di roda layar lawan
   * merah adalah cyan; di roda pelukis lawannya hijau. Kalau pemetaan ini
   * hilang, "komplementer" di layar kita tidak akan cocok dengan yang dilihat
   * art director di Adobe.
   */
  it('menaruh warna primer pelukis di tempatnya', () => {
    expect(rybKeRgb(0)).toBe(0); // merah
    expect(rybKeRgb(120)).toBe(60); // kuning
    expect(rybKeRgb(360) % 360).toBe(0);
  });

  it('membuat lawan merah jatuh di hijau, bukan cyan', () => {
    const lawan = rybKeRgb(180);
    expect(lawan).toBeGreaterThan(100);
    expect(lawan).toBeLessThan(160);
  });

  it('membuat lawan kuning jatuh di ungu, bukan biru', () => {
    const lawan = rybKeRgb(300);
    expect(lawan).toBeGreaterThan(255);
    expect(lawan).toBeLessThan(290);
  });

  it('bisa dibalik tanpa bergeser di seluruh lingkaran', () => {
    for (let h = 0; h < 360; h += 7) {
      expect(rgbKeRyb(rybKeRgb(h))).toBeCloseTo(h, 6);
    }
  });

  it('memutar sudut di luar 0–360 kembali ke lingkaran', () => {
    expect(rybKeRgb(-180)).toBeCloseTo(rybKeRgb(180), 6);
    expect(rybKeRgb(540)).toBeCloseTo(rybKeRgb(180), 6);
  });
});

describe('hex', () => {
  it('menerima tulisan yang biasa diketik orang', () => {
    expect(normalisasiHex('FF8800')).toBe('#ff8800');
    expect(normalisasiHex(' #ff8800 ')).toBe('#ff8800');
    expect(normalisasiHex('#f80')).toBe('#ff8800');
  });

  it('menolak yang bukan warna', () => {
    expect(normalisasiHex('merah')).toBeNull();
    expect(normalisasiHex('#12345')).toBeNull();
    expect(normalisasiHex('')).toBeNull();
  });

  it('kembali ke hex yang sama setelah lewat roda', () => {
    for (const hex of ['#ff0000', '#ffcc00', '#2a78d6', '#1baf7a', '#6b2d5c', '#ffffff', '#000000']) {
      expect(hsbKeHex(hexKeHsb(hex))).toBe(hex);
    }
  });

  it('memberi abu-abu kepekatan nol', () => {
    const abu = hexKeHsb('#808080');
    expect(abu.s).toBe(0);
  });
});

describe('RGB dan CMYK', () => {
  it('menyusun hex dari RGB, membatasi ke 0–255', () => {
    expect(rgbKeHex(192, 219, 58)).toBe('#c0db3a');
    expect(rgbKeHex(300, -5, 127.6)).toBe('#ff0080');
  });

  /*
   * Rumusnya SAMA PERSIS dengan Pantone Studio yang dipakai tim produksi:
   * aritmetika biasa tanpa profil cetak. Angka yang berbeda antara dua alat
   * untuk warna yang sama membuat orang meragukan keduanya.
   */
  it('menghitung CMYK seperti Pantone Studio', () => {
    expect(rgbKeCmyk(192, 219, 58)).toEqual([12, 0, 74, 14]);
    expect(rgbKeCmyk(255, 0, 0)).toEqual([0, 100, 100, 0]);
    expect(rgbKeCmyk(255, 255, 255)).toEqual([0, 0, 0, 0]);
    expect(rgbKeCmyk(0, 0, 0)).toEqual([0, 0, 0, 100]);
  });

  it('mengembalikan CMYK ke RGB', () => {
    expect(cmykKeRgb(0, 100, 100, 0)).toEqual({ r: 255, g: 0, b: 0 });
    expect(cmykKeRgb(0, 0, 0, 100)).toEqual({ r: 0, g: 0, b: 0 });
    expect(cmykKeRgb(0, 0, 0, 0)).toEqual({ r: 255, g: 255, b: 255 });
  });

  /*
   * CMYK dibulatkan ke persen utuh — 101 langkah per tinta, lebih kasar dari
   * 256 langkah RGB. Jalan pulang-pergi karena itu hanya DEKAT, dan layar
   * memberi tahu orang bahwa CMYK tidak bisa menyebut setiap warna persis.
   */
  it('kembali dekat, tidak selalu persis, lewat CMYK', () => {
    for (const hex of ['#c0db3a', '#2a78d6', '#6b2d5c', '#e8553d', '#123456']) {
      const { r, g, b } = hexKeRgb(hex);
      const balik = cmykKeRgb(...rgbKeCmyk(r, g, b));
      expect(Math.abs(balik.r - r)).toBeLessThanOrEqual(3);
      expect(Math.abs(balik.g - g)).toBeLessThanOrEqual(3);
      expect(Math.abs(balik.b - b)).toBeLessThanOrEqual(3);
    }
  });
});
