import { describe, expect, it } from 'vitest';
import { deltaE2000, hexKeLab } from '../palet/pantone';
import { hexKeHsb, hexKeRgb } from '../palet/warna';
import { presetTintaPantone } from './tinta-dasar';
import { bagiGram, campurTinta, resepCampur } from './campur';

const KUNING = '#ffdc15';
const BIRU = '#0086c9';
const MERAH = '#fb4439';
const PUTIH = '#ffffff';
const HITAM = '#2d2927';
const RUBINE = '#d01058';
const REFLEX = '#001d8a';

const jarak = (a: string, b: string) => deltaE2000(hexKeLab(a), hexKeLab(b));

describe('campurTinta', () => {
  it('memberi warna tinta itu sendiri kalau hanya satu tinta', () => {
    for (const hex of [KUNING, BIRU, MERAH, RUBINE]) {
      expect(jarak(campurTinta([hex], [100]), hex), hex).toBeLessThan(0.5);
    }
  });

  /*
   * Inilah alasan campuran tidak dirata-rata di RGB: rata-rata cahaya kuning
   * dan biru adalah abu-abu, sedangkan tinta kuning dan biru menjadi hijau.
   * Model Kubelka-Munk menjumlahkan daya serap tinta, bukan cahayanya.
   */
  it('membuat kuning dan biru menjadi hijau, bukan abu-abu', () => {
    const { r, g, b } = hexKeRgb(campurTinta([KUNING, BIRU], [50, 50]));
    expect(g).toBeGreaterThan(r + 40);
    expect(g).toBeGreaterThan(b + 40);
  });

  it('mencerahkan dengan putih dan menggelapkan dengan hitam', () => {
    const L = (hex: string) => hexKeLab(hex)[0];
    expect(L(campurTinta([MERAH, PUTIH], [50, 50]))).toBeGreaterThan(L(MERAH) + 3);
    expect(L(campurTinta([MERAH, HITAM], [80, 20]))).toBeLessThan(L(MERAH) - 10);
  });

  /*
   * Tes yang sebelumnya lolos sambil membiarkan resep mustahil. Dengan batas
   * pantulan 0,05%, satu persen Green C mengubah putih menjadi cyan pekat,
   * dan hijau tua "dicampur" dari 85% Warm Red.
   */
  it('membuat sedikit tinta berwarna di banyak putih tetap pucat', () => {
    const [, a, b] = hexKeLab(campurTinta([PUTIH, '#00aa84'], [99, 1]));
    expect(Math.hypot(a, b)).toBeLessThan(25);
  });

  it('tidak mencampur hijau tua dari tinta yang sebagian besar merah', () => {
    const tinta = presetTintaPantone();
    const target = '#154036';
    const r = resepCampur(target, tinta.map((t) => t.hex))!;
    const utama = tinta[r.bagian[0].indeks];
    const ronaUtama = hexKeHsb(utama.hex).h;
    const ronaTarget = hexKeHsb(target).h;
    const selisih = Math.min(Math.abs(ronaUtama - ronaTarget), 360 - Math.abs(ronaUtama - ronaTarget));
    expect(utama.nama === 'Black' || selisih <= 90, `tinta utama ${utama.nama}`).toBe(true);
  });

  it('tidak bergantung pada skala bobot', () => {
    expect(campurTinta([KUNING, BIRU], [1, 3])).toBe(campurTinta([KUNING, BIRU], [25, 75]));
  });
});

