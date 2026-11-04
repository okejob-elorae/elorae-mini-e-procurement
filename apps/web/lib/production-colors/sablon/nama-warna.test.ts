import { describe, expect, it } from 'vitest';
import { KAMUS_WARNA, kenaliWarna, rapikanNama } from './nama-warna';

describe('kenaliWarna — nama warna varian di marketplace Indonesia', () => {
  it.each([
    ['Hitam', 'hitam'],
    ['BLACK', 'hitam'],
    ['Broken White', 'broken-white'],
    ['brokenwhite', 'broken-white'],
    ['Putih Tulang', 'broken-white'],
    ['Abu Tua', 'abu-tua'],
    ['abu-abu', 'abu'],
    ['Abu Misty', 'abu-misty'],
    ['Hijau Army', 'army'],
    ['Merah Maroon', 'maroon'],
    ['Coklat Susu', 'coksu'],
    ['Mocca', 'mocca'],
    ['Mocha', 'mocca'],
    ['Dusty Pink', 'dusty-pink'],
    ['Navy Blue', 'navy'],
    ['Biru Dongker', 'navy'],
    ['kaos polos warna Sage', 'sage'],
    ['TERRACOTTA', 'terracotta'],
    ['Oren', 'oranye'],
    ['Toska', 'tosca'],
  ])('"%s" → %s', (nama, kunci) => {
    expect(kenaliWarna(nama)?.kunci).toBe(kunci);
  });

  it('frasa terpanjang menang: "abu tua" bukan "abu", "hijau botol" bukan "hijau"', () => {
    expect(kenaliWarna('Abu Tua Polos')?.kunci).toBe('abu-tua');
    expect(kenaliWarna('Hijau Botol')?.kunci).toBe('hijau-botol');
    expect(kenaliWarna('Hijau')?.kunci).toBe('hijau');
  });

  it('nama yang tidak dikenal atau kosong menghasilkan null', () => {
    expect(kenaliWarna('Galaxy')).toBeNull();
    expect(kenaliWarna('')).toBeNull();
    expect(kenaliWarna(null)).toBeNull();
  });

  it('pemetaan manual mengalahkan kamus dan dicocokkan tanpa peduli huruf besar/tanda baca', () => {
    const manual = { [rapikanNama('Galaxy')]: '#2B2F4A', [rapikanNama('Hitam')]: '#101010' };
    expect(kenaliWarna('GALAXY!', manual)).toEqual({ kunci: 'manual:galaxy', label: 'GALAXY!', hex: '#2b2f4a', keluarga: null });
    expect(kenaliWarna('hitam', manual)?.hex).toBe('#101010');
  });

  it('setiap entri kamus punya hex sah dan alias yang tidak kembar antarwarna', () => {
    const dilihat = new Map<string, string>();
    for (const w of KAMUS_WARNA) {
      expect(w.hex, w.kunci).toMatch(/^#[0-9a-f]{6}$/);
      for (const a of w.alias) {
        const r = rapikanNama(a);
        expect(dilihat.get(r), `${a} di ${w.kunci} dan ${dilihat.get(r)}`).toBeUndefined();
        dilihat.set(r, w.kunci);
      }
    }
  });
});
