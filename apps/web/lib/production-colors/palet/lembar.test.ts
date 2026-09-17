import { describe, expect, it } from 'vitest';
import dataC from './pantone-c.json';
import { siapkanKatalog } from './pantone';
import { susunLembarPalet } from './lembar';
import { presetTintaPantone } from '../sablon/tinta-dasar';

const KATALOG_C = siapkanKatalog('C', dataC as [string, string][]);
const KATALOG_TCX = siapkanKatalog('TCX', [
  ['16-5106', '#90a8a4', 'Blue Surf'],
  ['11-0601', '#f4f5f0', 'Bright White'],
]);

const dasar = {
  katalogC: KATALOG_C,
  katalogTcx: KATALOG_TCX,
  tintaDasar: presetTintaPantone(),
  maksTinta: 3,
  berat: 1000,
};

describe('susunLembarPalet — palet sablon di atas kain', () => {
  const lembar = susunLembarPalet({
    ...dasar,
    nama: '  Feed Agustus  ',
    aturan: 'TRIAD',
    warna: ['#00323d', '#ff5303', '#ffffff'],
    kain: '#90a8a4',
    porsi: [60, 30, 10],
  });

  it('menamai kain dengan kode TCX yang persis sama, bukan hanya hex-nya', () => {
    expect(lembar.nama).toBe('Feed Agustus');
    expect(lembar.kain).toEqual({ hex: '#90A8A4', nama: 'PANTONE 16-5106 TCX Blue Surf' });
  });

  it('memberi tiap tinta huruf, kode lengkap, peran, dan porsinya', () => {
    expect(lembar.baris.map((b) => b.label)).toEqual(['A', 'B', 'C']);
    const [a, b] = lembar.baris;
    expect(a.hex).toBe('#00323D');
    expect(a.rgb).toEqual([0, 50, 61]);
    expect(a.cmyk).toEqual([100, 18, 0, 76]);
    expect(a.pantoneC?.kode).toBe('547 C');
    expect(a.pantoneC?.deltaE).toBeLessThan(0.05);
    expect(b.pantoneC?.kode).toBe('Orange 021 C');
    expect(b.pantoneC?.deltaE).toBeLessThan(0.05);
    expect(lembar.baris.map((x) => x.porsi)).toEqual([60, 30, 10]);
    expect(lembar.baris.map((x) => x.peran)).toEqual(['DOMINAN', 'PENDUKUNG', 'AKSEN']);
    expect(a.kontras).toBeGreaterThan(4.5);
    expect(a.keterbacaan).toBe('KUAT');
  });

  it('menyertakan resep campur yang gramnya berjumlah tepat seberat adonan', () => {
    for (const b of lembar.baris) {
      expect(b.resep).not.toBeNull();
      const resep = b.resep!;
      expect(resep.bagian.length).toBeGreaterThan(0);
      expect(resep.bagian.length).toBeLessThanOrEqual(3);
      expect(resep.bagian.reduce((s, x) => s + x.gram, 0)).toBe(1000);
      expect(resep.bagian.every((x) => x.nama.length > 0)).toBe(true);
    }
    expect(lembar.berat).toBe(1000);
    expect(lembar.maksTinta).toBe(3);
  });

  it('tanpa tinta dasar, lembar tetap jadi tanpa resep', () => {
    const tanpa = susunLembarPalet({ ...dasar, tintaDasar: [], nama: 'X', aturan: 'TRIAD', warna: ['#00323d'], kain: '#90a8a4', porsi: [100] });
    expect(tanpa.baris[0].resep).toBeNull();
  });

  it('kain yang bukan warna TCX persis tetap ditulis sebagai hex', () => {
    const lain = susunLembarPalet({ ...dasar, nama: 'X', aturan: 'TRIAD', warna: ['#00323d'], kain: '#123456', porsi: [100] });
    expect(lain.kain).toEqual({ hex: '#123456', nama: null });
  });
});

describe('susunLembarPalet — palet bebas', () => {
  const lembar = susunLembarPalet({
    ...dasar,
    nama: '',
    aturan: 'ANALOGOUS',
    warna: ['#e8553d', '#e8a33d', '#d9e83d', '#8be83d', '#3de85a'],
    kain: null,
    porsi: null,
  });

  it('memberi nomor 1–5 dan menandai warna dasar di tengah', () => {
    expect(lembar.kain).toBeNull();
    expect(lembar.baris.map((b) => b.label)).toEqual(['1', '2', '3', '4', '5']);
    expect(lembar.baris.map((b) => b.dasar)).toEqual([false, false, true, false, false]);
  });

  it('tidak mengarang porsi, keterbacaan di kain, atau resep sablon', () => {
    for (const b of lembar.baris) {
      expect(b.porsi).toBeNull();
      expect(b.peran).toBeNull();
      expect(b.kontras).toBeNull();
      expect(b.resep).toBeNull();
    }
    expect(lembar.berat).toBeNull();
  });

  it('mencari TCX terdekat walau tidak persis', () => {
    expect(lembar.baris[0].pantoneTcx).not.toBeNull();
    expect(lembar.baris[0].pantoneTcx!.deltaE).toBeGreaterThan(0);
  });
});
