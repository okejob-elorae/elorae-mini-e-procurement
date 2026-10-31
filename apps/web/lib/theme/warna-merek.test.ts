import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToLab } from '@elorae/db/color';
import { tulisanDiAtas, warnaMerekDiGelap } from './warna-merek';

const terang = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  return rgbToLab(r, g, b).L;
};

/** Rasio kontras WCAG, untuk membuktikan hasilnya benar-benar terbaca. */
function kontras(a: string, b: string): number {
  const lum = (hex: string) => {
    const { r, g, b: bl } = hexToRgb(hex);
    const k = [r, g, bl].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TINTA = '#12120F';

describe('warnaMerekDiGelap', () => {
  it('membiarkan warna yang sudah terang apa adanya', () => {
    // Lime dan kuning tidak perlu diapa-apakan; menyentuhnya justru menggeser
    // warna yang sengaja dipilih pemiliknya.
    expect(warnaMerekDiGelap('#C8F04A')).toBe('#C8F04A');
    expect(warnaMerekDiGelap('#FFE135')).toBe('#FFE135');
  });

  it('MENAIKKAN terang warna gelap sampai terbaca di panel tinta', () => {
    /*
     * `#334155` adalah tema bawaan. Sebagai tombol ia baik; sebagai wordmark
     * besar di atas hitam ia praktis tak terlihat — kontrasnya di bawah 2:1.
     */
    expect(kontras('#334155', TINTA)).toBeLessThan(2);
    const naik = warnaMerekDiGelap('#334155');
    expect(kontras(naik, TINTA)).toBeGreaterThan(7);
  });

  it('MEMPERTAHANKAN ronanya — warnanya harus tetap terasa warna yang dipilih', () => {
    // Menaikkan terang dengan mencampur putih akan memucatkan sekaligus
    // menggeser rona; yang keluar bukan lagi warna mereka.
    const merah = warnaMerekDiGelap('#7A1F1F');
    const { r, g, b } = hexToRgb(merah);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);

    const biru = warnaMerekDiGelap('#1F2E7A');
    const c = hexToRgb(biru);
    expect(c.b).toBeGreaterThan(c.r);
  });

  it('menghasilkan warna terbaca untuk seluruh rona gelap, bukan hanya yang diuji', () => {
    // Satu warna contoh membuktikan sedikit; yang harus benar adalah SETIAP
    // pilihan tema yang mungkin.
    for (let h = 0; h < 360; h += 15) {
      const hex = hslKeHex(h, 65, 22);
      expect(kontras(warnaMerekDiGelap(hex), TINTA)).toBeGreaterThan(6);
    }
  });

  it('menangani abu-abu tanpa rona tanpa menghasilkan warna aneh', () => {
    const abu = warnaMerekDiGelap('#2B2B2B');
    const { r, g, b } = hexToRgb(abu);
    // Tetap netral: tidak boleh tiba-tiba jadi kehijauan.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
    expect(terang(abu)).toBeGreaterThan(70);
  });

  it('memanjangkan hex pendek', () => {
    // Huruf besar-kecilnya tidak diubah — yang penting bentuknya terbaca.
    expect(warnaMerekDiGelap('#cf4').toLowerCase()).toBe('#ccff44');
  });

  it('MENGEMBALIKAN nilai tak terbaca apa adanya, tidak melempar', () => {
    /*
     * Nilainya datang dari localStorage pengguna dan bisa berbentuk apa saja.
     * Halaman masuk yang gagal dirender karena setelan warna yang aneh
     * mengunci orang di luar aplikasinya sendiri.
     */
    expect(warnaMerekDiGelap('oklch(0.7 0.2 140)')).toBe('oklch(0.7 0.2 140)');
    expect(warnaMerekDiGelap('')).toBe('');
    expect(warnaMerekDiGelap('bukan-warna')).toBe('bukan-warna');
  });
});

describe('tulisanDiAtas', () => {
  it('memilih tulisan gelap di atas warna terang', () => {
    expect(tulisanDiAtas('#C8F04A', 'gelap', 'terang')).toBe('gelap');
    expect(tulisanDiAtas('#FFE135', 'gelap', 'terang')).toBe('gelap');
  });

  it('memilih tulisan terang di atas warna gelap', () => {
    expect(tulisanDiAtas('#334155', 'gelap', 'terang')).toBe('terang');
    expect(tulisanDiAtas('#7A1F1F', 'gelap', 'terang')).toBe('terang');
  });

  it('jatuh ke tulisan gelap kalau warnanya tak terbaca', () => {
    expect(tulisanDiAtas('bukan-warna', 'gelap', 'terang')).toBe('gelap');
  });
});

function hslKeHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
