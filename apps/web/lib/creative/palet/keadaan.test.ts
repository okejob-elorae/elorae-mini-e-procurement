import { describe, expect, it } from 'vitest';
import dataC from './pantone-c.json';
import { INDEKS_DASAR, susunHarmoni } from './harmoni';
import { siapkanKatalog } from './pantone';
import { hexKeHsb, hsbKeHex } from './warna';
import { PORSI_AWAL, sarankanSablon } from '../sablon/saran';
import {
  JUMLAH_SABLON_AWAL,
  dariTersimpan,
  gantiHexPalet,
  geserPeganganPalet,
  hapusWarnaSablon,
  lepasKain,
  paletBebas,
  pasangKain,
  pilihAturanPalet,
  sarankanDariKain,
  ubahJumlahSablon,
  ubahKecerahanPalet,
  ubahPorsiPalet,
} from './keadaan';

const KATALOG = siapkanKatalog('C', dataC as [string, string][]);
const BLUE_SURF = '#90a8a4';
const NAVY = '#1f2a44';

const hexDari = (p: { warna: { h: number; s: number; b: number }[] }) => p.warna.map(hsbKeHex);
const bebas = () => paletBebas('ANALOGOUS', susunHarmoni('ANALOGOUS', hexKeHsb('#e8553d'), []));
const saranHex = (kain: string, jumlah: number, aturan: Parameters<typeof sarankanSablon>[0]['aturan']) =>
  sarankanSablon({ kainHex: kain, jumlah, aturan, katalog: KATALOG }).map((s) => s.warna.hex);

describe('memasang kain', () => {
  it('mengubah palet bebas menjadi warna sablon dari kain', () => {
    const p = pasangKain(bebas(), BLUE_SURF, KATALOG);
    expect(p.kain).toBe(BLUE_SURF);
    expect(p.warna).toHaveLength(JUMLAH_SABLON_AWAL);
    expect(hexDari(p)).toEqual(saranHex(BLUE_SURF, JUMLAH_SABLON_AWAL, 'ANALOGOUS'));
    expect(p.porsi).toEqual(PORSI_AWAL[JUMLAH_SABLON_AWAL]);
    expect(p.saranUtuh).toBe(true);
  });

  it('memakai aturan pengganti kalau aturannya Custom — kain tidak bisa diberi saran "bebas"', () => {
    const p = pasangKain({ ...bebas(), aturan: 'CUSTOM' }, BLUE_SURF, KATALOG);
    expect(p.aturan).toBe('COMPLEMENTARY');
  });

  it('memperbarui saran saat kain diganti, selama belum ada yang disunting', () => {
    const awal = pasangKain(bebas(), BLUE_SURF, KATALOG);
    const p = pasangKain(awal, NAVY, KATALOG);
    expect(hexDari(p)).toEqual(saranHex(NAVY, JUMLAH_SABLON_AWAL, 'ANALOGOUS'));
    expect(p.saranUtuh).toBe(true);
  });

  /*
   * Inti penyatuan: warna yang sudah disetel tangan TIDAK boleh ditimpa saran
   * baru hanya karena kainnya diganti. Kehilangan satu jam penyetelan karena
   * salah klik kode kain adalah kesalahan yang tidak termaafkan.
   */
  it('mempertahankan warna yang sudah disunting saat kain diganti', () => {
    const awal = pasangKain(bebas(), BLUE_SURF, KATALOG);
    const disunting = gantiHexPalet(awal, 0, '#123456');
    const p = pasangKain(disunting, NAVY, KATALOG);
    expect(p.kain).toBe(NAVY);
    expect(hexDari(p)).toEqual(hexDari(disunting));
    expect(p.saranUtuh).toBe(false);
  });

  it('memberi saran baru hanya kalau diminta, meskipun sudah disunting', () => {
    const disunting = ubahPorsiPalet(pasangKain(bebas(), BLUE_SURF, KATALOG), 0, 40);
    const p = sarankanDariKain(disunting, KATALOG);
    expect(p.porsi).toEqual(PORSI_AWAL[JUMLAH_SABLON_AWAL]);
    expect(p.saranUtuh).toBe(true);
  });
});

