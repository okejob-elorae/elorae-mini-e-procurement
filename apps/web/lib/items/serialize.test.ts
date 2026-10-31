import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Prisma } from '@elorae/db';
import { KOLOM_DECIMAL_ITEM, itemDecimalsToNumbers } from './queries';

/**
 * Penjaga batas server → klien.
 *
 * React MENOLAK objek `Decimal` yang menyeberang dari komponen server ke
 * komponen klien, dan penolakannya mematikan seluruh halaman. Serializer item
 * menyebar sisa kolomnya dengan `...rest`, jadi kolom Decimal yang tidak
 * terdaftar lolos mentah — persis yang terjadi saat `commissionPerPcs`
 * ditambahkan untuk komisi konsinyasi: type-check lolos, lint lolos, dan
 * halamannya baru pecah saat dibuka orang.
 *
 * Tes ini membaca daftar kolom Decimal LANGSUNG DARI SKEMA, bukan dari daftar
 * yang saya ketik ulang — kalau ia menyalin daftar yang sama, ia cuma
 * membandingkan sebuah berkas dengan dirinya sendiri.
 */

function kolomDecimalItem(): string[] {
  const skema = readFileSync('../../packages/db/prisma/schema.postgres.prisma', 'utf8');
  const awal = skema.indexOf('\nmodel Item {');
  const akhir = skema.indexOf('\n}', awal);
  const blok = skema.slice(awal, akhir);
  return [...blok.matchAll(/^\s{2}(\w+)\s+Decimal/gm)].map((m) => m[1]);
}

describe('kolom Decimal Item', () => {
  it('SETIAP kolom Decimal di skema ada di daftar serializer', () => {
    /*
     * Yang lupa didaftarkan tidak gagal di mana pun — ia lolos mentah dan
     * mematikan halamannya di browser. Ini satu-satunya jaring untuk itu.
     */
    const skema = kolomDecimalItem();
    const terdaftar = new Set<string>(KOLOM_DECIMAL_ITEM);
    const hilang = skema.filter((k) => !terdaftar.has(k));
    expect(hilang, `kolom Decimal belum diserialisasi: ${hilang.join(', ')}`).toEqual([]);
  });

  it('daftarnya tidak memuat kolom yang sudah tidak ada di skema', () => {
    // Kolom hantu tidak merusak apa pun, tapi ia membuat daftarnya berbohong
    // tentang apa yang sedang dijaga.
    const skema = new Set(kolomDecimalItem());
    const hantu = KOLOM_DECIMAL_ITEM.filter((k) => !skema.has(k));
    expect(hantu, `kolom tidak ada di skema: ${hantu.join(', ')}`).toEqual([]);
  });

  it('benar-benar membaca skemanya, bukan mengembalikan daftar kosong', () => {
    // Kalau regex atau jalurnya meleset, kedua tes di atas lolos dengan
    // membandingkan kosong lawan kosong — dan tidak menjaga apa pun.
    expect(kolomDecimalItem().length).toBeGreaterThanOrEqual(5);
    expect(kolomDecimalItem()).toContain('sellingPrice');
  });
});

describe('itemDecimalsToNumbers', () => {
  it('mengubah SETIAP kolom Decimal menjadi angka biasa', () => {
    // Serializer halaman Inventori dulu hanya mengubah tiga kolom, dan
    // `commissionPerPcs` lolos mentah ke browser. Satu pembantu untuk semua.
    const item = Object.fromEntries(
      KOLOM_DECIMAL_ITEM.map((k, i) => [k, new Prisma.Decimal(i + 0.5)]),
    );
    const hasil = itemDecimalsToNumbers(item);
    for (const [i, k] of KOLOM_DECIMAL_ITEM.entries()) {
      expect(hasil[k]).toBe(i + 0.5);
    }
  });

  it('membiarkan kolom kosong tetap null', () => {
    const hasil = itemDecimalsToNumbers({ sellingPrice: null });
    for (const k of KOLOM_DECIMAL_ITEM) expect(hasil[k]).toBeNull();
  });
});
