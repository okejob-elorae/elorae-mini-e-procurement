import { describe, expect, it } from 'vitest';
import dataC from './pantone-c.json';
import { cariPantone, deltaE2000, hexKeLab, pantoneTerdekat, siapkanKatalog, pantoneKhusus } from './pantone';
import { hexKeHsb, hsbKeHex } from './warna';

describe('deltaE2000', () => {
  /*
   * Pasangan uji resmi CIEDE2000 dari Sharma, Wu & Dalal (2005). Rumus ini
   * penuh jebakan (rata-rata sudut rona, koreksi rotasi biru); lolos di satu
   * pasangan tidak membuktikan apa-apa, jadi yang diuji adalah pasangan yang
   * masing-masing menjebak cabang berbeda.
   */
  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ] as const)('%j ke %j = %d', (a, b, harapan) => {
    expect(deltaE2000([...a], [...b])).toBeCloseTo(harapan, 3);
    expect(deltaE2000([...b], [...a])).toBeCloseTo(harapan, 3);
  });

  it('memberi nol untuk warna yang sama', () => {
    expect(deltaE2000(hexKeLab('#c0db3a'), hexKeLab('#c0db3a'))).toBe(0);
  });
});

describe('hexKeLab', () => {
  it('menaruh putih dan hitam di ujung terang', () => {
    const [L, a, b] = hexKeLab('#ffffff');
    expect(L).toBeCloseTo(100, 2);
    expect(a).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(0, 2);
    expect(hexKeLab('#000000')[0]).toBeCloseTo(0, 6);
  });
});

const KATALOG = siapkanKatalog('C', [
  ['186 C', '#cd182f'],
  ['1865 C', '#b9004c'],
  ['Warm Red C', '#fb4439'],
  ['Cool Gray 1 C', '#dfdcd8'],
  ['2186 C', '#0a2a6b'],
]);

const TCX = siapkanKatalog('TCX', [
  ['15-0343', '#88b04b', 'Greenery'],
  ['13-0550', '#c0d725', 'Lime Punch'],
  ['19-4052', '#0f4c81', 'Classic Blue'],
]);

describe('cariPantone', () => {
  it('mendahulukan kode yang persis, lalu yang berawalan sama', () => {
    expect(cariPantone(KATALOG, '186').map((w) => w.kode)).toEqual(['186 C', '1865 C']);
  });

  it('menerima cara orang biasa menulis kode C', () => {
    for (const kueri of ['186 c', 'PANTONE 186 C', 'pantone186c', ' 186C ']) {
      expect(cariPantone(KATALOG, kueri)[0]?.kode, kueri).toBe('186 C');
    }
  });

  it('mencari lewat nama', () => {
    expect(cariPantone(KATALOG, 'warm red')[0]?.kode).toBe('Warm Red C');
    expect(cariPantone(KATALOG, 'gray')[0]?.kode).toBe('Cool Gray 1 C');
    expect(cariPantone(TCX, 'green')[0]?.kode).toBe('15-0343');
  });

  it('menerima kode TCX dengan atau tanpa tanda hubung dan akhiran TCX', () => {
    for (const kueri of ['15-0343', '150343', '15-0343 TCX', '15 0343']) {
      expect(cariPantone(TCX, kueri)[0]?.kode, kueri).toBe('15-0343');
    }
  });

  it('tidak mengembalikan apa pun untuk kueri kosong atau yang tak cocok', () => {
    expect(cariPantone(KATALOG, '   ')).toEqual([]);
    expect(cariPantone(KATALOG, 'zzz')).toEqual([]);
  });

  it('membatasi jumlah hasil', () => {
    expect(cariPantone(KATALOG, 'c', 2)).toHaveLength(2);
  });
});