describe('melepas kain', () => {
  it('kembali ke lima warna palet bebas, dengan tinta dominan sebagai dasar', () => {
    const sablon = pasangKain(bebas(), BLUE_SURF, KATALOG);
    const p = lepasKain(sablon);
    expect(p.kain).toBeNull();
    expect(p.porsi).toBeNull();
    expect(p.warna).toHaveLength(5);
    expect(hsbKeHex(p.warna[INDEKS_DASAR])).toBe(hsbKeHex(sablon.warna[0]));
  });

  it('tidak mengubah palet yang memang tidak berkain', () => {
    const p = bebas();
    expect(lepasKain(p)).toBe(p);
  });
});

describe('aturan', () => {
  it('menyusun ulang lima warna di palet bebas, seperti sebelumnya', () => {
    const p = pilihAturanPalet(bebas(), 'TRIAD', KATALOG);
    expect(p.aturan).toBe('TRIAD');
    expect(hexDari(p)).toEqual(susunHarmoni('TRIAD', bebas().warna[INDEKS_DASAR], bebas().warna).map(hsbKeHex));
  });

  it('memperbarui saran di palet berkain yang belum disunting', () => {
    const p = pilihAturanPalet(pasangKain(bebas(), BLUE_SURF, KATALOG), 'TRIAD', KATALOG);
    expect(hexDari(p)).toEqual(saranHex(BLUE_SURF, JUMLAH_SABLON_AWAL, 'TRIAD'));
  });

  it('hanya mengganti aturannya di palet berkain yang sudah disunting', () => {
    const disunting = gantiHexPalet(pasangKain(bebas(), BLUE_SURF, KATALOG), 1, '#654321');
    const p = pilihAturanPalet(disunting, 'TRIAD', KATALOG);
    expect(p.aturan).toBe('TRIAD');
    expect(hexDari(p)).toEqual(hexDari(disunting));
  });
});

describe('jumlah warna sablon', () => {
  it('mengikuti saran untuk jumlah baru kalau belum disunting', () => {
    const p = ubahJumlahSablon(pasangKain(bebas(), BLUE_SURF, KATALOG), 5, KATALOG);
    expect(hexDari(p)).toEqual(saranHex(BLUE_SURF, 5, 'ANALOGOUS'));
    expect(p.porsi).toEqual(PORSI_AWAL[5]);
  });

  it('menambah warna baru yang berbeda tanpa menyentuh yang sudah disunting', () => {
    const disunting = gantiHexPalet(pasangKain(bebas(), BLUE_SURF, KATALOG), 0, '#123456');
    const p = ubahJumlahSablon(disunting, 5, KATALOG);
    expect(p.warna).toHaveLength(5);
    expect(hexDari(p).slice(0, 3)).toEqual(hexDari(disunting));
    expect(new Set(hexDari(p)).size).toBe(5);
    expect(p.porsi).toEqual(PORSI_AWAL[5]);
  });

  it('mengurangi dari belakang, dan membatasi ke 1–6', () => {
    const awal = ubahJumlahSablon(pasangKain(bebas(), BLUE_SURF, KATALOG), 4, KATALOG);
    const disunting = ubahPorsiPalet(awal, 0, 45);
    const p = ubahJumlahSablon(disunting, 2, KATALOG);
    expect(hexDari(p)).toEqual(hexDari(disunting).slice(0, 2));
    expect(ubahJumlahSablon(p, 0, KATALOG).warna).toHaveLength(1);
    expect(ubahJumlahSablon(p, 9, KATALOG).warna).toHaveLength(6);
  });

  it('tidak berlaku di palet tanpa kain', () => {
    const p = bebas();
    expect(ubahJumlahSablon(p, 3, KATALOG)).toBe(p);
  });
});

