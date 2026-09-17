import { describe, expect, it } from 'vitest';
import { BIDANG_CETAK, luasPotongan, pitaCetak, svgKaos } from './kaos-svg';

describe('pitaCetak', () => {
  it('memberi tiap pita LUAS sebanding porsinya, bukan tinggi', () => {
    const { cy, r } = BIDANG_CETAK;
    const pita = pitaCetak([
      { huruf: 'A', hex: '#00323d', porsi: 60 },
      { huruf: 'B', hex: '#2f6f7a', porsi: 30 },
      { huruf: 'C', hex: '#7b68d8', porsi: 10 },
    ]);
    const luas = pita.map((p) => luasPotongan(p.y1 - (cy - r), r) - luasPotongan(p.y0 - (cy - r), r));
    expect(luas[0]).toBeCloseTo(0.6, 4);
    expect(luas[1]).toBeCloseTo(0.3, 4);
    expect(luas[2]).toBeCloseTo(0.1, 4);
    // Tinggi TIDAK sebanding: pita 10% di dasar lingkaran lebih tinggi dari 10% tinggi lingkaran.
    expect((pita[2].y1 - pita[2].y0) / (2 * r)).toBeGreaterThan(0.1);
    expect(pita[0].y0).toBeCloseTo(cy - r, 6);
    expect(pita[2].y1).toBeCloseTo(cy + r, 6);
  });

  it('porsi yang tidak berjumlah 100 dibagi menurut totalnya', () => {
    const { r } = BIDANG_CETAK;
    const pita = pitaCetak([
      { huruf: 'A', hex: '#000000', porsi: 3 },
      { huruf: 'B', hex: '#ffffff', porsi: 1 },
    ]);
    expect(luasPotongan(pita[0].y1 - pita[0].y0, r)).toBeCloseTo(0.75, 4);
  });
});

describe('svgKaos', () => {
  const kaos = (tinta: { huruf: string; hex: string; porsi: number }[], label = 'Kaos') =>
    svgKaos({ kainHex: '#90a8a4', tinta, id: 'uji', label });

  it('menggambar satu pita per tinta dan garis pemisah di antaranya', () => {
    const svg = kaos([
      { huruf: 'A', hex: '#00323d', porsi: 60 },
      { huruf: 'B', hex: '#2f6f7a', porsi: 40 },
    ]);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.match(/fill="#00323d"/g)).toHaveLength(1);
    expect(svg.match(/fill="#2f6f7a"/g)).toHaveLength(1);
    expect(svg.match(/<line /g)).toHaveLength(1);
    expect(svg).toContain('fill="#90a8a4"');
  });

  it('tanpa porsi, bidang cetak digambar sebagai garis putus-putus', () => {
    const svg = kaos([{ huruf: 'A', hex: '#00323d', porsi: 0 }]);
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).not.toContain('fill="#00323d"');
  });

  it('meloloskan label dan menolak warna yang bukan hex, supaya teks SVG tidak bisa disusupi', () => {
    const svg = svgKaos({
      kainHex: '"/><script>',
      tinta: [{ huruf: 'A', hex: 'red" onload="x', porsi: 100 }],
      id: 'a"b',
      label: '<b>"Feed"</b>',
    });
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('onload');
    expect(svg).toContain('aria-label="&lt;b&gt;&quot;Feed&quot;&lt;/b&gt;"');
    expect(svg).toContain('id="ab-badan"');
  });
});
