import { describe, expect, it } from 'vitest';
import dataC from '../palet/pantone-c.json';
import { deltaE2000, hexKeLab, pantoneKhusus, siapkanKatalog } from '../palet/pantone';
import { bacaKomposisiDesain, galeriKomposisi, tiruKomposisi, variasiDesain, type Komposisi, type PeranKomposisi } from './komposisi';
import { PORSI_AWAL } from './saran';

const KATALOG = siapkanKatalog('C', dataC as [string, string][]);
const HITAM = '#101010';
const BLUE_SURF = '#90a8a4';
const PUTIH = '#f7f7f5';

const L = (hex: string) => hexKeLab(hex)[0];
const kroma = (hex: string) => {
  const [, a, b] = hexKeLab(hex);
  return Math.hypot(a, b);
};
const rona = (hex: string) => {
  const [, a, b] = hexKeLab(hex);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};
const jarakRona = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Aturan keterbacaan per peran — yang membuat komposisi bisa dicetak. */
function periksaKeterbacaan(k: Komposisi, kain: string) {
  for (const t of k.tinta) {
    const beda = Math.abs(L(t.hex) - L(kain));
    const syarat: Record<PeranKomposisi, [number, number]> = {
      AKSEN: [20, 100],
      AKSEN_2: [20, 100],
      AKSEN_3: [20, 100],
      AKSEN_TUA: [20, 100],
      NETRAL: [20, 100],
      NADA: [5, 28],
      TONAL: [12, 100],
    };
    const [min, maks] = syarat[t.peran];
    expect(beda, `${k.pola} ${t.peran} ${t.hex} di ${kain}`).toBeGreaterThanOrEqual(min);
    expect(beda, `${k.pola} ${t.peran} ${t.hex} di ${kain}`).toBeLessThanOrEqual(maks);
  }
}

function periksaBentuk(k: Komposisi) {
  expect(k.tinta.reduce((s, t) => s + t.porsi, 0)).toBe(100);
  // Tinta dominan lebih dulu: huruf A selalu yang terluas.
  expect(k.tinta.map((t) => t.porsi)).toEqual([...k.tinta.map((t) => t.porsi)].sort((a, b) => b - a));
  for (let i = 0; i < k.tinta.length; i++)
    for (let j = i + 1; j < k.tinta.length; j++)
      expect(deltaE2000(hexKeLab(k.tinta[i].hex), hexKeLab(k.tinta[j].hex))).toBeGreaterThanOrEqual(8);
}

describe('galeriKomposisi — mengikuti jumlah tinta', () => {
  /*
   * Rekomendasi harus bisa langsung dipakai: kalau desainnya empat tinta, semua
   * kartu empat tinta, dengan porsi awal yang sama seperti kartu Warna sablon.
   */
  it.each([1, 2, 3, 4, 5, 6])('%i tinta: setiap komposisi tepat sejumlah itu', (n) => {
    for (const kain of [HITAM, BLUE_SURF, PUTIH]) {
      const galeri = galeriKomposisi({ kainHex: kain, katalog: KATALOG, jumlah: n });
      expect(galeri.length, `${n} tinta di ${kain}`).toBeGreaterThanOrEqual(4);
      for (const k of galeri) {
        expect(k.tinta, `${k.pola} di ${kain}`).toHaveLength(n);
        expect(k.tinta.map((t) => t.porsi)).toEqual(PORSI_AWAL[n]);
        periksaBentuk(k);
        periksaKeterbacaan(k, kain);
      }
    }
  });

  it('warna yang dikunci tetap ada di setiap jumlah', () => {
    for (const n of [1, 2, 4, 6]) {
      const galeri = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG, jumlah: n, kunciHex: '#a0d513' });
      expect(galeri.length).toBeGreaterThanOrEqual(1);
      for (const k of galeri) {
        expect(k.tinta).toHaveLength(n);
        expect(k.tinta.some((t) => t.hex === '#a0d513')).toBe(true);
      }
    }
  });
});

