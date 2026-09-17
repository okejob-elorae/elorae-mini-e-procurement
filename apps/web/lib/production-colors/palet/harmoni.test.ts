import { describe, expect, it } from 'vitest';
import {
  ATURAN_HARMONI,
  INDEKS_DASAR,
  JUMLAH_WARNA,
  gantiHexWarna,
  geserPegangan,
  susunHarmoni,
  ubahKecerahan,
  type Hsb,
} from './harmoni';
import { hsbKeHex } from './warna';

const DASAR: Hsb = { h: 30, s: 0.8, b: 0.9 };

function selisihSudut(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
}

describe('susunHarmoni', () => {
  it('selalu memberi lima warna dengan warna dasar di tengah, apa adanya', () => {
    for (const aturan of ATURAN_HARMONI) {
      const warna = susunHarmoni(aturan, DASAR, [DASAR, DASAR, DASAR, DASAR, DASAR]);
      expect(warna).toHaveLength(JUMLAH_WARNA);
      expect(warna[INDEKS_DASAR]).toEqual(DASAR);
    }
  });

  it('tidak pernah menghasilkan dua warna kembar untuk warna dasar yang wajar', () => {
    for (const aturan of ATURAN_HARMONI) {
      if (aturan === 'CUSTOM') continue;
      const hex = susunHarmoni(aturan, DASAR, []).map(hsbKeHex);
      expect(new Set(hex).size, aturan).toBe(JUMLAH_WARNA);
    }
  });

  it('menaruh lawan komplementer tepat di seberang roda', () => {
    const warna = susunHarmoni('COMPLEMENTARY', DASAR, []);
    expect(warna.some((w) => selisihSudut(w.h, DASAR.h) === 180)).toBe(true);
  });

  it('menyebar triad sepertiga lingkaran', () => {
    const rona = new Set(susunHarmoni('TRIAD', DASAR, []).map((w) => Math.round(w.h)));
    expect(rona).toEqual(new Set([30, 150, 270]));
  });

  it('menyebar square seperempat lingkaran', () => {
    const rona = new Set(susunHarmoni('SQUARE', DASAR, []).map((w) => Math.round(w.h)));
    expect(rona).toEqual(new Set([30, 120, 210, 300]));
  });

  it('membiarkan monokromatik dan shades di satu rona', () => {
    for (const aturan of ['MONOCHROMATIC', 'SHADES'] as const) {
      const rona = new Set(susunHarmoni(aturan, DASAR, []).map((w) => w.h));
      expect(rona, aturan).toEqual(new Set([DASAR.h]));
    }
  });

  it('membuat shades hanya berbeda terangnya', () => {
    for (const w of susunHarmoni('SHADES', DASAR, [])) expect(w.s).toBe(DASAR.s);
  });

  it('tidak menyentuh warna yang ada kalau aturannya bebas', () => {
    const ada: Hsb[] = [
      { h: 1, s: 0.1, b: 0.1 },
      { h: 2, s: 0.2, b: 0.2 },
      DASAR,
      { h: 4, s: 0.4, b: 0.4 },
      { h: 5, s: 0.5, b: 0.5 },
    ];
    expect(susunHarmoni('CUSTOM', DASAR, ada)).toEqual(ada);
  });

  it('menjaga kecerahan dan kepekatan tetap di dalam 0–1', () => {
    const terang: Hsb = { h: 200, s: 1, b: 1 };
    for (const aturan of ATURAN_HARMONI) {
      for (const w of susunHarmoni(aturan, terang, [terang, terang, terang, terang, terang])) {
        expect(w.s).toBeGreaterThanOrEqual(0);
        expect(w.s).toBeLessThanOrEqual(1);
        expect(w.b).toBeGreaterThanOrEqual(0);
        expect(w.b).toBeLessThanOrEqual(1);
        expect(w.h).toBeGreaterThanOrEqual(0);
        expect(w.h).toBeLessThan(360);
      }
    }
  });
});

