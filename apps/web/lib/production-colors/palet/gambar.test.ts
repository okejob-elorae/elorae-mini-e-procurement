import { describe, expect, it } from 'vitest';
import { deltaE2000, hexKeLab } from './pantone';
import { ambilWarnaTitik, porsiDariBagian, warnaDominan } from './gambar';
import { hexKeRgb } from './warna';

/** Gambar sintetis: daftar [hex, banyaknya piksel], disusun berurutan dalam satu baris panjang. */
function gambar(isi: [string, number][], alfa = 255): { piksel: Uint8ClampedArray; lebar: number; tinggi: number } {
  const total = isi.reduce((s, [, n]) => s + n, 0);
  const piksel = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [hex, n] of isi) {
    const { r, g, b } = hexKeRgb(hex);
    for (let k = 0; k < n; k++) {
      piksel[i++] = r;
      piksel[i++] = g;
      piksel[i++] = b;
      piksel[i++] = alfa;
    }
  }
  return { piksel, lebar: total, tinggi: 1 };
}

const jarak = (a: string, b: string) => deltaE2000(hexKeLab(a), hexKeLab(b));

describe('warnaDominan', () => {
  it('menemukan warna-warna gambar beserta porsinya', () => {
    const { piksel } = gambar([
      ['#154036', 6000],
      ['#f1e9e7', 3000],
      ['#e8553d', 1000],
    ]);
    const hasil = warnaDominan(piksel, { jumlah: 3 });
    expect(hasil).toHaveLength(3);
    expect(jarak(hasil[0].hex, '#154036')).toBeLessThan(1);
    expect(jarak(hasil[1].hex, '#f1e9e7')).toBeLessThan(1);
    expect(jarak(hasil[2].hex, '#e8553d')).toBeLessThan(1);
    expect(hasil[0].bagian).toBeCloseTo(0.6, 2);
    expect(hasil[1].bagian).toBeCloseTo(0.3, 2);
    expect(hasil[2].bagian).toBeCloseTo(0.1, 2);
  });

  /*
   * Fitur lama "8 dominan" membulatkan setiap kanal ke kelipatan 32, jadi hex
   * yang keluar BUKAN warna di gambar: #154036 menjadi #204040. Warna di sini
   * adalah rata-rata piksel anggotanya, jadi warna rata tetap persis.
   */
  it('mengembalikan warna aslinya, bukan warna yang dibulatkan ke kisi', () => {
    const { piksel } = gambar([
      ['#154036', 5000],
      ['#ffd510', 5000],
    ]);
    const hex = warnaDominan(piksel, { jumlah: 2 }).map((w) => w.hex).sort();
    expect(hex).toEqual(['#154036', '#ffd510']);
  });

  it('tahan terhadap derau kompresi JPEG', () => {
    const isi: [string, number][] = [];
    // Biru dengan derau ±6 per kanal, dan merah dengan derau serupa.
    for (let i = 0; i < 400; i++) {
      const d = (i % 13) - 6;
      isi.push([`#${[0x2a + d, 0x78 - d, 0xd6 + (d % 3)].map((x) => x.toString(16).padStart(2, '0')).join('')}`, 10]);
      isi.push([`#${[0xcd - d, 0x18 + (d % 4), 0x2f + d].map((x) => x.toString(16).padStart(2, '0')).join('')}`, 5]);
    }
    const hasil = warnaDominan(gambar(isi).piksel, { jumlah: 2 });
    expect(jarak(hasil[0].hex, '#2a78d6')).toBeLessThan(3);
    expect(jarak(hasil[1].hex, '#cd182f')).toBeLessThan(3);
    expect(hasil[0].bagian).toBeCloseTo(2 / 3, 1);
  });

  it('menggabungkan warna yang nyaris sama alih-alih memecahnya jadi dua', () => {
    const { piksel } = gambar([
      ['#154036', 5000],
      ['#164137', 5000],
      ['#ffffff', 5000],
    ]);
    const hasil = warnaDominan(piksel, { jumlah: 3 });
    expect(hasil).toHaveLength(2);
    expect(hasil[0].bagian + hasil[1].bagian).toBeCloseTo(1, 5);
  });

  it('mengabaikan piksel transparan', () => {
    const tampak = gambar([['#e8553d', 1000]]);
    const tembus = gambar([['#0000ff', 9000]], 0);
    const piksel = new Uint8ClampedArray([...tampak.piksel, ...tembus.piksel]);
    const hasil = warnaDominan(piksel, { jumlah: 2 });
    expect(hasil).toHaveLength(1);
    expect(hasil[0].hex).toBe('#e8553d');
  });

  it('memberi hasil yang sama untuk gambar yang sama', () => {
    const { piksel } = gambar([
      ['#154036', 3000],
      ['#f1e9e7', 2000],
      ['#e8553d', 1000],
      ['#2a78d6', 800],
    ]);
    expect(warnaDominan(piksel, { jumlah: 4 })).toEqual(warnaDominan(piksel, { jumlah: 4 }));
  });

  it('mengembalikan kosong untuk gambar tanpa piksel tampak', () => {
    expect(warnaDominan(new Uint8ClampedArray(0), { jumlah: 3 })).toEqual([]);
  });
});

describe('ambilWarnaTitik', () => {
  it('merata-ratakan jendela kecil di sekitar titik, supaya satu piksel derau tidak menentukan warna', () => {
    // 3×3: pusat merah menyala, sekelilingnya abu-abu.
    const piksel = new Uint8ClampedArray(9 * 4);
    for (let i = 0; i < 9; i++) {
      const [r, g, b] = i === 4 ? [255, 0, 0] : [128, 128, 128];
      piksel.set([r, g, b, 255], i * 4);
    }
    expect(ambilWarnaTitik(piksel, 3, 3, 1, 1, 0)).toBe('#ff0000');
    const rata = hexKeRgb(ambilWarnaTitik(piksel, 3, 3, 1, 1, 1));
    expect(rata.r).toBeGreaterThan(128);
    expect(rata.g).toBeLessThan(128);
  });

  it('tidak keluar dari tepi gambar', () => {
    const piksel = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255]);
    expect(ambilWarnaTitik(piksel, 2, 2, 0, 0, 3)).toBe('#0a141e');
    expect(ambilWarnaTitik(piksel, 2, 2, 1, 1, 3)).toBe('#0a141e');
  });
});

describe('porsiDariBagian', () => {
  it('mengubah bagian menjadi persen bulat yang berjumlah tepat 100', () => {
    for (const bagian of [[0.6, 0.3, 0.1], [1 / 3, 1 / 3, 1 / 3], [0.555, 0.445], [0.2, 0.2, 0.2, 0.2, 0.2], [5, 3, 2]]) {
      const porsi = porsiDariBagian(bagian);
      expect(porsi.reduce((s, x) => s + x, 0), JSON.stringify(bagian)).toBe(100);
      expect(porsi.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    }
    expect(porsiDariBagian([0.6, 0.3, 0.1])).toEqual([60, 30, 10]);
  });

  it('memberi setidaknya 1% untuk warna yang benar-benar ada', () => {
    const porsi = porsiDariBagian([0.995, 0.004, 0.001]);
    expect(porsi.every((x) => x >= 1)).toBe(true);
    expect(porsi.reduce((s, x) => s + x, 0)).toBe(100);
  });
});