describe('galeriKomposisi — kain netral (hitam)', () => {
  const galeri = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG });

  it('memberi beberapa pilihan siap pakai, masing-masing bisa dicetak', () => {
    expect(galeri.length).toBeGreaterThanOrEqual(6);
    expect(galeri.length).toBeLessThanOrEqual(12);
    expect(new Set(galeri.map((k) => k.id)).size).toBe(galeri.length);
    for (const k of galeri) {
      periksaBentuk(k);
      periksaKeterbacaan(k, HITAM);
    }
  });

  it('memuat pola streetwear: netral + aksen + tone-on-tone', () => {
    const k = galeri.find((x) => x.pola === 'KLASIK');
    expect(k).toBeDefined();
    const peran = new Map(k!.tinta.map((t) => [t.peran, t.hex]));
    expect(kroma(peran.get('AKSEN')!)).toBeGreaterThanOrEqual(30);
    expect(kroma(peran.get('NETRAL')!)).toBeLessThan(15);
    expect(L(peran.get('NETRAL')!)).toBeGreaterThan(75);
  });

  it('tidak mengarang rona dari kain hitam: aksennya beragam', () => {
    const aksen = new Set(galeri.flatMap((k) => k.tinta.filter((t) => t.peran === 'AKSEN').map((t) => t.kode)));
    expect(aksen.size).toBeGreaterThanOrEqual(5);
  });

  it('di kain putih, netral dan aksennya gelap', () => {
    for (const k of galeriKomposisi({ kainHex: PUTIH, katalog: KATALOG })) {
      periksaBentuk(k);
      periksaKeterbacaan(k, PUTIH);
      for (const t of k.tinta) if (t.peran !== 'NADA') expect(L(t.hex)).toBeLessThan(L(PUTIH));
    }
  });
});

describe('galeriKomposisi — gaya cerah dan redam', () => {
  /*
   * Desain streetwear yang dibawa pemilik: kaos hitam dengan slate gelap yang
   * mendominasi, putih tulang keabuan, zaitun (versi tua dari aksennya), dan
   * sedikit lime yang kalem. Gaya "cerah" tidak akan pernah sampai ke sana —
   * aksennya selalu Pantone paling pekat — jadi gaya "redam" harus bisa.
   */
  const referensi = ['#353e45', '#d9d4c6', '#626b4a', '#8eb03b'];

  it('gaya redam, empat tinta di kain hitam, memuat komposisi setara desain referensi', () => {
    const galeri = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG, jumlah: 4, gaya: 'REDAM' });
    expect(galeri.length).toBeGreaterThanOrEqual(4);
    for (const k of galeri) {
      expect(k.gaya).toBe('REDAM');
      periksaBentuk(k);
      periksaKeterbacaan(k, HITAM);
    }
    const mirip = galeri.find((k) => k.tinta.every((t, i) => deltaE2000(hexKeLab(t.hex), hexKeLab(referensi[i])) < 10));
    expect(mirip, JSON.stringify(galeri.map((k) => k.tinta.map((t) => t.hex)))).toBeDefined();
    expect(mirip!.tinta.map((t) => t.peran)).toEqual(['NADA', 'NETRAL', 'AKSEN_TUA', 'AKSEN']);
  });

  it('warna redam memang lebih kalem dari yang cerah', () => {
    const cerah = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG, gaya: 'CERAH' });
    const redam = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG, gaya: 'REDAM' });
    const rata = (g: Komposisi[]) => {
      const aksen = g.flatMap((k) => k.tinta.filter((t) => t.peran === 'AKSEN').map((t) => kroma(t.hex)));
      return aksen.reduce((a, b) => a + b, 0) / aksen.length;
    };
    expect(cerah.every((k) => k.gaya === 'CERAH')).toBe(true);
    expect(rata(redam)).toBeLessThan(rata(cerah) * 0.8);
  });

  it('tanpa pilihan gaya, galeri memuat keduanya', () => {
    const galeri = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG });
    expect(new Set(galeri.map((k) => k.gaya))).toEqual(new Set(['CERAH', 'REDAM']));
  });

  it('gaya redam tetap mengikuti jumlah tinta dan kain terang', () => {
    for (const n of [1, 2, 3, 5, 6])
      for (const kain of [HITAM, PUTIH, BLUE_SURF]) {
        const galeri = galeriKomposisi({ kainHex: kain, katalog: KATALOG, jumlah: n, gaya: 'REDAM' });
        expect(galeri.length, `${n} tinta di ${kain}`).toBeGreaterThanOrEqual(3);
        for (const k of galeri) {
          expect(k.tinta).toHaveLength(n);
          periksaBentuk(k);
          periksaKeterbacaan(k, kain);
        }
      }
  });
});

