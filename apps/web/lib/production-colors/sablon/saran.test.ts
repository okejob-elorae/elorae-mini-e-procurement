import { describe, expect, it } from 'vitest';
import dataC from '../palet/pantone-c.json';
import { hexKeLab, pantoneKhusus, siapkanKatalog } from '../palet/pantone';
import { rasioKontras } from '../palet/kontras';
import { hexKeHsb } from '../palet/warna';
import { ATURAN_SABLON, PORSI_AWAL, keterbacaanSablon, sarankanSablon } from './saran';

const KATALOG = siapkanKatalog('C', dataC as [string, string][]);

const KAIN = {
  blueSurf: '#90a8a4',
  navy: '#1f2a44',
  putih: '#f4f5f0',
  merah: '#c8102e',
  hitam: '#1b1b1b',
};

const L = (hex: string) => hexKeLab(hex)[0];
const selisihSudut = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};

describe('PORSI_AWAL', () => {
  it('berjumlah 100 dan menurun untuk setiap jumlah warna', () => {
    for (let n = 1; n <= 6; n++) {
      const p = PORSI_AWAL[n];
      expect(p, String(n)).toHaveLength(n);
      expect(p.reduce((s, x) => s + x, 0), String(n)).toBe(100);
      expect(p, String(n)).toEqual([...p].sort((a, b) => b - a));
    }
  });
});

