import { describe, expect, it } from 'vitest';
import { warnaKode } from './warna-kode';

describe('warnaKode', () => {
  it('memberi warna yang SAMA untuk kode yang sama, selalu', () => {
    // Kode yang warnanya berpindah tidak akan pernah dihafal siapa pun.
    expect(warnaKode('FABRIC')).toEqual(warnaKode('FABRIC'));
  });

  it('tidak bergantung huruf besar-kecil atau spasi di ujung', () => {
    expect(warnaKode('fabric')).toEqual(warnaKode('FABRIC'));
    expect(warnaKode('  FABRIC  ')).toEqual(warnaKode('FABRIC'));
  });

  it('tidak bergantung kode lain di sekitarnya', () => {
    /*
     * Inilah yang membuatnya bisa dipakai lintas layar: warnanya diturunkan
     * dari teksnya sendiri, bukan dari posisinya di suatu daftar. Daftar yang
     * bertambah tidak mengecat ulang yang sudah ada.
     */
    const a = warnaKode('TAILOR');
    const b = warnaKode('TAILOR');
    expect(a).toEqual(b);
  });

  it('hanya memakai rona yang sudah DIVALIDASI, tidak membangkitkan sendiri', () => {
    /*
     * Tes lama di sini memeriksa "empat kode dapat empat warna berbeda" — dan
     * LOLOS sementara dua di antaranya sama-sama hijau di layar, karena ia cuma
     * membandingkan hex. Yang benar-benar perlu dijaga bukan jumlah warnanya
     * melainkan bahwa tiap warna berasal dari himpunan yang sudah diukur
     * pemisahannya, termasuk bagi mata buta warna.
     */
    const sah = new Set(['#2a78d6', '#eb6834', '#1baf7a']);
    for (const k of ['FABRIC', 'ACCESSORIES', 'TAILOR', 'OTHER', 'ZZZ', 'kain-impor']) {
      expect(sah.has(warnaKode(k).terang)).toBe(true);
    }
  });

  it('menyebar merata, tidak menumpuk di satu rona', () => {
    // Sebaran yang berat sebelah membuat hampir semua kode berwarna sama, dan
    // kepingnya berhenti membantu memindai.
    const hitung = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      const w = warnaKode(`KODE-${i}`).terang;
      hitung.set(w, (hitung.get(w) ?? 0) + 1);
    }
    expect(hitung.size).toBe(3);
    for (const n of hitung.values()) expect(n).toBeGreaterThan(60);
  });

  it('mengembalikan warna sah untuk kode kosong, tidak melempar', () => {
    // Kode datang dari basis data dan bisa saja kosong.
    expect(warnaKode('')).toHaveProperty('terang');
    expect(warnaKode('   ')).toHaveProperty('terang');
  });

  it('selalu mengembalikan pasangan terang dan gelap', () => {
    for (const k of ['A', 'FABRIC', 'zzz', 'Kode Panjang Sekali Sekali']) {
      const w = warnaKode(k);
      expect(w.terang).toMatch(/^#[0-9a-f]{6}$/i);
      expect(w.gelap).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