describe('galeriKomposisi — sumber aksen dan acak', () => {
  // Warna yang laku di toko (earth tone): mocca, army, terracotta, mustard.
  const LARIS = ['#9b7b62', '#535a3c', '#b0573a', '#d0a13a'];
  const labSumber = LARIS.map(hexKeLab);

  it('aksen diambil dari sumber yang diberikan, bukan dari daftar bawaan', () => {
    const galeri = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG, aksen: LARIS, gaya: 'CERAH' });
    expect(galeri.length).toBeGreaterThanOrEqual(4);
    for (const k of galeri) {
      periksaBentuk(k);
      periksaKeterbacaan(k, HITAM);
      for (const t of k.tinta.filter((x) => x.peran === 'AKSEN')) {
        const dekat = Math.min(...labSumber.map((l) => deltaE2000(l, hexKeLab(t.hex))));
        expect(dekat, `${k.pola} ${t.hex}`).toBeLessThan(15);
      }
    }
    expect(galeri.some((k) => k.tinta.some((t) => t.kode === '375 C'))).toBe(false);
  });

  it('aksen yang sewarna dengan kain dilewati — kaos army tidak diberi tinta army', () => {
    const galeri = galeriKomposisi({ kainHex: '#535a3c', katalog: KATALOG, aksen: LARIS });
    for (const k of galeri)
      for (const t of k.tinta.filter((x) => x.peran === 'AKSEN')) expect(deltaE2000(hexKeLab(t.hex), hexKeLab('#535a3c'))).toBeGreaterThan(10);
  });

  it('acak memberi susunan lain, tetap bisa dicetak; tanpa acak hasilnya tetap', () => {
    const tanpa = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG });
    expect(galeriKomposisi({ kainHex: HITAM, katalog: KATALOG, acak: 0 })).toEqual(tanpa);
    const id = (g: Komposisi[]) => g.map((k) => k.id).join('|');
    const set = new Set([tanpa, ...[1, 2, 3].map((acak) => galeriKomposisi({ kainHex: HITAM, katalog: KATALOG, acak }))].map(id));
    expect(set.size).toBe(4);
    for (const acak of [1, 2, 3])
      for (const k of galeriKomposisi({ kainHex: HITAM, katalog: KATALOG, acak, jumlah: 4 })) {
        expect(k.tinta).toHaveLength(4);
        periksaBentuk(k);
        periksaKeterbacaan(k, HITAM);
      }
  });
});

describe('galeriKomposisi — kain berwarna', () => {
  it('mengambil aksen dari rona kain, termasuk seberangnya', () => {
    const galeri = galeriKomposisi({ kainHex: BLUE_SURF, katalog: KATALOG });
    expect(galeri.length).toBeGreaterThanOrEqual(6);
    for (const k of galeri) {
      periksaBentuk(k);
      periksaKeterbacaan(k, BLUE_SURF);
    }
    const seberang = (rona(BLUE_SURF) + 180) % 360;
    const aksen = galeri.flatMap((k) => k.tinta.filter((t) => t.peran === 'AKSEN').map((t) => t.hex));
    expect(aksen.some((h) => jarakRona(rona(h), seberang) < 60)).toBe(true);
  });
});