describe('sarankanSablon', () => {
  it('memberi sejumlah warna yang diminta, semuanya berbeda', () => {
    for (const kain of Object.values(KAIN)) {
      for (const aturan of ATURAN_SABLON) {
        for (const jumlah of [1, 3, 6]) {
          const s = sarankanSablon({ kainHex: kain, jumlah, aturan, katalog: KATALOG });
          expect(s, `${kain} ${aturan} ${jumlah}`).toHaveLength(jumlah);
          expect(new Set(s.map((x) => x.warna.kode)).size, `${kain} ${aturan} ${jumlah}`).toBe(jumlah);
        }
      }
    }
  });

  /*
   * Tinta yang terangnya hampir sama dengan kain tidak terlihat sebagai
   * sablon, seserasi apa pun rona-nya. Keterbacaan di atas kain adalah syarat,
   * bukan pertimbangan.
   */
  it('tidak pernah menyarankan tinta yang terangnya nyaris sama dengan kain', () => {
    for (const kain of Object.values(KAIN)) {
      for (const aturan of ATURAN_SABLON) {
        for (const x of sarankanSablon({ kainHex: kain, jumlah: 4, aturan, katalog: KATALOG })) {
          expect(Math.abs(L(x.warna.hex) - L(kain)), `${kain} ${aturan} ${x.warna.kode}`).toBeGreaterThanOrEqual(18);
        }
      }
    }
  });

  it('hanya menyarankan tinta lebih gelap di kain putih, dan lebih terang di kain hitam', () => {
    for (const aturan of ATURAN_SABLON) {
      for (const x of sarankanSablon({ kainHex: KAIN.putih, jumlah: 4, aturan, katalog: KATALOG })) {
        expect(L(x.warna.hex), `${aturan} ${x.warna.kode}`).toBeLessThan(L(KAIN.putih));
      }
      for (const x of sarankanSablon({ kainHex: KAIN.hitam, jumlah: 4, aturan, katalog: KATALOG })) {
        expect(L(x.warna.hex), `${aturan} ${x.warna.kode}`).toBeGreaterThan(L(KAIN.hitam));
      }
    }
  });

  it('memakai dua arah di kain bernada tengah, supaya ada tinta terang dan gelap', () => {
    const s = sarankanSablon({ kainHex: KAIN.blueSurf, jumlah: 3, aturan: 'COMPLEMENTARY', katalog: KATALOG });
    expect(s.some((x) => L(x.warna.hex) > L(KAIN.blueSurf))).toBe(true);
    expect(s.some((x) => L(x.warna.hex) < L(KAIN.blueSurf))).toBe(true);
  });

  it('menjadikan tinta yang paling kontras sebagai dominan, dengan porsi terbesar', () => {
    for (const kain of Object.values(KAIN)) {
      const s = sarankanSablon({ kainHex: kain, jumlah: 3, aturan: 'TRIAD', katalog: KATALOG });
      const kontras = s.map((x) => rasioKontras(x.warna.hex, kain));
      expect(kontras[0], kain).toBe(Math.max(...kontras));
      expect(s.map((x) => x.porsi)).toEqual(PORSI_AWAL[3]);
      expect(s.map((x) => x.peran)).toEqual(['DOMINAN', 'PENDUKUNG', 'AKSEN']);
    }
  });

  it('menyertakan lawan warna kain untuk complementary', () => {
    const kain = hexKeHsb(KAIN.merah);
    const s = sarankanSablon({ kainHex: KAIN.merah, jumlah: 3, aturan: 'COMPLEMENTARY', katalog: KATALOG });
    const lawan = s.filter((x) => {
      const w = hexKeHsb(x.warna.hex);
      return w.s > 0.2 && selisihSudut(w.h, kain.h + 180) <= 45;
    });
    expect(lawan.length).toBeGreaterThan(0);
  });

  it('menjaga monokromatik di sekitar rona kain', () => {
    const kain = hexKeHsb(KAIN.navy);
    for (const x of sarankanSablon({ kainHex: KAIN.navy, jumlah: 4, aturan: 'MONOCHROMATIC', katalog: KATALOG })) {
      const w = hexKeHsb(x.warna.hex);
      if (w.s < 0.15) continue;
      expect(selisihSudut(w.h, kain.h), x.warna.kode).toBeLessThanOrEqual(40);
    }
  });

  /*
   * Kain hitam, putih, dan abu tidak punya rona — HSB melaporkannya sebagai 0°,
   * yaitu MERAH. Dulu "monochromatic" di kain hitam jadi pink kusam (2446 C,
   * 8442 C, 7616 C) karena rona palsu itu. Kain netral kini memakai rona aksen
   * pertama galeri (lime 375 C).
   */
  it('kain netral tidak dianggap merah: rona dasarnya aksen lime', () => {
    const lime = hexKeHsb('#a0d513').h;
    const hasil = sarankanSablon({ kainHex: KAIN.hitam, jumlah: 3, aturan: 'MONOCHROMATIC', katalog: KATALOG });
    for (const s of hasil) {
      const w = hexKeHsb(s.warna.hex);
      if (w.s > 0.15) expect(selisihSudut(w.h, lime), s.warna.kode).toBeLessThan(40);
    }
  });

  it('memberi hasil yang sama untuk masukan yang sama', () => {
    const a = sarankanSablon({ kainHex: KAIN.blueSurf, jumlah: 5, aturan: 'ANALOGOUS', katalog: KATALOG });
    const b = sarankanSablon({ kainHex: KAIN.blueSurf, jumlah: 5, aturan: 'ANALOGOUS', katalog: KATALOG });
    expect(a.map((x) => x.warna.kode)).toEqual(b.map((x) => x.warna.kode));
  });

  it('membatasi jumlah ke 1–6', () => {
    expect(sarankanSablon({ kainHex: KAIN.navy, jumlah: 0, aturan: 'TRIAD', katalog: KATALOG })).toHaveLength(1);
    expect(sarankanSablon({ kainHex: KAIN.navy, jumlah: 9, aturan: 'TRIAD', katalog: KATALOG })).toHaveLength(6);
  });
});

describe('sarankanSablon — tinta khusus', () => {
  it('saran aturan harmoni tidak pernah memakai tinta metalik atau neon', () => {
    for (const kainHex of ['#d6cbba', '#101010', '#f7f7f5', '#90a8a4', '#5b3a29']) {
      for (const aturan of ATURAN_SABLON) {
        for (const s of sarankanSablon({ kainHex, jumlah: 6, aturan, katalog: KATALOG })) expect(pantoneKhusus(s.warna.kode), `${kainHex} ${aturan} ${s.warna.kode}`).toBeNull();
      }
    }
  });
});

describe('keterbacaanSablon', () => {
  it('membagi rasio kontras ke empat tingkat', () => {
    expect(keterbacaanSablon(6)).toBe('KUAT');
    expect(keterbacaanSablon(4.5)).toBe('KUAT');
    expect(keterbacaanSablon(3.2)).toBe('CUKUP');
    expect(keterbacaanSablon(1.9)).toBe('LEMBUT');
    expect(keterbacaanSablon(1.2)).toBe('SAMAR');
  });
});
