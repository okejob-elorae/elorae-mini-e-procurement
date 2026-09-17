import { describe, expect, it } from 'vitest';
import { periksaPalet } from './validasi';

const WARNA = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];

describe('periksaPalet', () => {
  it('meloloskan palet yang lengkap dan merapikan isinya', () => {
    const r = periksaPalet({ nama: '  Feed Agustus  ', aturan: 'TRIAD', warna: WARNA.map((w) => w.toUpperCase()) });
    expect(r).toEqual({ ok: true, isi: { nama: 'Feed Agustus', aturan: 'TRIAD', warna: WARNA } });
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
});
