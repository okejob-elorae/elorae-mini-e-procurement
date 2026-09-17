import { describe, expect, it } from 'vitest';
import { BATAS_TINTA_DASAR, bacaTintaDasar, periksaTintaDasar, presetTintaPantone } from './tinta-dasar';

describe('presetTintaPantone', () => {
  /*
   * Empat belas warna dasar Pantone Formula Guide — semua warna Coated C
   * dicampur dari sini — ditambah putih. Diambil dari katalog, bukan diketik,
   * supaya hex-nya tidak bisa berbeda dari yang tampil di pencarian.
   */
  it('memuat 14 warna dasar Pantone dan putih, semuanya ditemukan di katalog', () => {
    const preset = presetTintaPantone();
    expect(preset).toHaveLength(15);
    expect(preset.filter((t) => t.kode !== null)).toHaveLength(14);
    expect(preset.find((t) => t.kode === 'Reflex Blue C')?.hex).toBe('#001d8a');
    expect(preset.find((t) => t.kode === null)?.hex).toBe('#ffffff');
    expect(periksaTintaDasar(preset).ok).toBe(true);
  });
});

describe('periksaTintaDasar', () => {
  it('merapikan nama dan hex', () => {
    expect(periksaTintaDasar([{ nama: '  Rubine  ', hex: 'D01058', kode: 'Rubine Red C' }])).toEqual({
      ok: true,
      tinta: [{ nama: 'Rubine', hex: '#d01058', kode: 'Rubine Red C' }],
    });
  });

  it('menerima daftar kosong — tim boleh mengosongkannya', () => {
    expect(periksaTintaDasar([])).toEqual({ ok: true, tinta: [] });
  });

  it('menolak bentuk yang salah', () => {
    expect(periksaTintaDasar('bukan')).toEqual({ ok: false, alasan: 'BUKAN_DAFTAR' });
    expect(periksaTintaDasar([{ nama: '', hex: '#ffffff' }])).toEqual({ ok: false, alasan: 'NAMA_KOSONG' });
    expect(periksaTintaDasar([{ nama: 'X', hex: 'putih' }])).toEqual({ ok: false, alasan: 'HEX_TIDAK_SAH' });
  });

  it('menolak nama kembar, tanpa peduli huruf besar', () => {
    expect(
      periksaTintaDasar([
        { nama: 'Putih', hex: '#ffffff' },
        { nama: 'putih', hex: '#fefefe' },
      ]),
    ).toEqual({ ok: false, alasan: 'NAMA_KEMBAR' });
  });

  it('membatasi jumlah tinta dasar', () => {
    const banyak = Array.from({ length: BATAS_TINTA_DASAR + 1 }, (_, i) => ({ nama: `T${i}`, hex: '#123456' }));
    expect(periksaTintaDasar(banyak)).toEqual({ ok: false, alasan: 'TERLALU_BANYAK' });
  });
});

describe('bacaTintaDasar', () => {
  it('membaca nilai tersimpan', () => {
    expect(bacaTintaDasar(JSON.stringify([{ nama: 'Putih', hex: '#ffffff', kode: null }]))).toEqual([
      { nama: 'Putih', hex: '#ffffff', kode: null },
    ]);
  });

  /*
   * Nilai pengaturan bisa disunting tangan lewat SQL. Isi yang rusak dibaca
   * sebagai kosong — halamannya tetap terbuka, dan orang bisa menyusun ulang.
   */
  it('membaca nilai rusak atau tidak ada sebagai kosong', () => {
    expect(bacaTintaDasar(null)).toEqual([]);
    expect(bacaTintaDasar('{rusak')).toEqual([]);
    expect(bacaTintaDasar(JSON.stringify([{ nama: '', hex: 'x' }]))).toEqual([]);
  });
});