describe('galeriKomposisi — kunci satu warna', () => {
  it('warna berpigmen yang dikunci ada di setiap komposisi, persis', () => {
    const galeri = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG, kunciHex: '#A0D513' });
    expect(galeri.length).toBeGreaterThanOrEqual(4);
    for (const k of galeri) {
      periksaBentuk(k);
      const kunci = k.tinta.find((t) => t.hex === '#a0d513');
      expect(kunci, k.pola).toBeDefined();
      expect(kunci!.kode).toBe('375 C');
      expect(kunci!.dikunci).toBe(true);
    }
  });

  it('warna netral yang dikunci menjadi netralnya, aksennya berganti-ganti', () => {
    const galeri = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG, kunciHex: '#f3eade' });
    expect(galeri.length).toBeGreaterThanOrEqual(4);
    for (const k of galeri) expect(k.tinta.find((t) => t.hex === '#f3eade')?.peran).toBe('NETRAL');
    const aksen = new Set(galeri.flatMap((k) => k.tinta.filter((t) => t.peran === 'AKSEN').map((t) => t.kode)));
    expect(aksen.size).toBeGreaterThanOrEqual(3);
  });
});

describe('galeriKomposisi — kunci beberapa tinta', () => {
  const SUMMER_SAND = '#d6cbba';
  const BLACK_4 = '#32281f';
  const C4231 = '#645e50';
  const MERAH = '#c8102e';
  /** Seberapa menonjol tinta bebas: jarak terkecilnya ke kain dan ke tinta lain. */
  const tonjol = (k: Komposisi) =>
    Math.min(
      ...k.tinta.flatMap((x, i) =>
        x.dikunci ? [] : [Math.min(...[SUMMER_SAND, ...k.tinta.filter((_, j) => j !== i).map((y) => y.hex)].map((h) => deltaE2000(hexKeLab(h), hexKeLab(x.hex))))],
      ),
    );

  it('tinta terkunci tetap di posisi dan porsinya; tinta 10% diisi aksen yang paling menonjol dulu', () => {
    for (const gaya of ['CERAH', 'REDAM'] as const) {
      const galeri = galeriKomposisi({ kainHex: SUMMER_SAND, katalog: KATALOG, jumlah: 3, kunciHex: [BLACK_4, C4231], gaya });
      expect(galeri.length, gaya).toBeGreaterThanOrEqual(3);
      for (const k of galeri) {
        expect(k.tinta.map((x) => [x.hex, x.porsi, x.dikunci ?? false])).toEqual([
          [BLACK_4, 60, true],
          [C4231, 30, true],
          [k.tinta[2].hex, 10, false],
        ]);
        expect(k.tinta.map((x) => x.peran)).toEqual(['NETRAL', 'NETRAL', 'AKSEN']);
        periksaKeterbacaan(k, SUMMER_SAND);
      }
      const skor = galeri.map(tonjol);
      expect(skor, gaya).toEqual([...skor].sort((a, b) => b - a));
    }
  });

  it('sumber aksen tetap dihormati: tinta bebas berasal dari warna sumbernya', () => {
    const galeri = galeriKomposisi({ kainHex: SUMMER_SAND, katalog: KATALOG, jumlah: 3, kunciHex: [BLACK_4, C4231], gaya: 'CERAH', aksen: [MERAH, '#2956a8', '#f36f21'] });
    expect(galeri.length).toBe(3);
    for (const k of galeri) {
      const dekat = Math.min(...[MERAH, '#2956a8', '#f36f21'].map((h) => jarakRona(rona(h), rona(k.tinta[2].hex))));
      expect(dekat).toBeLessThan(20);
    }
  });

  it('kunci yang melebihi jumlah tinta dikurangi satu diabaikan — selalu ada satu tinta yang direkomendasikan', () => {
    const galeri = galeriKomposisi({ kainHex: SUMMER_SAND, katalog: KATALOG, jumlah: 3, kunciHex: [BLACK_4, C4231, MERAH] });
    expect(galeri.length).toBeGreaterThan(0);
    for (const k of galeri) expect(k.tinta.map((x) => x.dikunci ?? false)).toEqual([true, true, false]);
  });

  it('lima tinta: dua terkunci di atas, lalu aksen, aksen kedua, dan tone-on-tone', () => {
    const galeri = galeriKomposisi({ kainHex: SUMMER_SAND, katalog: KATALOG, jumlah: 5, kunciHex: [BLACK_4, C4231], gaya: 'CERAH' });
    expect(galeri.length).toBeGreaterThan(0);
    for (const k of galeri) {
      expect(k.tinta.map((x) => x.peran)).toEqual(['NETRAL', 'NETRAL', 'AKSEN', 'AKSEN_2', 'NADA']);
      expect(k.tinta.map((x) => x.porsi)).toEqual(PORSI_AWAL[5]);
      periksaKeterbacaan(k, SUMMER_SAND);
    }
  });

  it('aksen yang dikunci ikut dihitung: tinta bebasnya menjadi aksen kedua', () => {
    const galeri = galeriKomposisi({ kainHex: SUMMER_SAND, katalog: KATALOG, jumlah: 3, kunciHex: [BLACK_4, MERAH], gaya: 'CERAH' });
    expect(galeri.length).toBeGreaterThan(0);
    for (const k of galeri) expect(k.tinta.map((x) => x.peran)).toEqual(['NETRAL', 'AKSEN', 'AKSEN_2']);
  });

  it('dua tinta dengan dua kunci sama dengan mengunci yang pertama saja', () => {
    expect(galeriKomposisi({ kainHex: SUMMER_SAND, katalog: KATALOG, jumlah: 2, kunciHex: [MERAH, BLACK_4] })).toEqual(
      galeriKomposisi({ kainHex: SUMMER_SAND, katalog: KATALOG, jumlah: 2, kunciHex: MERAH }),
    );
  });
});