describe('geserPegangan', () => {
  it('memutar seluruh harmoni saat pegangan mana pun digeser', () => {
    const awal = { aturan: 'TRIAD' as const, warna: susunHarmoni('TRIAD', DASAR, []) };
    // Pegangan paling kiri berada di +120; digeser 10° searah jarum jam.
    const hasil = geserPegangan(awal, 0, awal.warna[0].h + 10, awal.warna[0].s);
    expect(hasil.aturan).toBe('TRIAD');
    expect(hasil.warna[INDEKS_DASAR].h).toBeCloseTo(40, 6);
    hasil.warna.forEach((w, i) => expect(selisihSudut(w.h, awal.warna[i].h)).toBeCloseTo(10, 6));
  });

  it('mengubah kepekatan dasar hanya lewat pegangan dasar', () => {
    const awal = { aturan: 'ANALOGOUS' as const, warna: susunHarmoni('ANALOGOUS', DASAR, []) };
    const lewatLain = geserPegangan(awal, 4, awal.warna[4].h, 0.2);
    expect(lewatLain.warna[INDEKS_DASAR].s).toBe(DASAR.s);
    const lewatDasar = geserPegangan(awal, INDEKS_DASAR, DASAR.h, 0.2);
    expect(lewatDasar.warna[INDEKS_DASAR].s).toBe(0.2);
  });

  it('hanya memindahkan satu warna kalau aturannya bebas', () => {
    const awal = { aturan: 'CUSTOM' as const, warna: susunHarmoni('TRIAD', DASAR, []) };
    const hasil = geserPegangan(awal, 1, 100, 0.5);
    expect(hasil.warna[1]).toEqual({ ...awal.warna[1], h: 100, s: 0.5 });
    [0, 2, 3, 4].forEach((i) => expect(hasil.warna[i]).toEqual(awal.warna[i]));
  });

  it('membatasi kepekatan di tepi roda', () => {
    const awal = { aturan: 'CUSTOM' as const, warna: susunHarmoni('TRIAD', DASAR, []) };
    expect(geserPegangan(awal, 1, 100, 1.4).warna[1].s).toBe(1);
  });
});

describe('perubahan warna non-dasar melepas aturannya', () => {
  /*
   * Aturan disusun ulang dari warna dasar. Kalau warna di sampingnya diubah
   * lalu aturannya tetap dipegang, perubahan itu hilang saat pegangan
   * berikutnya disentuh — orang mengira isiannya tidak tersimpan. Adobe
   * melakukan hal yang sama: menyunting satu warna berarti "Custom".
   */
  it('lewat kecerahan', () => {
    const awal = { aturan: 'TRIAD' as const, warna: susunHarmoni('TRIAD', DASAR, []) };
    const hasil = ubahKecerahan(awal, 0, 0.3);
    expect(hasil.aturan).toBe('CUSTOM');
    expect(hasil.warna[0].b).toBe(0.3);
  });

  it('lewat hex', () => {
    const awal = { aturan: 'TRIAD' as const, warna: susunHarmoni('TRIAD', DASAR, []) };
    const hasil = gantiHexWarna(awal, 3, '#123456');
    expect(hasil.aturan).toBe('CUSTOM');
    expect(hsbKeHex(hasil.warna[3])).toBe('#123456');
  });

  it('tetapi warna dasar tetap memegang aturannya', () => {
    const awal = { aturan: 'TRIAD' as const, warna: susunHarmoni('TRIAD', DASAR, []) };
    const lewatTerang = ubahKecerahan(awal, INDEKS_DASAR, 0.5);
    expect(lewatTerang.aturan).toBe('TRIAD');
    expect(lewatTerang.warna[INDEKS_DASAR].b).toBe(0.5);

    const lewatHex = gantiHexWarna(awal, INDEKS_DASAR, '#2a78d6');
    expect(lewatHex.aturan).toBe('TRIAD');
    expect(hsbKeHex(lewatHex.warna[INDEKS_DASAR])).toBe('#2a78d6');
  });

  it('mengabaikan hex yang tidak sah', () => {
    const awal = { aturan: 'TRIAD' as const, warna: susunHarmoni('TRIAD', DASAR, []) };
    expect(gantiHexWarna(awal, 3, 'bukan-warna')).toBe(awal);
  });

  it('mempertahankan rona terakhir saat warna menjadi abu-abu', () => {
    const awal = { aturan: 'CUSTOM' as const, warna: susunHarmoni('TRIAD', DASAR, []) };
    const hasil = gantiHexWarna(awal, 1, '#808080');
    expect(hasil.warna[1].h).toBe(awal.warna[1].h);
  });
});
