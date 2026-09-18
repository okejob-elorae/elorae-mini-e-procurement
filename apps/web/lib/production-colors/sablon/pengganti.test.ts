import { describe, expect, it } from 'vitest';
import dataC from '../palet/pantone-c.json';
import { langkahHarmoni } from '../palet/harmoni';
import { rasioKontras } from '../palet/kontras';
import { deltaE2000, hexKeLab, pantoneKhusus, siapkanKatalog } from '../palet/pantone';
import { hexKeHsb } from '../palet/warna';
import { KELUARGA_WARNA, calonUntukKain, saranBerikutnya, saranPengganti, type SaranPengganti } from './pengganti';

const KATALOG = siapkanKatalog('C', dataC as [string, string][]);
const SAND = '#d6cbba';
const HITAM = '#101010';
const TINTA = ['#546fcd', '#98907a', '#5c5141'];

const kroma = (hex: string) => {
  const [, a, b] = hexKeLab(hex);
  return Math.hypot(a, b);
};
const jarakRona = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

function saranDi(kainHex: string, hex = TINTA, aturanUtama: Parameters<typeof saranPengganti>[0]['aturanUtama'] = 'ANALOGOUS') {
  return saranPengganti({ calon: calonUntukKain(kainHex, KATALOG), hex, indeks: 2, aturanUtama });
}

describe('saranPengganti — variasi jenis warna', () => {
  it('memberi beberapa jenis warna sekaligus, termasuk neon dan solid, bergiliran antarjenis', () => {
    const s = saranDi(SAND);
    const jenis = new Set(s.map((x) => x.keluarga));
    expect(jenis.has('SOLID')).toBe(true);
    expect(jenis.has('NEON')).toBe(true);
    expect(jenis.size).toBeGreaterThanOrEqual(4);
    // Putaran pertama "Warna lain": setiap klik jenis yang berbeda.
    const putaranPertama = s.slice(0, jenis.size).map((x) => x.keluarga);
    expect(new Set(putaranPertama).size).toBe(jenis.size);
    expect(putaranPertama).toEqual(KELUARGA_WARNA.filter((k) => jenis.has(k)));
    expect(new Set(s.map((x) => x.kode)).size).toBe(s.length);
  });

  it('jenisnya sesuai namanya: neon dan metalik tinta khususnya, sisanya tinta biasa dengan sifat jenisnya', () => {
    for (const x of [...saranDi(SAND), ...saranDi(HITAM)]) {
      const [L] = hexKeLab(x.hex);
      const C = kroma(x.hex);
      if (x.keluarga === 'NEON') expect(pantoneKhusus(x.kode), x.kode).toBe('NEON');
      else if (x.keluarga === 'METALIK') expect(pantoneKhusus(x.kode), x.kode).toBe('METALIK');
      else {
        expect(pantoneKhusus(x.kode), x.kode).toBeNull();
        if (x.keluarga === 'PASTEL') expect(L, x.kode).toBeGreaterThanOrEqual(75);
        if (x.keluarga === 'GELAP') expect(L, x.kode).toBeLessThan(35);
        if (x.keluarga === 'SOLID') expect(C, x.kode).toBeGreaterThanOrEqual(35);
        if (x.keluarga === 'REDAM') expect(C, x.kode).toBeLessThan(35);
      }
    }
  });

  it('semuanya masuk dengan kain: rona menurut aturan harmoni terhadap kain, terbaca, dan tidak kembar dengan tinta lain', () => {
    const ronaKain = hexKeHsb(SAND).h;
    const s = saranDi(SAND);
    expect(s.length).toBeGreaterThanOrEqual(20);
    for (const x of s) {
      expect(rasioKontras(x.hex, SAND), x.kode).toBeGreaterThanOrEqual(1.8);
      for (const h of TINTA.slice(0, 2)) expect(deltaE2000(hexKeLab(h), hexKeLab(x.hex)), x.kode).toBeGreaterThanOrEqual(10);
      const geser = [...new Set(langkahHarmoni(x.aturan)!.map((l) => l.dh))].filter((dh) => dh !== 0 || x.aturan === 'MONOCHROMATIC' || x.aturan === 'SHADES');
      const dekat = Math.min(...geser.map((dh) => jarakRona(hexKeHsb(x.hex).h, ronaKain + dh)));
      expect(dekat, `${x.keluarga} ${x.aturan} ${x.kode}`).toBeLessThanOrEqual(20);
    }
  });

  it('di kain hitam neon yang menyala tersedia; di kain terang pastel tidak dipaksakan', () => {
    const hitam = saranDi(HITAM, ['#f1e7d9', '#2f4049', '#000000']);
    expect(hitam.filter((x) => x.keluarga === 'NEON').length).toBeGreaterThanOrEqual(3);
    for (const x of saranDi(SAND).filter((y) => y.keluarga === 'PASTEL')) expect(rasioKontras(x.hex, SAND)).toBeGreaterThanOrEqual(1.8);
  });

  it('dalam setiap jenis, aturan palet saat ini didahulukan', () => {
    const s = saranDi(SAND, TINTA, 'COMPLEMENTARY');
    const pertamaSolid = s.find((x) => x.keluarga === 'SOLID') as SaranPengganti;
    expect(pertamaSolid.aturan).toBe('COMPLEMENTARY');
  });

  it('tidak bergantung pada warna tinta yang sedang diganti, jadi "Warna lain" bisa terus berputar', () => {
    expect(saranDi(SAND, [TINTA[0], TINTA[1], '#ff0000'])).toEqual(saranDi(SAND));
  });

  it('aturan Custom tidak didahulukan — urutannya urutan aturan biasa', () => {
    expect(saranDi(SAND, TINTA, 'CUSTOM')[0].aturan).toBe('ANALOGOUS');
  });
});

describe('saranBerikutnya', () => {
  const d = [{ hex: '#111111' }, { hex: '#223344' }, { hex: '#ccbbaa' }];

  it('maju satu, berputar ke awal, dan mulai dari saran pertama kalau warna sekarang bukan saran', () => {
    expect(saranBerikutnya(d, '#999999')).toBe(d[0]);
    expect(saranBerikutnya(d, '#111111')).toBe(d[1]);
    expect(saranBerikutnya(d, '#CCBBAA')).toBe(d[0]);
    // Selisih pembulatan satu digit masih dianggap warna yang sama.
    expect(saranBerikutnya(d, '#223345')).toBe(d[2]);
    expect(saranBerikutnya([], '#111111')).toBeNull();
  });
});
