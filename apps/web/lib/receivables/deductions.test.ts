import { describe, expect, it } from 'vitest';
import { potonganRetur } from './deductions';
import { returTertahan } from './rules';

/**
 * Penerjemahan baris basis data ke aturan uang. Setiap kasus di sini adalah
 * bentuk data yang benar-benar ada di basis data hari ini.
 */

const RETUR = (over: Record<string, unknown> = {}) => ({
  claimedAmount: 1_000_000,
  countedAmount: null,
  bearer: null,
  status: 'DIAJUKAN',
  ...over,
});

describe('potonganRetur', () => {
  it('tidak menahan potongan yang memang bukan retur', () => {
    // Potongan promosi: pengurang harga yang sudah pasti, bukan janji barang.
    const bahan = potonganRetur([{ amount: 500_000, storeReturnId: null, storeReturn: null }]);
    expect(bahan).toEqual([]);
    expect(returTertahan(bahan)).toBe(0);
  });

  it('MENAHAN PENUH potongan yang notanya menggantung', () => {
    // Tanpa foreign key sebuah potongan bisa menunjuk nota yang tidak ada.
    // Kalau ini lolos sebagai potongan biasa, uangnya lepas tanpa jejak — dan
    // itu persis bentuk data yang ada di basis data dev hari ini.
    const bahan = potonganRetur([
      { amount: 870_000, storeReturnId: 'NRT-4471', storeReturn: null },
    ]);
    expect(returTertahan(bahan)).toBe(870_000);
  });

  it('menahan penuh selama gudang belum menghitung', () => {
    const bahan = potonganRetur([
      { amount: 600_000, storeReturnId: 'nrt1', storeReturn: RETUR() },
    ]);
    expect(returTertahan(bahan)).toBe(600_000);
  });

  it('menahan selisih yang diprorata setelah gudang menghitung', () => {
    const bahan = potonganRetur([
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({ countedAmount: 800_000, status: 'DIHITUNG' }),
      },
    ]);
    expect(returTertahan(bahan)).toBeCloseTo(120_000, 6);
  });

  it('melepas begitu bebannya ditanggung seseorang', () => {
    const bahan = potonganRetur([
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({ countedAmount: 800_000, status: 'SELESAI', bearer: 'TOKO' }),
      },
    ]);
    expect(returTertahan(bahan)).toBe(0);
  });

  it('menahan penuh nota yang dibatalkan, apa pun bebannya', () => {
    // Barangnya tidak jadi datang dan tidak ada siapa pun untuk dibebani —
    // tokonya memang berutang sebesar potongan itu.
    const bahan = potonganRetur([
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({ countedAmount: 800_000, status: 'BATAL', bearer: 'TOKO' }),
      },
    ]);
    expect(returTertahan(bahan)).toBe(600_000);
  });

  it('membaca countedAmount nol sebagai sudah dihitung, bukan belum', () => {
    // Nol = tidak ada barang sampai → tahan penuh lewat jalur selisih, yang
    // BISA dibebankan ke seseorang. Belum dihitung tidak bisa.
    const bahan = potonganRetur([
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({ countedAmount: 0, status: 'DIHITUNG' }),
      },
    ]);
    expect(returTertahan(bahan)).toBe(600_000);
    expect(bahan[0].nilaiFisik).toBe(0);
  });
});