describe('menghapus warna sablon', () => {
  it('menghapus warna yang dimaksud dan menyusun porsi ulang', () => {
    const awal = pasangKain(bebas(), BLUE_SURF, KATALOG);
    const p = hapusWarnaSablon(awal, 1);
    expect(hexDari(p)).toEqual([hexDari(awal)[0], hexDari(awal)[2]]);
    expect(p.porsi).toEqual(PORSI_AWAL[2]);
    expect(p.saranUtuh).toBe(false);
  });

  it('menolak menghapus warna terakhir', () => {
    const satu = ubahJumlahSablon(pasangKain(bebas(), BLUE_SURF, KATALOG), 1, KATALOG);
    expect(hapusWarnaSablon(satu, 0)).toBe(satu);
  });
});

describe('menyunting satu warna di palet berkain', () => {
  it('menggeser hanya tinta yang dipegang — tidak ada harmoni yang memutar yang lain', () => {
    const awal = pasangKain(bebas(), BLUE_SURF, KATALOG);
    const p = geserPeganganPalet(awal, 1, 200, 0.5);
    expect(p.warna[1]).toEqual({ ...awal.warna[1], h: 200, s: 0.5 });
    expect(p.warna[0]).toEqual(awal.warna[0]);
    expect(p.warna[2]).toEqual(awal.warna[2]);
    expect(p.aturan).toBe(awal.aturan);
    expect(p.saranUtuh).toBe(false);
  });

  it('mengubah kecerahan hanya tinta itu', () => {
    const awal = pasangKain(bebas(), BLUE_SURF, KATALOG);
    const p = ubahKecerahanPalet(awal, 2, 0.3);
    expect(p.warna[2].b).toBe(0.3);
    expect(p.warna[0]).toEqual(awal.warna[0]);
  });

  it('mengabaikan hex yang tidak sah', () => {
    const awal = pasangKain(bebas(), BLUE_SURF, KATALOG);
    expect(gantiHexPalet(awal, 0, 'bukan')).toBe(awal);
  });

  it('membatasi porsi ke 0–100', () => {
    const awal = pasangKain(bebas(), BLUE_SURF, KATALOG);
    expect(ubahPorsiPalet(awal, 0, 140).porsi?.[0]).toBe(100);
    expect(ubahPorsiPalet(awal, 0, -5).porsi?.[0]).toBe(0);
  });
});

describe('palet bebas tetap bekerja seperti sebelumnya', () => {
  it('memutar seluruh harmoni lewat pegangan', () => {
    const awal = pilihAturanPalet(bebas(), 'TRIAD', KATALOG);
    const p = geserPeganganPalet(awal, 0, awal.warna[0].h + 10, awal.warna[0].s);
    expect(p.aturan).toBe('TRIAD');
    expect(p.kain).toBeNull();
    expect(p.warna[INDEKS_DASAR].h).not.toBe(awal.warna[INDEKS_DASAR].h);
  });
});

describe('memuat palet tersimpan', () => {
  it('memuat palet berkain beserta porsinya, sebagai palet yang sudah disunting', () => {
    const p = dariTersimpan({ aturan: 'TRIAD', warna: ['#613b2b', '#f1e9e7'], kain: BLUE_SURF, porsi: [70, 30] });
    expect(p.kain).toBe(BLUE_SURF);
    expect(hexDari(p)).toEqual(['#613b2b', '#f1e9e7']);
    expect(p.porsi).toEqual([70, 30]);
    expect(p.saranUtuh).toBe(false);
  });

  it('memuat palet bebas tanpa kain', () => {
    const warna = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
    const p = dariTersimpan({ aturan: 'SQUARE', warna, kain: null, porsi: null });
    expect(p.kain).toBeNull();
    expect(hexDari(p)).toEqual(warna);
  });
});