describe('pantoneTerdekat', () => {
  it('menemukan warna yang hex-nya persis, dengan jarak nol', () => {
    const hasil = pantoneTerdekat(KATALOG, '#fb4439');
    expect(hasil?.warna.kode).toBe('Warm Red C');
    expect(hasil?.deltaE).toBe(0);
  });

  it('memilih yang paling dekat menurut mata, bukan menurut urutan', () => {
    expect(pantoneTerdekat(TCX, '#8ab34d')?.warna.kode).toBe('15-0343');
    expect(pantoneTerdekat(TCX, '#123f70')?.warna.kode).toBe('19-4052');
  });

  it('mengembalikan null untuk katalog kosong', () => {
    expect(pantoneTerdekat(siapkanKatalog('C', []), '#ffffff')).toBeNull();
  });
});

describe('data Pantone C', () => {
  /*
   * Diekstrak dari katalog Coated C milik tim (lewat Pantone Studio). Tes ini
   * menjaga bahwa berkasnya tidak terpotong atau rusak diam-diam saat
   * diperbarui — satu baris hilang berarti satu kode "tidak ditemukan".
   */
  it('lengkap, kodenya unik, dan hex-nya sah', () => {
    const data = dataC as [string, string][];
    expect(data).toHaveLength(3219);
    expect(new Set(data.map(([k]) => k)).size).toBe(3219);
    for (const [kode, hex] of data) {
      expect(kode, kode).toMatch(/ C$/);
      expect(hex, kode).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  /*
   * Penjaga terhadap "optimasi" yang menyaring kandidat sebelum CIEDE2000.
   * Versi dengan saringan Lab lurus salah memilih 4,4% dari pencarian acak.
   * Sampelnya deterministik supaya kegagalan bisa diulang.
   */
  it('memilih yang sama dengan menghitung CIEDE2000 ke semua warna', () => {
    const katalog = siapkanKatalog('C', dataC as [string, string][]);
    let benih = 20260917;
    const acak = () => (benih = (benih * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 300; i++) {
      const hex = `#${[0, 0, 0].map(() => Math.floor(acak() * 256).toString(16).padStart(2, '0')).join('')}`;
      const lab = hexKeLab(hex);
      const penuh = Math.min(...katalog.map((w) => deltaE2000(lab, w.lab)));
      expect(pantoneTerdekat(katalog, hex)?.deltaE, hex).toBe(penuh);
    }
  });

  /*
   * Warna di palet disimpan sebagai posisi roda (HSB), bukan hex. Pantone yang
   * dipilih harus kembali ke hex yang SAMA setelah lewat roda — kalau bergeser
   * satu angka pun, padanannya tidak lagi "persis" dan orang mengira kodenya
   * salah terpasang.
   */
  it('kembali ke hex yang sama setelah lewat roda, untuk setiap kode', () => {
    for (const [kode, hex] of dataC as [string, string][]) {
      expect(hsbKeHex(hexKeHsb(hex)), kode).toBe(hex);
    }
  });

  it('memuat kode yang dicari orang sehari-hari', () => {
    const katalog = siapkanKatalog('C', dataC as [string, string][]);
    for (const kode of ['186 C', 'Warm Red C', 'Black C', 'Cool Gray 11 C', '2685 C']) {
      expect(cariPantone(katalog, kode)[0]?.kode, kode).toBe(kode);
    }
  });
});

describe('pantoneKhusus', () => {
  it('mengenali tinta metalik dan neon dari kodenya', () => {
    for (const k of ['871 C', '877 C', '8003 C', '8925 C', '10103 C', '10352 C']) expect(pantoneKhusus(k), k).toBe('METALIK');
    for (const k of ['801 C', '814 C', '901 C', '942 C']) expect(pantoneKhusus(k), k).toBe('NEON');
  });

  it('tinta biasa, pastel empat digit, dan nama tidak dianggap khusus', () => {
    for (const k of ['186 C', '800 C', '815 C', '870 C', '878 C', '943 C', '9285 C', '7581 C', '4231 C', '2388 C', 'Black 4 C', 'Orange 021 C'])
      expect(pantoneKhusus(k), k).toBeNull();
  });
});
