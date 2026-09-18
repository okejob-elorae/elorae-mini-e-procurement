import { describe, expect, it } from 'vitest';
import { BATAS_PEMETAAN, bacaPemetaan, ubahPemetaan } from './pemetaan-warna';

describe('bacaPemetaan', () => {
  it('merapikan kunci dan hex, dan melewati entri yang rusak', () => {
    expect(bacaPemetaan(JSON.stringify({ 'GALAXY!': '2B2F4A', Rusak: 'bukan', '': '#ffffff', Oke: '#ABC' }))).toEqual({
      galaxy: '#2b2f4a',
      oke: '#aabbcc',
    });
  });

  it('isi yang bukan objek JSON dianggap kosong', () => {
    for (const v of [null, '', 'bukan json', '[1,2]', '"teks"']) expect(bacaPemetaan(v)).toEqual({});
  });
});

describe('ubahPemetaan', () => {
  it('menambah, mengganti, dan menghapus satu entri tanpa menyentuh yang lain', () => {
    const a = ubahPemetaan({ lain: '#000000' }, 'Galaxy', '#2B2F4A');
    expect(a).toEqual({ ok: true, peta: { lain: '#000000', galaxy: '#2b2f4a' } });
    if (!a.ok) return;
    const b = ubahPemetaan(a.peta, 'GALAXY', '#111111');
    expect(b.ok && b.peta.galaxy).toBe('#111111');
    const c = ubahPemetaan(a.peta, 'galaxy', null);
    expect(c).toEqual({ ok: true, peta: { lain: '#000000' } });
  });

  it('menolak masukan yang tidak sah', () => {
    expect(ubahPemetaan({}, '  ', '#ffffff')).toEqual({ ok: false, alasan: 'NAMA_KOSONG' });
    expect(ubahPemetaan({}, 123, '#ffffff')).toEqual({ ok: false, alasan: 'NAMA_KOSONG' });
    expect(ubahPemetaan({}, 'x'.repeat(61), '#ffffff')).toEqual({ ok: false, alasan: 'NAMA_TERLALU_PANJANG' });
    expect(ubahPemetaan({}, 'Galaxy', 'ungu')).toEqual({ ok: false, alasan: 'HEX_TIDAK_SAH' });
    const penuh = Object.fromEntries(Array.from({ length: BATAS_PEMETAAN }, (_, i) => [`w${i}`, '#000000']));
    expect(ubahPemetaan(penuh, 'baru', '#ffffff')).toEqual({ ok: false, alasan: 'TERLALU_BANYAK' });
    expect(ubahPemetaan(penuh, 'w1', '#ffffff').ok).toBe(true);
  });
});