describe('galeriKomposisi — tinta khusus', () => {
  it('rekomendasi tidak pernah membulatkan ke tinta metalik atau neon', () => {
    for (const kainHex of ['#d6cbba', HITAM, PUTIH, BLUE_SURF, '#5b3a29']) {
      for (const kunciHex of [null, '#a0d513', ['#32281f', '#645e50']]) {
        for (const jumlah of [1, 3, 6]) {
          for (const k of galeriKomposisi({ kainHex, katalog: KATALOG, jumlah, kunciHex })) {
            for (const t of k.tinta) if (!t.dikunci) expect(t.kode && pantoneKhusus(t.kode), `${kainHex} ${k.id}`).toBeFalsy();
          }
        }
      }
    }
  });

  it('tinta metalik yang dikunci sendiri tetap dipakai dan tetap bernama kodenya', () => {
    const galeri = galeriKomposisi({ kainHex: '#d6cbba', katalog: KATALOG, jumlah: 3, kunciHex: ['#32281f', '#ab9f90'] });
    expect(galeri.length).toBeGreaterThan(0);
    for (const k of galeri) expect(k.tinta[1]).toMatchObject({ hex: '#ab9f90', kode: '10352 C', dikunci: true });
  });
});

describe('tiruKomposisi', () => {
  // Desain referensi: kaos hitam, huruf lime, krem, dan angka biru-slate tone-on-tone.
  const referensi = [
    { hex: HITAM, bagian: 0.55 },
    { hex: '#a0d513', bagian: 0.18 },
    { hex: '#e6e1cc', bagian: 0.17 },
    { hex: '#34465a', bagian: 0.1 },
  ];

  it('membaca peran tiap warna dan porsinya dari luas di gambar; kain referensi = warna terluas', () => {
    const k = tiruKomposisi({ gambar: referensi, kainHex: HITAM, katalog: KATALOG, jumlah: 3 })!;
    expect(k.pola).toBe('DARI_GAMBAR');
    expect(k.tinta.map((t) => t.peran)).toEqual(['AKSEN', 'NETRAL', 'NADA']);
    expect(k.tinta.map((t) => t.porsi)).toEqual([40, 38, 22]);
  });

  it('di kain yang sama, warnanya kembali mendekati referensi (dibulatkan ke Pantone C)', () => {
    const k = tiruKomposisi({ gambar: referensi, kainHex: HITAM, katalog: KATALOG })!;
    referensi.slice(1).forEach((r, i) => {
      expect(deltaE2000(hexKeLab(k.tinta[i].hex), hexKeLab(r.hex))).toBeLessThan(6);
      expect(k.tinta[i].kode).not.toBeNull();
    });
  });

  it('di kain lain, peran dan porsinya tetap, warnanya disesuaikan supaya terbaca', () => {
    const k = tiruKomposisi({ gambar: referensi, kainHex: BLUE_SURF, katalog: KATALOG })!;
    expect(k.tinta.map((t) => t.peran)).toEqual(['AKSEN', 'NETRAL', 'NADA']);
    expect(k.tinta.map((t) => t.porsi)).toEqual([40, 38, 22]);
    periksaBentuk(k);
    periksaKeterbacaan(k, BLUE_SURF);
  });

  it('dibatasi ke jumlah tinta yang dipakai: warna terluas didahulukan, porsinya dihitung ulang', () => {
    const k = tiruKomposisi({ gambar: referensi, kainHex: HITAM, katalog: KATALOG, jumlah: 2 })!;
    expect(k.tinta.map((t) => t.peran)).toEqual(['AKSEN', 'NETRAL']);
    expect(k.tinta.map((t) => t.porsi)).toEqual([51, 49]);
  });

  it('mengabaikan remah warna di bawah 1% dan menolak gambar tanpa tinta', () => {
    const k = tiruKomposisi({ gambar: [...referensi, { hex: '#ff00ff', bagian: 0.005 }], kainHex: HITAM, katalog: KATALOG })!;
    expect(k.tinta).toHaveLength(3);
    expect(tiruKomposisi({ gambar: [{ hex: HITAM, bagian: 1 }], kainHex: HITAM, katalog: KATALOG })).toBeNull();
  });
});

