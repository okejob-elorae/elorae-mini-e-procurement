import { describe, expect, it } from 'vitest';
import tcxSeed from '../../../../../packages/db/prisma/pantone-colors.seed.json';
import dataC from './pantone-c.json';
import { KELUARGA_WARNA, hitungKeluarga, jelajahiKatalog, keluargaWarna, variasiTerdekat } from './katalog';
import { deltaE2000, hexKeLab, siapkanKatalog } from './pantone';

const TCX = siapkanKatalog(
  'TCX',
  (tcxSeed as { tcx: string; hex: string; name: string }[]).map((t) => [t.tcx, t.hex, t.name] as const),
);
const C = siapkanKatalog('C', dataC as [string, string][]);

describe('keluargaWarna', () => {
  it.each([
    ['#c8102e', 'MERAH'],
    ['#ff8200', 'ORANYE'],
    ['#ffd100', 'KUNING'],
    ['#2e7d32', 'HIJAU'],
    ['#0f4c81', 'BIRU'],
    ['#6a1b9a', 'UNGU'],
    ['#e91e63', 'PINK'],
    ['#6d4c41', 'COKELAT'],
    ['#808080', 'NETRAL'],
    ['#f4f5f0', 'NETRAL'],
    ['#1b1b1b', 'NETRAL'],
  ] as const)('%s → %s', (hex, keluarga) => {
    expect(keluargaWarna(hex)).toBe(keluarga);
  });

  it('memberi setiap warna katalog satu keluarga, dan tidak ada keluarga yang kosong', () => {
    for (const katalog of [TCX, C]) {
      const hitung = hitungKeluarga(katalog);
      expect(Object.values(hitung).reduce((s, n) => s + n, 0)).toBe(katalog.length);
      for (const k of KELUARGA_WARNA) expect(hitung[k], `${katalog[0].jenis} ${k}`).toBeGreaterThan(0);
    }
  });
});

describe('jelajahiKatalog', () => {
  /*
   * Keluhan yang melahirkan fungsi ini: pencarian lama berhenti di enam hasil
   * dan tidak menampilkan apa pun tanpa diketik — seluruh 2.800 kain terasa
   * terkunci di balik kotak pencarian.
   */
  it('menampilkan seluruh katalog tanpa kueri, tanpa batas', () => {
    expect(jelajahiKatalog(TCX, { kueri: '', keluarga: null })).toHaveLength(TCX.length);
    expect(jelajahiKatalog(C, { kueri: '', keluarga: null })).toHaveLength(C.length);
  });

  it('tidak memotong hasil pencarian di enam', () => {
    const hasil = jelajahiKatalog(TCX, { kueri: 'blue', keluarga: null });
    expect(hasil.length).toBeGreaterThan(6);
    for (const w of hasil) expect(`${w.kode} ${w.nama}`.toLowerCase()).toContain('blue');
  });

  it('menyaring per keluarga, dari terang ke gelap', () => {
    const biru = jelajahiKatalog(TCX, { kueri: '', keluarga: 'BIRU' });
    expect(biru).toHaveLength(hitungKeluarga(TCX).BIRU);
    expect(biru.every((w) => keluargaWarna(w.hex) === 'BIRU')).toBe(true);
    for (let i = 1; i < biru.length; i++) expect(biru[i].lab[0]).toBeLessThanOrEqual(biru[i - 1].lab[0]);
  });

  it('menggabungkan kueri dan keluarga, dengan urutan pencarian dipertahankan', () => {
    const hasil = jelajahiKatalog(TCX, { kueri: 'blue', keluarga: 'NETRAL' });
    expect(hasil.every((w) => keluargaWarna(w.hex) === 'NETRAL')).toBe(true);
    expect(hasil.length).toBeLessThan(jelajahiKatalog(TCX, { kueri: 'blue', keluarga: null }).length);
  });

  it('mengelompokkan "semua" per keluarga supaya terbaca seperti buku swatch', () => {
    const semua = jelajahiKatalog(C, { kueri: '', keluarga: null });
    const urutan = semua.map((w) => KELUARGA_WARNA.indexOf(keluargaWarna(w.hex)));
    for (let i = 1; i < urutan.length; i++) expect(urutan[i]).toBeGreaterThanOrEqual(urutan[i - 1]);
  });
});

describe('variasiTerdekat', () => {
  it('memberi sejumlah variasi terdekat, urut dari yang paling mirip, termasuk warna itu sendiri kalau ada', () => {
    const hasil = variasiTerdekat(TCX, '#90a8a4', 12);
    expect(hasil).toHaveLength(12);
    expect(hasil[0].warna.kode).toBe('16-5106');
    expect(hasil[0].deltaE).toBe(0);
    for (let i = 1; i < hasil.length; i++) expect(hasil[i].deltaE).toBeGreaterThanOrEqual(hasil[i - 1].deltaE);
  });

  it('benar-benar yang terdekat, bukan sekadar urutan katalog', () => {
    const lab = hexKeLab('#90a8a4');
    const penuh = TCX.map((w) => deltaE2000(lab, w.lab)).sort((a, b) => a - b).slice(0, 12);
    expect(variasiTerdekat(TCX, '#90a8a4', 12).map((x) => x.deltaE)).toEqual(penuh);
  });
});
