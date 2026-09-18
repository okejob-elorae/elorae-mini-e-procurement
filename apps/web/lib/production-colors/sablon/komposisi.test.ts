import { describe, expect, it } from 'vitest';
import dataC from '../palet/pantone-c.json';
import { deltaE2000, hexKeLab, siapkanKatalog } from '../palet/pantone';
import { galeriKomposisi, tiruKomposisi, type Komposisi, type PeranKomposisi } from './komposisi';

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

describe('galeriKomposisi — kain netral (hitam)', () => {
  const galeri = galeriKomposisi({ kainHex: HITAM, katalog: KATALOG });

  it('memberi beberapa pilihan siap pakai, masing-masing bisa dicetak', () => {
    expect(galeri.length).toBeGreaterThanOrEqual(6);
    expect(galeri.length).toBeLessThanOrEqual(9);
    expect(new Set(galeri.map((k) => k.id)).size).toBe(galeri.length);
    for (const k of galeri) {
      periksaBentuk(k);
      periksaKeterbacaan(k, HITAM);
    }
  });

  it('memuat pola streetwear: aksen + netral + tone-on-tone', () => {
    const k = galeri.find((x) => x.pola === 'AKSEN_NETRAL_NADA');
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

describe('tiruKomposisi', () => {
  // Desain referensi: kaos hitam, huruf lime, krem, dan angka biru-slate tone-on-tone.
  const referensi = [
    { hex: HITAM, bagian: 0.55 },
    { hex: '#a0d513', bagian: 0.18 },
    { hex: '#e6e1cc', bagian: 0.17 },
    { hex: '#34465a', bagian: 0.1 },
  ];

  it('membaca peran tiap warna dan porsinya dari luas di gambar; kain referensi = warna terluas', () => {
    const k = tiruKomposisi({ gambar: referensi, kainHex: HITAM, katalog: KATALOG })!;
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

  it('mengabaikan remah warna di bawah 2% dan menolak gambar tanpa tinta', () => {
    const k = tiruKomposisi({ gambar: [...referensi, { hex: '#ff00ff', bagian: 0.01 }], kainHex: HITAM, katalog: KATALOG })!;
    expect(k.tinta).toHaveLength(3);
    expect(tiruKomposisi({ gambar: [{ hex: HITAM, bagian: 1 }], kainHex: HITAM, katalog: KATALOG })).toBeNull();
  });
});
