import { describe, expect, it } from 'vitest';
import { hexKeHsb, hsbKeHex, normalisasiHex, rgbKeRyb, rybKeRgb } from './warna';

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
