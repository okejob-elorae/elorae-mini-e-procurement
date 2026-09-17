import { describe, expect, it } from 'vitest';
import { susunRingkasan } from './ringkasan';

describe('susunRingkasan', () => {
  it('menyusun kepala, satu blok per huruf, dan catatan', () => {
    const teks = susunRingkasan({
      kepala: ['Kain: PANTONE 16-5106 TCX Blue Surf (#90A8A4)', 'Aturan: Complementary · 2 warna sablon'],
      baris: [
        { huruf: 'A', judul: 'PANTONE 567 C (#154036)', rincian: 'Dominan · 70% desain', resep: 'Resep 1000 g: Green 60% (600 g) + Black 40% (400 g)' },
        { huruf: 'B', judul: 'PANTONE 9524 C (#AEECDF)', rincian: 'Pendukung · 30% desain', resep: null },
      ],
      catatan: 'Buat sampel kecil dulu.',
    });
    expect(teks).toBe(
      [
        'Kain: PANTONE 16-5106 TCX Blue Surf (#90A8A4)',
        'Aturan: Complementary · 2 warna sablon',
        '',
        'A — PANTONE 567 C (#154036)',
        '    Dominan · 70% desain',
        '    Resep 1000 g: Green 60% (600 g) + Black 40% (400 g)',
        '',
        'B — PANTONE 9524 C (#AEECDF)',
        '    Pendukung · 30% desain',
        '',
        'Buat sampel kecil dulu.',
      ].join('\n'),
    );
  });
});
