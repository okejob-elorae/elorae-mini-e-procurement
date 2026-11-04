import { describe, expect, it } from 'vitest';
import { nilaiFisikNota, potonganRetur } from './deductions';
import { returTertahan, tertahanPiutang } from './rules';

/**
 * Penerjemahan baris basis data ke aturan uang. Setiap kasus di sini adalah
 * bentuk data yang benar-benar ada di basis data hari ini.
 */

const RETUR = (over: Record<string, unknown> = {}) => ({
  claimedAmount: 1_000_000,
  status: 'MENUNGGU',
  warehouseReturn: null,
  followUps: [],
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
          charges: [{ status: 'DITETAPKAN', bearer: 'SALES' }],
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
          charges: [{ status: 'TERBUKA', bearer: null }],
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
          charges: [{ status: 'LUNAS', bearer: 'GUDANG' }],
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
          charges: [{ status: 'DITETAPKAN', bearer: 'SALES' }],
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

  it('barang susulan yang sudah final ikut menjadi nilai fisik dan mengecilkan tahanan', () => {
    // NRT 1 jt, hitungan asli 800 rb, susulan 150 rb → fisik 950 rb.
    // Potongan 600 rb diprorata: 600 rb − 570 rb = 30 rb.
    const bahan = potonganRetur([
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({
          status: 'SELISIH',
          warehouseReturn: NRI(800_000),
          followUps: [{ physicalAmount: 150_000 }],
          charges: [{ status: 'TERBUKA', bearer: null }],
        }),
      },
    ]);
    expect(returTertahan(bahan)).toBeCloseTo(30_000, 6);
  });

  it('beban yang ditetapkan ke TOKO tetap ditahan di faktur asal sebagai tahanan tetap (P84)', () => {
    const bahan = potonganRetur([
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({
          status: 'SELISIH',
          warehouseReturn: NRI(800_000),
          charges: [{ status: 'DITETAPKAN', bearer: 'TOKO' }],
        }),
      },
    ]);
    // Bagian selisihnya tidak dikreditkan ke toko …
    expect(returTertahan(bahan)).toBeCloseTo(120_000, 6);
    expect(bahan[0].tetap).toBe(true);
    expect(bahan[0].ditanggungToko).toBe(true);
    // … tapi bukan tahanan yang lepas sendiri: BKM berikutnya boleh melunasinya.
    expect(
      tertahanPiutang([{ status: 'TERVERIFIKASI', nilaiFaktur: 1_000_000, potonganRetur: bahan, nilaiDilunasiPiutangIni: 1_000_000 }]),
    ).toBe(0);
  });

  it('beban yang ditetapkan ke SALES, GUDANG, atau PERUSAHAAN melepas tahanannya', () => {
    for (const bearer of ['SALES', 'GUDANG', 'PERUSAHAAN']) {
      const bahan = potonganRetur([
        {
          amount: 600_000,
          storeReturnId: 'nrt1',
          storeReturn: RETUR({
            status: 'SELISIH',
            warehouseReturn: NRI(800_000),
            charges: [{ status: 'DITETAPKAN', bearer }],
          }),
        },
      ]);
      expect(returTertahan(bahan)).toBe(0);
      expect(bahan[0].ditanggungToko).toBeUndefined();
    }
  });

  it('menandai hanya potongan yang ditanggung toko, berurutan, di antara potongan bukan retur', () => {
    const bahan = potonganRetur([
      { amount: 50_000, storeReturnId: null, storeReturn: null },
      {
        amount: 600_000,
        storeReturnId: 'nrt1',
        storeReturn: RETUR({ status: 'SELISIH', warehouseReturn: NRI(800_000), charges: [{ status: 'DITETAPKAN', bearer: 'TOKO' }] }),
      },
      { amount: 100_000, storeReturnId: 'nrt2', storeReturn: RETUR() },
    ]);
    expect(bahan).toHaveLength(2);
    expect(bahan[0].ditanggungToko).toBe(true);
    expect(bahan[1].ditanggungToko).toBeUndefined();
  });
});

describe('nilaiFisikNota', () => {
  it('menjumlah hitungan asli dan susulan yang final, dalam sen', () => {
    expect(
      nilaiFisikNota({ warehouseReturn: NRI(100_000.1), followUps: [{ physicalAmount: 0.2 }, { physicalAmount: 50_000 }] }),
    ).toBe(150_000.3);
  });

  it('mengabaikan susulan yang masih draft', () => {
    expect(
      nilaiFisikNota({ warehouseReturn: NRI(100_000), followUps: [{ physicalAmount: 50_000, status: 'DRAFT' }] }),
    ).toBe(100_000);
  });

  it('null selama hitungan aslinya belum ada atau belum final, walau ada susulan', () => {
    expect(nilaiFisikNota({ warehouseReturn: null, followUps: [{ physicalAmount: 50_000 }] })).toBeNull();
    expect(nilaiFisikNota({ warehouseReturn: NRI(80_000, 'DRAFT'), followUps: [{ physicalAmount: 50_000 }] })).toBeNull();
  });
});
