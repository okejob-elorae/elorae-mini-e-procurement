import { describe, expect, it } from 'vitest';
import { rasioKontras, tampilRasio, tingkatKontras } from './kontras';

describe('rasioKontras', () => {
  it('memberi 21 untuk hitam di atas putih, dan sama dari kedua arah', () => {
    expect(rasioKontras('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(rasioKontras('#ffffff', '#000000')).toBeCloseTo(21, 6);
  });

  it('memberi 1 untuk warna yang sama', () => {
    expect(rasioKontras('#2a78d6', '#2a78d6')).toBeCloseTo(1, 6);
  });

  /*
   * Angka pembanding dari WebAIM Contrast Checker. #767676 adalah abu-abu
   * paling terang yang masih lolos AA di atas putih; #777777 tepat gagal.
   * Batas setipis ini hanya benar kalau rumus luminansinya benar.
   */
  it('mencocokkan batas AA yang dikenal di atas putih', () => {
    expect(rasioKontras('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(rasioKontras('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('tingkatKontras', () => {
  it('memakai ambang WCAG 2', () => {
    expect(tingkatKontras(7)).toBe('AAA');
    expect(tingkatKontras(6.99)).toBe('AA');
    expect(tingkatKontras(4.5)).toBe('AA');
    expect(tingkatKontras(4.49)).toBe('AA_BESAR');
    expect(tingkatKontras(3)).toBe('AA_BESAR');
    expect(tingkatKontras(2.99)).toBe('GAGAL');
  });

  it('menilai dari rasio mentah', () => {
    expect(tingkatKontras(rasioKontras('#777777', '#ffffff'))).toBe('AA_BESAR');
  });
});

describe('tampilRasio', () => {
  it('tidak pernah menampilkan angka lolos untuk pasangan yang gagal', () => {
    // 4.48 dibulatkan biasa menjadi 4.5 — tepat di ambang AA yang tidak diraihnya.
    expect(tampilRasio(rasioKontras('#777777', '#ffffff'))).toBe(4.4);
    expect(tampilRasio(rasioKontras('#767676', '#ffffff'))).toBe(4.5);
  });

  it('setuju dengan tingkatnya di sepanjang rentang', () => {
    for (let r = 1; r <= 21; r += 0.013) {
      expect(tingkatKontras(tampilRasio(r)), String(r)).toBe(tingkatKontras(r));
    }
  });

  it('tidak menjatuhkan angka bulat karena galat pecahan', () => {
    expect(tampilRasio(7)).toBe(7);
    expect(tampilRasio(4.5)).toBe(4.5);
    expect(tampilRasio(21)).toBe(21);
  });
});
