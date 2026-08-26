import { describe, expect, it } from 'vitest';
import { potonganRetur } from './deductions';
import { returTertahan } from './rules';

/**
 * Penerjemahan baris basis data ke aturan uang. Setiap kasus di sini adalah
 * bentuk data yang benar-benar ada di basis data hari ini.
 */

const RETUR = (over: Record<string, unknown> = {}) => ({
  claimedAmount: 1_000_000,
  status: 'MENUNGGU',
  warehouseReturn: null,
  charges: [],
  ...over,
});

/** Hitungan gudang yang sudah ditutup — inilah yang melepas potongan. */
const NRI = (physicalAmount: number, status = 'FINAL') => ({ physicalAmount, status });

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
        storeReturn: RETUR({ status: 'SELISIH', warehouseReturn: NRI(800_000) }),
      },
    ]);
    expect(returTertahan(bahan)).toBeCloseTo(120_000, 6);
  });

  it('melepas begitu bebannya ditanggung seseorang', () => {
    const bahan = potonganRetur([
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({
          status: 'SELISIH',
          warehouseReturn: NRI(800_000),
          charges: [{ status: 'DITETAPKAN' }],
        }),
      },
    ]);
    expect(returTertahan(bahan)).toBe(0);
  });

  it('TIDAK melepas apa pun selama hitungan gudang masih draft', () => {
    // Brief menyebutnya tegas: yang melepas adalah NRI *final*. Angka yang
    // masih bisa berubah tidak boleh melepas uang.
    const bahan = potonganRetur([
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({ warehouseReturn: NRI(800_000, 'DRAFT') }),
      },
    ]);
    expect(returTertahan(bahan)).toBe(600_000);
    expect(bahan[0].nilaiFisik).toBeNull();
  });

  it('tidak melepas apa pun selama bebannya masih TERBUKA', () => {
    // Beban terbuka artinya sudah dicatat ada selisihnya, tapi belum ada yang
    // ditetapkan menanggung. Fakturnya tetap tertahan.
    const bahan = potonganRetur([
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({
          status: 'SELISIH',
          warehouseReturn: NRI(800_000),
          charges: [{ status: 'TERBUKA' }],
        }),
      },
    ]);
    expect(returTertahan(bahan)).toBeCloseTo(120_000, 6);
  });

  it('tetap lepas kalau bebannya sudah LUNAS', () => {
    const bahan = potonganRetur([
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({
          status: 'SELISIH',
          warehouseReturn: NRI(800_000),
          charges: [{ status: 'LUNAS' }],
        }),
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
        storeReturn: RETUR({
          status: 'BATAL',
          warehouseReturn: NRI(800_000),
          charges: [{ status: 'DITETAPKAN' }],
        }),
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
        storeReturn: RETUR({ status: 'SELISIH', warehouseReturn: NRI(0) }),
      },
    ]);
    expect(returTertahan(bahan)).toBe(600_000);
    expect(bahan[0].nilaiFisik).toBe(0);
  });
});
