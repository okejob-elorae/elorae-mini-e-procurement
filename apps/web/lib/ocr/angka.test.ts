import { describe, expect, it } from 'vitest';
import { adalahAngka, keAngka } from './angka';

/**
 * Pembacaan angka dari hasil OCR.
 *
 * Berkas ini ada karena kesalahan yang SAMA sudah pernah terjadi di modul ini:
 * SheetJS membaca `"900.000"` sebagai sembilan ratus, dan yang kena hanya nilai
 * di bawah sejuta — jadi kerusakannya justru mengenai angka yang paling sering
 * muncul di nota retur. Di sini titik adalah pemisah ribuan sampai terbukti
 * sebaliknya, dan itu dikunci tes.
 */

describe('keAngka', () => {
  it('membaca titik sebagai pemisah RIBUAN, bukan desimal', () => {
    // Kesalahan yang sama persis dengan bug SheetJS.
    expect(keAngka('150.000')).toBe(150_000);
    expect(keAngka('900.000')).toBe(900_000);
    expect(keAngka('1.234.567')).toBe(1_234_567);
  });

  it('membuang awalan Rp dalam segala bentuk', () => {
    expect(keAngka('Rp 150.000')).toBe(150_000);
    expect(keAngka('Rp150.000')).toBe(150_000);
    expect(keAngka('RP. 150.000')).toBe(150_000);
    expect(keAngka('rp 150.000')).toBe(150_000);
  });

  it('membaca koma sebagai desimal saat titik juga ada', () => {
    expect(keAngka('1.234,56')).toBe(1234.56);
  });

  it('membaca koma tunggal berekor dua digit sebagai desimal', () => {
    expect(keAngka('12,50')).toBe(12.5);
  });

  it('membaca koma berekor tiga digit sebagai pemisah ribuan', () => {
    // Sebagian nota memakai gaya Inggris. Tiga digit di belakang koma tidak
    // pernah berarti desimal dalam mata uang rupiah.
    expect(keAngka('150,000')).toBe(150_000);
  });

  it('menoleransi spasi yang disisipkan OCR di tengah angka', () => {
    expect(keAngka('150. 000')).toBe(150_000);
    expect(keAngka('1 500')).toBe(1500);
  });

  it('membaca angka pendek apa adanya', () => {
    expect(keAngka('2')).toBe(2);
    expect(keAngka('12')).toBe(12);
  });

  it('mengembalikan null untuk yang bukan angka', () => {
    // null, BUKAN 0. Nol adalah nilai yang sah pada nota; "tidak terbaca" bukan.
    expect(keAngka('Blus Katun')).toBeNull();
    expect(keAngka('')).toBeNull();
    expect(keAngka('-')).toBeNull();
  });
});

describe('adalahAngka', () => {
  it('menerima angka polos, bukan cuma yang berawalan Rp', () => {
    // Temuan brief: regex angka harus menerima angka telanjang.
    expect(adalahAngka('150.000')).toBe(true);
    expect(adalahAngka('Rp 150.000')).toBe(true);
    expect(adalahAngka('2')).toBe(true);
  });

  it('menolak teks', () => {
    expect(adalahAngka('Blus')).toBe(false);
    expect(adalahAngka('XL')).toBe(false);
    // Kode ukuran yang mengandung angka bukan angka.
    expect(adalahAngka('M2')).toBe(false);
  });
});
