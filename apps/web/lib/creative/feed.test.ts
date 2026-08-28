import { describe, expect, it } from 'vitest';
import { KOLOM_FEED, labelTanggal, susunFeed } from './feed';
import type { BarisKonten } from './queries';

const buat = (id: string, scheduledAt: string | null, imageUrl: string | null = null): BarisKonten => ({
  id,
  title: id,
  platform: 'INSTAGRAM',
  format: 'FEED',
  status: 'DIJADWALKAN',
  scheduledAt,
  publishedAt: null,
  postUrl: null,
  imageUrl,
  itemNama: null,
  assigneeNama: null,
  briefDocNo: null,
  briefId: null,
  caption: null,
  terlambat: false,
});

describe('susunFeed', () => {
  it('menaruh yang TERBARU di kiri atas, seperti profil Instagram', () => {
    /*
     * Instagram membaca profil dari kiri atas ke kanan bawah, terbaru dulu.
     * Grid yang terbalik memperlihatkan komposisi yang tidak akan pernah
     * terjadi — dan komposisi itulah yang sedang dinilai art director.
     */
    const f = susunFeed([
      buat('lama', '2026-08-27T00:00:00Z'),
      buat('baru', '2026-10-04T00:00:00Z'),
      buat('tengah', '2026-09-08T00:00:00Z'),
    ]);
    expect(f[0].sel.map((s) => s.konten.id)).toEqual(['baru', 'tengah', 'lama']);
  });

  it('membagi tepat tiga per baris', () => {
    const f = susunFeed(Array.from({ length: 7 }, (_, i) => buat(`k${i}`, `2026-09-0${i + 1}T00:00:00Z`)));
    expect(f).toHaveLength(3);
    expect(f[0].sel).toHaveLength(KOLOM_FEED);
    // Baris terakhir boleh kurang dari tiga; itu memang bentuk feed yang belum penuh.
    expect(f[2].sel).toHaveLength(1);
  });

  it('menomori baris dari 1 di paling atas', () => {
    // Sama seperti kolom nomor di sheet yang dipakai hari ini.
    const f = susunFeed(Array.from({ length: 6 }, (_, i) => buat(`k${i}`, `2026-09-0${i + 1}T00:00:00Z`)));
    expect(f.map((b) => b.nomor)).toEqual([1, 2]);
  });

  it('MEMPERTAHANKAN slot yang belum punya gambar, tidak merapatkannya', () => {
    /*
     * Slot kosong adalah bagian dari komposisi. Merapatkannya memperlihatkan
     * susunan yang tidak akan pernah tayang.
     */
    const f = susunFeed([
      buat('isi', '2026-09-03T00:00:00Z', '/api/foto/x'),
      buat('kosong', '2026-09-02T00:00:00Z'),
      buat('isi2', '2026-09-01T00:00:00Z', '/api/foto/y'),
    ]);
    expect(f[0].sel.map((s) => s.jenis)).toEqual(['konten', 'kosong', 'konten']);
  });

  it('menjatuhkan yang BELUM berjadwal ke bawah, bukan membuangnya', () => {
    // Ia belum punya tempat di feed, tapi tetap harus terlihat.
    const f = susunFeed([
      buat('tanpa-jadwal', null),
      buat('berjadwal', '2026-09-01T00:00:00Z'),
    ]);
    expect(f[0].sel.map((s) => s.konten.id)).toEqual(['berjadwal', 'tanpa-jadwal']);
  });

  it('tidak menghasilkan baris apa pun dari daftar kosong', () => {
    expect(susunFeed([])).toEqual([]);
  });
});

describe('labelTanggal', () => {
  it('TIDAK menampilkan tanggal apa pun untuk slot yang belum berjadwal', () => {
    // Menampilkan hari ini akan dibaca sebagai "dijadwalkan hari ini".
    expect(labelTanggal(null, 'id')).toBeNull();
  });

  it('memformat dalam zona WIB, bukan zona mesinnya', () => {
    // Prod berjalan di UTC; tanpa zona yang dipatok, sebuah jadwal tengah malam
    // WIB tercetak mundur satu hari.
    expect(labelTanggal('2026-09-07T17:30:00Z', 'id')).toBe('8 September');
  });
});
