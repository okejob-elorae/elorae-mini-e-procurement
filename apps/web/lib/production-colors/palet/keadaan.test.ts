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
  geserSemuaTinta,
  geserPeganganPalet,
  hapusWarnaSablon,
  isiDariGambar,
  lepasKain,
  paletBebas,
  pasangKain,
  pilihAturanPalet,
  sarankanDariKain,
  terapkanKomposisi,
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

  /*
   * Memilih aturan adalah permintaan eksplisit. Dulu palet yang sudah disunting
   * hanya berganti label aturannya dan warnanya diam — pemilik mengira fitur
   * itu rusak. Mengganti kain atau jumlah tetap tidak menimpa suntingan; untuk
   * aturan, layar menawarkan Urungkan.
   */
  it('menyusun saran baru di palet berkain yang sudah disunting, dengan jumlah warna yang sama', () => {
    const empat = ubahJumlahSablon(pasangKain(bebas(), BLUE_SURF, KATALOG), 4, KATALOG);
    const disunting = ubahKecerahanPalet(gantiHexPalet(empat, 1, '#654321'), 0, 0.35);
    expect(disunting.saranUtuh).toBe(false);
    const p = pilihAturanPalet(disunting, 'TRIAD', KATALOG);
    expect(p.aturan).toBe('TRIAD');
    expect(hexDari(p)).toEqual(saranHex(BLUE_SURF, 4, 'TRIAD'));
    expect(p.porsi).toEqual(PORSI_AWAL[4]);
    expect(p.saranUtuh).toBe(true);
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

describe('mengisi palet dari gambar', () => {
  const WARNA_GAMBAR = [
    { hex: '#90a8a4', bagian: 0.55 },
    { hex: '#613b2b', bagian: 0.25 },
    { hex: '#f1e9e7', bagian: 0.12 },
    { hex: '#e8553d', bagian: 0.05 },
    { hex: '#2a78d6', bagian: 0.03 },
  ];

  it('mengisi lima warna palet bebas dan melepas aturannya ke Custom', () => {
    const p = isiDariGambar(bebas(), WARNA_GAMBAR);
    expect(p.aturan).toBe('CUSTOM');
    expect(hexDari(p)).toEqual(WARNA_GAMBAR.map((w) => w.hex));
    expect(p.kain).toBeNull();
  });

  it('tidak mengubah palet bebas kalau warnanya kurang dari lima', () => {
    const p = bebas();
    expect(isiDariGambar(p, WARNA_GAMBAR.slice(0, 3))).toBe(p);
  });

  /*
   * Di foto kaos, warna terbanyak hampir selalu kainnya sendiri. Menjadikannya
   * tinta berarti mencetak kain di atas kain — jadi warna yang nyaris sama
   * dengan kain dilewati, dan porsinya dihitung dari sisanya.
   */
  it('menjadikan warna gambar tinta sablon, melewati warna yang sama dengan kain, porsi dari luasnya', () => {
    const berkain = pasangKain(bebas(), BLUE_SURF, KATALOG);
    const p = isiDariGambar(berkain, WARNA_GAMBAR);
    expect(hexDari(p)).toEqual(['#613b2b', '#f1e9e7', '#e8553d', '#2a78d6']);
    // 0,25 : 0,12 : 0,05 : 0,03 = 55,6 : 26,7 : 11,1 : 6,7 → sisa terbesar → 55/27/11/7.
    expect(p.porsi).toEqual([55, 27, 11, 7]);
    expect(p.porsi?.reduce((s, x) => s + x, 0)).toBe(100);
    expect(p.saranUtuh).toBe(false);
    expect(p.kain).toBe(BLUE_SURF);
  });

  it('membatasi tinta sablon ke enam warna', () => {
    const banyak = Array.from({ length: 9 }, (_, i) => ({ hex: `#${(0x102030 + i * 0x151515).toString(16)}`, bagian: 1 }));
    const p = isiDariGambar(pasangKain(bebas(), '#ffffff', KATALOG), banyak);
    expect(p.warna).toHaveLength(6);
  });

  it('memakai porsi awal kalau warna diambil satu-satu tanpa ukuran luas', () => {
    const berkain = pasangKain(bebas(), BLUE_SURF, KATALOG);
    const p = isiDariGambar(berkain, [{ hex: '#613b2b' }, { hex: '#f1e9e7' }, { hex: '#e8553d' }]);
    expect(p.porsi).toEqual(PORSI_AWAL[3]);
  });

  it('tidak mengubah palet berkain kalau semua warna gambar sama dengan kain', () => {
    const berkain = pasangKain(bebas(), BLUE_SURF, KATALOG);
    expect(isiDariGambar(berkain, [{ hex: '#91a9a5', bagian: 1 }])).toBe(berkain);
  });
});

describe('terapkanKomposisi', () => {
  const komposisi = {
    tinta: [
      { hex: '#f1e7d9', porsi: 45 },
      { hex: '#a0d513', porsi: 35 },
      { hex: '#1e3846', porsi: 20 },
    ],
  };

  it('memasang tinta dan porsinya ke palet berkain, sebagai pilihan tangan', () => {
    const p = terapkanKomposisi(pasangKain(bebas(), NAVY, KATALOG), komposisi);
    expect(hexDari(p)).toEqual(['#f1e7d9', '#a0d513', '#1e3846']);
    expect(p.porsi).toEqual([45, 35, 20]);
    expect(p.kain).toBe(NAVY);
    // Mengganti kain sesudahnya tidak boleh menimpa pilihan ini.
    expect(p.saranUtuh).toBe(false);
    expect(hexDari(pasangKain(p, BLUE_SURF, KATALOG))).toEqual(hexDari(p));
  });

  it('tidak menyentuh palet bebas atau komposisi kosong', () => {
    const b = bebas();
    expect(terapkanKomposisi(b, komposisi)).toBe(b);
    const k = pasangKain(b, NAVY, KATALOG);
    expect(terapkanKomposisi(k, { tinta: [] })).toBe(k);
  });
});

describe('geserSemuaTinta', () => {
  const selisih = (a: number, b: number) => (((a - b) % 360) + 360) % 360;

  it('memutar semua tinta bersama dan menskalakan kepekatannya, jarak antartinta tetap', () => {
    const awal = pasangKain(bebas(), NAVY, KATALOG);
    const [a, b, c] = awal.warna;
    const p = geserSemuaTinta(awal, 1, b.h + 40, b.s * 0.5);
    expect(p.warna[1].h).toBeCloseTo((b.h + 40) % 360, 6);
    expect(selisih(p.warna[0].h, p.warna[1].h)).toBeCloseTo(selisih(a.h, b.h), 6);
    expect(selisih(p.warna[2].h, p.warna[1].h)).toBeCloseTo(selisih(c.h, b.h), 6);
    expect(p.warna[0].s).toBeCloseTo(a.s * 0.5, 6);
    expect(p.warna[2].s).toBeCloseTo(c.s * 0.5, 6);
    expect(p.warna.map((w) => w.b)).toEqual(awal.warna.map((w) => w.b));
    expect(p.kain).toBe(NAVY);
    expect(p.porsi).toEqual(awal.porsi);
    expect(p.saranUtuh).toBe(false);
  });

  it('tinta abu-abu (tanpa kepekatan) tidak membuat skala tak terhingga', () => {
    const awal = gantiHexPalet(pasangKain(bebas(), NAVY, KATALOG), 0, '#808080');
    const p = geserSemuaTinta(awal, 0, 90, 0.6);
    expect(p.warna[0].s).toBeCloseTo(0.6, 6);
    expect(p.warna[1].s).toBeCloseTo(awal.warna[1].s, 6);
    expect(p.warna.every((w) => Number.isFinite(w.s) && w.s >= 0 && w.s <= 1)).toBe(true);
  });

  it('di palet bebas sama dengan menggeser pegangan biasa', () => {
    const b = bebas();
    expect(geserSemuaTinta(b, 0, 123, 0.7)).toEqual(geserPeganganPalet(b, 0, 123, 0.7));
  });
});
