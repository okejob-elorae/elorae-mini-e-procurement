import { describe, expect, it } from 'vitest';
import { rapikanNama } from './nama-warna';
import { daftarKategori, hitungWarnaLaris, type BarisPenjualanWarna } from './warna-laris';

const baris: BarisPenjualanWarna[] = [
  { nama: 'Hitam', kategori: 'Kaos', kini: 120, lalu: 100 },
  { nama: 'BLACK', kategori: 'Kaos', kini: 30, lalu: 20 },
  { nama: 'Army', kategori: 'Kaos', kini: 60, lalu: 20 },
  { nama: 'Mocca', kategori: 'Hoodie', kini: 40, lalu: 50 },
  { nama: 'Galaxy', kategori: 'Kaos', kini: 25, lalu: 0 },
  { nama: 'Putih', kategori: 'Hoodie', kini: 0, lalu: 15 },
  { nama: null, kategori: 'Kaos', kini: 99, lalu: 99 },
];

describe('hitungWarnaLaris', () => {
  const hasil = hitungWarnaLaris(baris);

  it('menggabungkan nama berbeda untuk warna yang sama dan mengurutkan dari yang terlaris', () => {
    expect(hasil.laris.map((w) => w.kunci)).toEqual(['hitam', 'army', 'mocca', 'putih']);
    const hitam = hasil.laris[0];
    expect(hitam.qty).toBe(150);
    expect(hitam.namaAsli.sort()).toEqual(['BLACK', 'Hitam']);
  });

  it('porsi dihitung dari semua penjualan berwarna, termasuk yang belum dikenal — bukan hanya yang dikenal', () => {
    // total kini berwarna = 150 + 60 + 40 + 25 + 0 = 275; baris tanpa nama warna tidak dihitung.
    expect(hasil.total).toBe(275);
    expect(hasil.laris[0].bagian).toBeCloseTo(150 / 275, 6);
  });

  it('tren membandingkan 90 hari terakhir dengan 90 hari sebelumnya', () => {
    const tren = Object.fromEntries(hasil.laris.map((w) => [w.kunci, w.tren]));
    expect(tren.hitam).toBeCloseTo(150 / 120 - 1, 6);
    expect(tren.army).toBeCloseTo(2, 6);
    expect(tren.mocca).toBeCloseTo(-0.2, 6);
    expect(tren.putih).toBeCloseTo(-1, 6);
  });

  it('nama yang tidak dikenal dikumpulkan untuk dipetakan tim, terlaris dulu', () => {
    expect(hasil.tidakDikenal).toEqual([{ nama: 'Galaxy', qty: 25 }]);
  });

  it('pemetaan manual membuat nama itu ikut terhitung', () => {
    const h = hitungWarnaLaris(baris, { manual: { [rapikanNama('Galaxy')]: '#2b2f4a' } });
    expect(h.tidakDikenal).toEqual([]);
    expect(h.laris.find((w) => w.kunci === 'manual:galaxy')?.hex).toBe('#2b2f4a');
  });

  it('bisa disaring per kategori produk', () => {
    const h = hitungWarnaLaris(baris, { kategori: 'Hoodie' });
    expect(h.laris.map((w) => w.kunci)).toEqual(['mocca', 'putih']);
    expect(h.total).toBe(40);
  });

  it('tanpa data, hasilnya kosong', () => {
    expect(hitungWarnaLaris([])).toEqual({ laris: [], tidakDikenal: [], total: 0 });
  });
});

describe('daftarKategori', () => {
  it('kategori unik, terurut, tanpa kosong', () => {
    expect(daftarKategori([...baris, { nama: 'Hitam', kategori: null, kini: 1, lalu: 0 }])).toEqual(['Hoodie', 'Kaos']);
  });
});
