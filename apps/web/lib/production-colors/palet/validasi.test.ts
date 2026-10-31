import { describe, expect, it } from 'vitest';
import { periksaPalet } from './validasi';

const WARNA = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];

describe('periksaPalet', () => {
  it('meloloskan palet yang lengkap dan merapikan isinya', () => {
    const r = periksaPalet({ nama: '  Feed Agustus  ', aturan: 'TRIAD', warna: WARNA.map((w) => w.toUpperCase()) });
    expect(r).toEqual({ ok: true, isi: { nama: 'Feed Agustus', aturan: 'TRIAD', warna: WARNA, kain: null, porsi: null } });
  });

  it('menolak nama kosong', () => {
    expect(periksaPalet({ nama: '   ', aturan: 'TRIAD', warna: WARNA })).toEqual({ ok: false, alasan: 'NAMA_KOSONG' });
  });

  it('menolak nama yang terlalu panjang', () => {
    expect(periksaPalet({ nama: 'a'.repeat(61), aturan: 'TRIAD', warna: WARNA })).toEqual({
      ok: false,
      alasan: 'NAMA_TERLALU_PANJANG',
    });
  });

  it('menolak aturan yang tidak dikenal', () => {
    expect(periksaPalet({ nama: 'x', aturan: 'RAINBOW', warna: WARNA })).toEqual({ ok: false, alasan: 'ATURAN_TIDAK_DIKENAL' });
  });

  /*
   * Aksi server bisa dipanggil langsung, tanpa melewati layar. Jumlah dan
   * bentuk warna dijaga di sini, bukan dipercayakan pada roda.
   */
  it('menolak jumlah warna yang bukan lima', () => {
    expect(periksaPalet({ nama: 'x', aturan: 'TRIAD', warna: WARNA.slice(0, 4) })).toEqual({ ok: false, alasan: 'WARNA_TIDAK_SAH' });
    expect(periksaPalet({ nama: 'x', aturan: 'TRIAD', warna: [...WARNA, '#000000'] })).toEqual({ ok: false, alasan: 'WARNA_TIDAK_SAH' });
  });

  it('menolak isian yang bukan warna', () => {
    expect(periksaPalet({ nama: 'x', aturan: 'TRIAD', warna: ['#ff0000', 'merah', '#0000ff', '#ffff00', '#ff00ff'] })).toEqual({
      ok: false,
      alasan: 'WARNA_TIDAK_SAH',
    });
    expect(periksaPalet({ nama: 'x', aturan: 'TRIAD', warna: 'bukan-daftar' })).toEqual({ ok: false, alasan: 'WARNA_TIDAK_SAH' });
  });

  it('membuang porsi yang terkirim bersama palet bebas', () => {
    const r = periksaPalet({ nama: 'x', aturan: 'TRIAD', warna: WARNA, porsi: [20, 20, 20, 20, 20] });
    expect(r.ok && r.isi.porsi).toBeNull();
  });
});

describe('periksaPalet — palet berkain', () => {
  const kain = '#90A8A4';

  it('menerima satu sampai enam warna sablon dengan porsi berjumlah 100', () => {
    expect(periksaPalet({ nama: 'Kaos Blue Surf', aturan: 'COMPLEMENTARY', warna: ['#613B2B'], kain, porsi: [100] })).toEqual({
      ok: true,
      isi: { nama: 'Kaos Blue Surf', aturan: 'COMPLEMENTARY', warna: ['#613b2b'], kain: '#90a8a4', porsi: [100] },
    });
    const enam = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'];
    expect(periksaPalet({ nama: 'x', aturan: 'TRIAD', warna: enam, kain, porsi: [35, 25, 15, 10, 8, 7] }).ok).toBe(true);
  });

  it('menolak jumlah warna di luar 1–6', () => {
    expect(periksaPalet({ nama: 'x', aturan: 'TRIAD', warna: [], kain, porsi: [] })).toEqual({ ok: false, alasan: 'WARNA_TIDAK_SAH' });
    const tujuh = Array.from({ length: 7 }, () => '#123456');
    expect(periksaPalet({ nama: 'x', aturan: 'TRIAD', warna: tujuh, kain, porsi: [40, 10, 10, 10, 10, 10, 10] })).toEqual({ ok: false, alasan: 'WARNA_TIDAK_SAH' });
  });

  /*
   * Palet berkain adalah lembar kerja tukang sablon. Porsi yang tidak
   * berjumlah 100, tidak sejajar dengan warnanya, atau berisi pecahan tidak
   * boleh sampai tersimpan dan dikirim.
   */
  it('menolak porsi yang tidak berjumlah 100, tidak sejajar, atau bukan bilangan bulat', () => {
    const warna = ['#613b2b', '#f1e9e7'];
    for (const porsi of [[60, 30], [100], [50.5, 49.5], [110, -10], '100', null, undefined]) {
      expect(periksaPalet({ nama: 'x', aturan: 'TRIAD', warna, kain, porsi }), JSON.stringify(porsi)).toEqual({ ok: false, alasan: 'PORSI_TIDAK_SAH' });
    }
  });

  it('menolak kain yang bukan warna', () => {
    expect(periksaPalet({ nama: 'x', aturan: 'TRIAD', warna: ['#613b2b'], kain: 'biru', porsi: [100] })).toEqual({ ok: false, alasan: 'KAIN_TIDAK_SAH' });
  });
});