describe('resepCampur', () => {
  const DASAR = [KUNING, BIRU, MERAH, PUTIH, HITAM, RUBINE, REFLEX];

  it('memakai satu tinta penuh kalau targetnya tinta itu sendiri', () => {
    const r = resepCampur(RUBINE, DASAR)!;
    expect(r.bagian).toEqual([{ indeks: 5, persen: 100 }]);
    expect(r.deltaE).toBeLessThan(0.5);
  });

  /*
   * Target dibuat dengan model yang sama, jadi resep yang benar PASTI ada.
   * Kalau pencarinya tidak menemukannya kembali, yang salah pencarinya —
   * bukan modelnya.
   */
  it('menemukan kembali campuran yang dibuat dengan model yang sama', () => {
    const target = campurTinta([KUNING, REFLEX, PUTIH], [30, 20, 50]);
    const r = resepCampur(target, DASAR)!;
    expect(r.deltaE).toBeLessThan(1);
    const bobot = Object.fromEntries(r.bagian.map((b) => [DASAR[b.indeks], b.persen]));
    expect(Math.abs((bobot[KUNING] ?? 0) - 30)).toBeLessThanOrEqual(4);
    expect(Math.abs((bobot[REFLEX] ?? 0) - 20)).toBeLessThanOrEqual(4);
    expect(Math.abs((bobot[PUTIH] ?? 0) - 50)).toBeLessThanOrEqual(4);
  });

  it('selalu berjumlah 100, dalam kelipatan 0,1%, urut dari yang terbanyak', () => {
    for (const target of ['#5a8f3c', '#c77dba', '#2f4f6f', '#f2c94c', '#8b5a2b']) {
      const r = resepCampur(target, DASAR)!;
      expect(r.bagian.reduce((s, b) => s + b.persen, 0), target).toBeCloseTo(100, 9);
      expect(r.bagian.every((b) => b.persen >= 0.1 && Math.abs(b.persen * 10 - Math.round(b.persen * 10)) < 1e-9), target).toBe(true);
      const urut = r.bagian.map((b) => b.persen);
      expect(urut, target).toEqual([...urut].sort((a, b) => b - a));
    }
  });

  it('mematuhi batas jumlah tinta per resep', () => {
    for (const maks of [1, 2, 3, 4]) {
      const r = resepCampur('#7a6fa8', DASAR, maks)!;
      expect(r.bagian.length).toBeLessThanOrEqual(maks);
    }
  });

  /*
   * Resep lima tinta yang hanya 0,3 ΔE lebih baik dari resep dua tinta
   * adalah resep yang lebih buruk bagi tukang sablon: lebih banyak
   * menimbang, lebih banyak peluang salah.
   */
  it('memilih lebih sedikit tinta kalau tambahannya nyaris tidak membantu', () => {
    const r = resepCampur(campurTinta([MERAH, PUTIH], [60, 40]), [MERAH, PUTIH, '#fa4a3c', '#fefefe'], 4)!;
    expect(r.bagian.length).toBe(2);
  });

  /*
   * Warna pucat adalah putih ditambah setetes tinta. Dengan takaran persen
   * bulat dan pencarian kasar per 10%, 9021 C hanya bisa "dibuat" dari putih
   * murni (ΔE 5,6) — resep yang tampak rapi tetapi salah warna.
   */
  it('membuat warna pucat dari putih dan tetesan tinta', () => {
    const tinta = presetTintaPantone();
    for (const target of ['#f1e9e7', '#dde3ee', '#aeecdf']) {
      const r = resepCampur(target, tinta.map((t) => t.hex))!;
      expect(r.deltaE, target).toBeLessThan(2);
      expect(tinta[r.bagian[0].indeks].nama, target).toBe('Putih');
      expect(r.bagian.length, target).toBeGreaterThan(1);
    }
  });

  it('melaporkan jarak besar kalau tinta dasar tidak bisa mencapainya', () => {
    const r = resepCampur('#22dd44', [MERAH, PUTIH])!;
    expect(r.deltaE).toBeGreaterThan(10);
  });

  it('mengembalikan null tanpa tinta dasar', () => {
    expect(resepCampur('#123456', [])).toBeNull();
  });
});

describe('bagiGram', () => {
  it('membagi berat tepat habis, tanpa kelebihan atau kekurangan satu gram', () => {
    expect(bagiGram(1000, [37, 32, 31])).toEqual([370, 320, 310]);
    for (const berat of [1, 7, 250, 333, 1000, 1234]) {
      for (const persen of [[100], [50, 50], [33, 33, 34], [62, 23, 15], [40, 30, 20, 10]]) {
        const g = bagiGram(berat, persen);
        expect(g.reduce((s, x) => s + x, 0), `${berat} ${persen}`).toBe(berat);
        g.forEach((x, i) => expect(Math.abs(x - (berat * persen[i]) / 100), `${berat} ${persen}`).toBeLessThan(1));
      }
    }
  });

  it('memberi nol untuk berat nol', () => {
    expect(bagiGram(0, [60, 40])).toEqual([0, 0]);
  });
});
