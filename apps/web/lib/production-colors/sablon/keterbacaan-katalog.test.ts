import { describe, expect, it } from 'vitest';
import dataC from '../palet/pantone-c.json';
import { KELUARGA_WARNA, keluargaWarna } from '../palet/katalog';
import { rasioKontras } from '../palet/kontras';
import { pantoneKhusus, siapkanKatalog } from '../palet/pantone';
import { hitungKeterbacaan, nilaiKatalogDiKain, saringKeterbacaan } from './keterbacaan-katalog';
import { keterbacaanSablon } from './saran';

const KATALOG = siapkanKatalog('C', dataC as [string, string][]);
const SAND = '#d6cbba';
const baris = nilaiKatalogDiKain(KATALOG, SAND);
const semua = { kueri: '', keluarga: null, baca: null, sembunyikanKhusus: false, urut: 'KODE' } as const;

describe('nilaiKatalogDiKain', () => {
  it('memberi setiap Pantone C rasio kontrasnya di kain dan label keterbacaan sablonnya', () => {
    expect(baris).toHaveLength(KATALOG.length);
    for (const b of baris.slice(0, 200)) {
      expect(b.rasio).toBeCloseTo(rasioKontras(b.warna.hex, SAND), 10);
      expect(b.baca).toBe(keterbacaanSablon(b.rasio));
      expect(b.keluarga).toBe(keluargaWarna(b.warna.hex));
      expect(b.khusus).toBe(pantoneKhusus(b.warna.kode));
    }
  });

  it('kontras dihitung terhadap kain yang dipilih: di kain hitam yang terkuat paling terang, di kain putih paling gelap', () => {
    const kontras = (kain: string) => saringKeterbacaan(nilaiKatalogDiKain(KATALOG, kain), { ...semua, urut: 'KONTRAS' });
    expect(kontras('#101010')[0].warna.lab[0]).toBeGreaterThan(90);
    expect(kontras('#f7f7f5')[0].warna.lab[0]).toBeLessThan(15);
  });
});

describe('saringKeterbacaan', () => {
  it('menyaring per keterbacaan; jumlah tiap keterbacaan menjumlah ke seluruh katalog', () => {
    const hitung = hitungKeterbacaan(baris);
    expect(hitung.KUAT + hitung.CUKUP + hitung.LEMBUT + hitung.SAMAR).toBe(KATALOG.length);
    const kuat = saringKeterbacaan(baris, { ...semua, baca: 'KUAT' });
    expect(kuat).toHaveLength(hitung.KUAT);
    expect(kuat.every((b) => b.rasio >= 4.5)).toBe(true);
    expect(saringKeterbacaan(baris, { ...semua, baca: 'SAMAR' }).every((b) => b.rasio < 1.8)).toBe(true);
  });

  it('urut kontras dari tertinggi; urut warna per keluarga; urut kode sesuai buku', () => {
    const kontras = saringKeterbacaan(baris, { ...semua, urut: 'KONTRAS' });
    for (let i = 1; i < kontras.length; i++) expect(kontras[i - 1].rasio).toBeGreaterThanOrEqual(kontras[i].rasio);
    const warna = saringKeterbacaan(baris, { ...semua, urut: 'WARNA' }).map((b) => KELUARGA_WARNA.indexOf(b.keluarga));
    for (let i = 1; i < warna.length; i++) expect(warna[i - 1]).toBeLessThanOrEqual(warna[i]);
    expect(saringKeterbacaan(baris, semua).map((b) => b.warna.kode)).toEqual(KATALOG.map((w) => w.kode));
  });

  it('keluarga, pencarian kode, dan menyembunyikan metalik & neon', () => {
    expect(saringKeterbacaan(baris, { ...semua, keluarga: 'BIRU' }).every((b) => b.keluarga === 'BIRU')).toBe(true);
    expect(saringKeterbacaan(baris, { ...semua, kueri: '541' })[0].warna.kode).toBe('541 C');
    const tanpaKhusus = saringKeterbacaan(baris, { ...semua, sembunyikanKhusus: true });
    expect(tanpaKhusus.some((b) => b.khusus !== null)).toBe(false);
    expect(tanpaKhusus.length).toBeLessThan(KATALOG.length);
  });
});
