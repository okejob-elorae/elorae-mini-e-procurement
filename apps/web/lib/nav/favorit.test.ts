import { describe, expect, it } from 'vitest';
import { BATAS_FAVORIT, ubahFavorit } from './favorit';

describe('ubahFavorit', () => {
  it('menambah yang belum ada', () => {
    expect(ubahFavorit([], '/a')).toEqual({ daftar: ['/a'], hasil: 'ditambah' });
  });

  it('melepas yang sudah ada', () => {
    expect(ubahFavorit(['/a', '/b'], '/a')).toEqual({ daftar: ['/b'], hasil: 'dilepas' });
  });

  it('MENOLAK saat penuh, tidak membuang yang paling lama', () => {
    /*
     * Membuang diam-diam berarti sematan seseorang hilang tanpa ia pernah
     * memintanya — dan ia baru sadar saat mencarinya dan tidak ketemu.
     */
    const penuh = Array.from({ length: BATAS_FAVORIT }, (_, i) => `/${i}`);
    const r = ubahFavorit(penuh, '/baru');
    expect(r.hasil).toBe('penuh');
    expect(r.daftar).toEqual(penuh);
  });

  it('tetap bisa MELEPAS walau sudah penuh', () => {
    // Kalau tidak, satu-satunya jalan keluar dari daftar penuh adalah menghapus
    // localStorage lewat konsol.
    const penuh = Array.from({ length: BATAS_FAVORIT }, (_, i) => `/${i}`);
    expect(ubahFavorit(penuh, '/0').hasil).toBe('dilepas');
  });

  it('tidak mengubah daftar aslinya', () => {
    // Daftar yang diubah di tempat akan melewati perbandingan state React dan
    // menu tidak digambar ulang.
    const asal = ['/a'];
    ubahFavorit(asal, '/b');
    expect(asal).toEqual(['/a']);
  });
});
