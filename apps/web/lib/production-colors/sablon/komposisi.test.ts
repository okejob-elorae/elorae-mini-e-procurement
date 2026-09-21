import { describe, expect, it } from 'vitest';
import dataC from '../palet/pantone-c.json';
import { deltaE2000, hexKeLab, pantoneKhusus, siapkanKatalog } from '../palet/pantone';
import { bacaKomposisiDesain, variasiDesain, type Komposisi, type PeranKomposisi } from './komposisi';

const KATALOG = siapkanKatalog('C', dataC as [string, string][]);
const HITAM = '#101010';
const BLUE_SURF = '#90a8a4';
const PUTIH = '#f7f7f5';

const L = (hex: string) => hexKeLab(hex)[0];
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
      NETRAL: [20, 100],
      NADA: [5, 28],
    };
    const [min, maks] = syarat[t.peran];
    expect(beda, `${k.id} ${t.peran} ${t.hex} di ${kain}`).toBeGreaterThanOrEqual(min);
    expect(beda, `${k.id} ${t.peran} ${t.hex} di ${kain}`).toBeLessThanOrEqual(maks);
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

/** Desain referensi dibaca, lalu disusun di kain lain — jalan yang dipakai kartu komposisi desain. */
function diKain(gambar: readonly { hex: string; bagian: number }[], kainHex: string, jumlah = 6): Komposisi | null {
  const analisis = bacaKomposisiDesain(gambar, jumlah);
  return analisis ? variasiDesain({ analisis, kainHex, katalog: KATALOG }) : null;
}

describe('desain referensi di kain lain', () => {
  // Desain referensi: kaos hitam, huruf lime, krem, dan angka biru-slate tone-on-tone.
  const referensi = [
    { hex: HITAM, bagian: 0.55 },
    { hex: '#a0d513', bagian: 0.18 },
    { hex: '#e6e1cc', bagian: 0.17 },
    { hex: '#34465a', bagian: 0.1 },
  ];

  it('membaca peran tiap warna dan porsinya dari luas di gambar; kain referensi = warna terluas', () => {
    const k = diKain(referensi, HITAM, 3)!;
    expect(k.tinta.map((t) => t.peran)).toEqual(['AKSEN', 'NETRAL', 'NADA']);
    expect(k.tinta.map((t) => t.porsi)).toEqual([40, 38, 22]);
  });

  it('di kain yang sama, warnanya kembali mendekati referensi (dibulatkan ke Pantone C)', () => {
    const k = diKain(referensi, HITAM)!;
    referensi.slice(1).forEach((r, i) => {
      expect(deltaE2000(hexKeLab(k.tinta[i].hex), hexKeLab(r.hex))).toBeLessThan(6);
      expect(k.tinta[i].kode).not.toBeNull();
    });
  });

  it('di kain lain, peran dan porsinya tetap, warnanya disesuaikan supaya terbaca', () => {
    const k = diKain(referensi, BLUE_SURF)!;
    expect(k.tinta.map((t) => t.peran)).toEqual(['AKSEN', 'NETRAL', 'NADA']);
    expect(k.tinta.map((t) => t.porsi)).toEqual([40, 38, 22]);
    periksaBentuk(k);
    periksaKeterbacaan(k, BLUE_SURF);
  });

  it('dibatasi ke jumlah tinta yang dipakai: warna terluas didahulukan, porsinya dihitung ulang', () => {
    const k = diKain(referensi, HITAM, 2)!;
    expect(k.tinta.map((t) => t.peran)).toEqual(['AKSEN', 'NETRAL']);
    expect(k.tinta.map((t) => t.porsi)).toEqual([51, 49]);
  });

  it('mengabaikan remah warna di bawah 1% dan menolak gambar tanpa tinta', () => {
    const k = diKain([...referensi, { hex: '#ff00ff', bagian: 0.005 }], HITAM)!;
    expect(k.tinta).toHaveLength(3);
    expect(diKain([{ hex: HITAM, bagian: 1 }], HITAM)).toBeNull();
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

  it('tidak pernah membulatkan ke tinta metalik atau neon', () => {
    for (const kainHex of [KREM, HITAM, PUTIH, BLUE_SURF, '#5b3a29']) {
      const k = variasiDesain({ analisis, kainHex, katalog: KATALOG });
      for (const t of k?.tinta ?? []) expect(t.kode && pantoneKhusus(t.kode), `${kainHex} ${t.kode}`).toBeFalsy();
    }
  });

  it('gambar tanpa tinta tidak bisa dibaca', () => {
    expect(bacaKomposisiDesain([{ hex: KREM, bagian: 1 }])).toBeNull();
  });
});