describe('bacaKomposisiDesain dan variasiDesain', () => {
  // Desain di kaos krem: teks hitam, garis putih, bayangan taupe tone-on-tone, sedikit aksen zaitun.
  const KREM = '#cfc8b6';
  const desain = [
    { hex: KREM, bagian: 0.55 },
    { hex: '#1a1a1a', bagian: 0.18 },
    { hex: '#f3f1ea', bagian: 0.12 },
    { hex: '#a39e8e', bagian: 0.1 },
    { hex: '#7d8a2e', bagian: 0.05 },
  ];
  const analisis = bacaKomposisiDesain(desain)!;

  it('membaca kain, peran, dan porsi tiap tinta — hitam dan putih tetap netral walau dekat dengan kain', () => {
    expect(analisis.kain).toEqual({ hex: KREM, bagian: 0.55 });
    expect(analisis.tinta.map((t) => t.peran)).toEqual(['NETRAL', 'NETRAL', 'NADA', 'AKSEN']);
    expect(analisis.tinta.map((t) => t.porsi)).toEqual([40, 27, 22, 11]);
  });

  it('di kain aslinya, warna desain kembali (dibulatkan ke Pantone C)', () => {
    const k = variasiDesain({ analisis, kainHex: KREM, katalog: KATALOG })!;
    expect(k.tinta.map((t) => t.peran)).toEqual(['NETRAL', 'NETRAL', 'NADA', 'AKSEN']);
    desain.slice(1).forEach((d, i) => expect(deltaE2000(hexKeLab(k.tinta[i].hex), hexKeLab(d.hex)), d.hex).toBeLessThan(8));
  });

  it('di kaos hitam, teks hitam berbalik terang dan semua tinta tetap terlihat', () => {
    const k = variasiDesain({ analisis, kainHex: HITAM, katalog: KATALOG })!;
    expect(k.tinta.map((t) => t.peran)).toEqual(['NETRAL', 'NETRAL', 'NADA', 'AKSEN']);
    expect(L(k.tinta[0].hex)).toBeGreaterThan(75);
    for (const t of k.tinta) expect(Math.abs(L(t.hex) - L(HITAM)), t.hex).toBeGreaterThanOrEqual(5);
    periksaBentuk(k);
  });

  it('aksen bisa diganti tanpa menyentuh tinta lain', () => {
    const asli = variasiDesain({ analisis, kainHex: KREM, katalog: KATALOG })!;
    const k = variasiDesain({ analisis, kainHex: KREM, katalog: KATALOG, aksenBaru: '#b0573a' })!;
    expect(k.tinta.slice(0, 3).map((t) => t.hex)).toEqual(asli.tinta.slice(0, 3).map((t) => t.hex));
    expect(jarakRona(rona(k.tinta[3].hex), rona('#b0573a'))).toBeLessThan(25);
    expect(k.id).not.toBe(asli.id);
  });

  /*
   * Desain kecil dengan huruf tipis: teks hitam hanya 1% gambar, sisanya
   * tersebar sebagai warna tepian — abu di antara hitam dan kain, krem muda di
   * antara putih dan kain. Tepian itu bukan tinta; ia digabung ke tintanya,
   * supaya teks hitam tetap terbaca sebagai hitam.
   */
  it('menggabungkan warna tepian ke tintanya, jadi huruf hitam yang tipis tetap terbaca hitam', () => {
    const a = bacaKomposisiDesain([
      { hex: '#c9c0b0', bagian: 0.83 },
      { hex: '#ab9e8e', bagian: 0.081 },
      { hex: '#fdfbf6', bagian: 0.035 },
      { hex: '#6a6358', bagian: 0.019 },
      { hex: '#ded8ce', bagian: 0.017 },
      { hex: '#3a342c', bagian: 0.011 },
      { hex: '#0c0705', bagian: 0.007 },
    ])!;
    expect(a.tinta.map((t) => t.hex)).toEqual(['#ab9e8e', '#fdfbf6', '#0c0705']);
    expect(a.tinta.map((t) => t.peran)).toEqual(['NADA', 'NETRAL', 'NETRAL']);
    expect(a.tinta[2].bagian).toBeCloseTo(0.037, 6);
    expect(a.tinta[1].bagian).toBeCloseTo(0.052, 6);
  });

  it('membaca desain krem yang sama setelah profil warnanya diterapkan peramban', () => {
    const a = bacaKomposisiDesain([
      { hex: '#d4c8b7', bagian: 0.8345 },
      { hex: '#bca999', bagian: 0.0766 },
      { hex: '#fbf8f3', bagian: 0.0416 },
      { hex: '#72675b', bagian: 0.018 },
      { hex: '#9f9589', bagian: 0.0125 },
      { hex: '#3f362b', bagian: 0.0094 },
      { hex: '#0b0603', bagian: 0.0074 },
    ])!;
    expect(a.tinta.map((t) => [t.hex, t.peran])).toEqual([
      ['#bca999', 'NADA'],
      ['#0b0603', 'NETRAL'],
      ['#fbf8f3', 'NETRAL'],
    ]);
    expect(a.tinta[1].bagian).toBeCloseTo(0.0473, 6);
  });

  it('tone-on-tone kecil yang dekat kain tidak ikut digabung ke hitam', () => {
    const a = bacaKomposisiDesain([
      { hex: '#c9c0b0', bagian: 0.9 },
      { hex: '#0c0705', bagian: 0.08 },
      { hex: '#ab9e8e', bagian: 0.02 },
    ])!;
    expect(a.tinta.map((t) => [t.hex, t.peran])).toEqual([
      ['#0c0705', 'NETRAL'],
      ['#ab9e8e', 'NADA'],
    ]);
  });

  it('gambar tanpa tinta tidak bisa dibaca', () => {
    expect(bacaKomposisiDesain([{ hex: KREM, bagian: 1 }])).toBeNull();
  });
});
