import { describe, expect, it } from 'vitest';
import dataC from '../palet/pantone-c.json';
import { deltaE2000, hexKeLab, pantoneKhusus, siapkanKatalog } from '../palet/pantone';
import { hexKeHsb } from '../palet/warna';
import { calonPerAturan, saranBerikutnya, saranPengganti } from './pengganti';

const KATALOG = siapkanKatalog('C', dataC as [string, string][]);
const SAND = '#d6cbba';
const TINTA = ['#32281f', '#645e50', '#a8a393'];
const L = (hex: string) => hexKeLab(hex)[0];

describe('saranPengganti', () => {
  const calon = calonPerAturan(SAND, KATALOG);

  it('mengusulkan pengganti tinta C menurut aturan harmoni terhadap kain, bergiliran antaraturan', () => {
    const s = saranPengganti({ calon, kainHex: SAND, hex: TINTA, indeks: 2, aturanUtama: 'TRIAD' });
    expect(s.length).toBeGreaterThanOrEqual(8);
    expect(s[0].aturan).toBe('TRIAD');
    const jumlahAturan = new Set(s.map((x) => x.aturan)).size;
    const putaranPertama = s.slice(0, jumlahAturan).map((x) => x.aturan);
    expect(new Set(putaranPertama).size).toBe(jumlahAturan);
    expect(new Set(s.map((x) => x.kode)).size).toBe(s.length);
    for (const x of s) {
      expect(calon[x.aturan].map((c) => c.warna.hex)).toContain(x.hex);
      expect(pantoneKhusus(x.kode)).toBeNull();
      expect(Math.abs(L(x.hex) - L(SAND))).toBeGreaterThanOrEqual(20);
      for (const h of TINTA.slice(0, 2)) expect(deltaE2000(hexKeLab(h), hexKeLab(x.hex)), x.kode).toBeGreaterThanOrEqual(10);
    }
  });

  it('tidak bergantung pada warna tinta yang sedang diganti, jadi "Warna lain" bisa terus berputar', () => {
    const a = saranPengganti({ calon, kainHex: SAND, hex: TINTA, indeks: 2, aturanUtama: 'ANALOGOUS' });
    const b = saranPengganti({ calon, kainHex: SAND, hex: [TINTA[0], TINTA[1], '#ff0000'], indeks: 2, aturanUtama: 'ANALOGOUS' });
    expect(b).toEqual(a);
  });

  it('saran pertama tiap aturan memakai rona khas aturan itu, bukan rona kain sendiri', () => {
    // Palet nyata dari desain krem: A abu hangat terang, B hampir hitam.
    const KAIN = '#d4c8b7';
    const ronaKain = hexKeHsb(KAIN).h;
    const jarak = (hex: string) => {
      const d = Math.abs(hexKeHsb(hex).h - ronaKain) % 360;
      return Math.min(d, 360 - d);
    };
    const s = saranPengganti({ calon: calonPerAturan(KAIN, KATALOG), kainHex: KAIN, hex: ['#b5a99d', '#1f2221', '#efeae5'], indeks: 2, aturanUtama: 'COMPLEMENTARY' });
    for (const aturan of ['COMPLEMENTARY', 'TRIAD', 'SPLIT_COMPLEMENTARY', 'SQUARE'] as const) {
      const pertama = s.find((x) => x.aturan === aturan)!;
      expect(jarak(pertama.hex), `${aturan} ${pertama.kode}`).toBeGreaterThanOrEqual(60);
    }
  });

  it('aturan Custom tidak didahulukan — urutannya urutan aturan biasa', () => {
    const s = saranPengganti({ calon, kainHex: SAND, hex: TINTA, indeks: 2, aturanUtama: 'CUSTOM' });
    expect(s[0].aturan).toBe('ANALOGOUS');
  });
});

describe('saranBerikutnya', () => {
  const d = [{ hex: '#111111' }, { hex: '#223344' }, { hex: '#ccbbaa' }];

  it('maju satu, berputar ke awal, dan mulai dari saran pertama kalau warna sekarang bukan saran', () => {
    expect(saranBerikutnya(d, '#999999')).toBe(d[0]);
    expect(saranBerikutnya(d, '#111111')).toBe(d[1]);
    expect(saranBerikutnya(d, '#CCBBAA')).toBe(d[0]);
    // Selisih pembulatan satu digit masih dianggap warna yang sama.
    expect(saranBerikutnya(d, '#223345')).toBe(d[2]);
    expect(saranBerikutnya([], '#111111')).toBeNull();
  });
});
