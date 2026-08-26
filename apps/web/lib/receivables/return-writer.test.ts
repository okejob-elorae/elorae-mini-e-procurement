import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tes penulis retur tanpa menyentuh database.
 *
 * Yang dijaga: nomor NRT milik toko, hitungan gudang hanya sekali, penerimaan
 * yatim bisa dicatat lalu dijodohkan, beban tidak bisa lepas begitu diputuskan,
 * dan setiap perubahan memicu perhitungan ulang piutang — kalau tidak, layar
 * piutang tetap menampilkan angka lama tanpa tanda apa pun.
 */

type Nrt = Record<string, unknown> | null;
type Nri = Record<string, unknown> | null;

const state = {
  nrt: null as Nrt,
  nri: null as Nri,
  nrtDibuat: [] as Record<string, unknown>[],
  nriDibuat: [] as Record<string, unknown>[],
  nrtUpdates: [] as Record<string, unknown>[],
  nriUpdates: [] as Record<string, unknown>[],
  beban: null as Record<string, unknown> | null,
  bebanDibuat: [] as Record<string, unknown>[],
  bebanUpdates: [] as Record<string, unknown>[],
  bebanDihapus: 0,
  bebanDiputuskanCount: 0,
  potongan: [] as { paymentClaimId: string }[],
  links: [] as { receivableId: string }[],
  dihitungUlang: [] as string[],
  stok: null as { id: string; qtyOnHand: number; avgCost: number } | null,
  stokDibuat: [] as Record<string, unknown>[],
  stokUpdates: [] as Record<string, unknown>[],
  penyesuaian: [] as Record<string, unknown>[],
};

const tx = {
  storeReturn: {
    findUnique: vi.fn(async () => state.nrt),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.nrtDibuat.push(a.data);
      return { id: 'nrt1', noNrt: a.data.noNrt as string };
    }),
    update: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.nrtUpdates.push(a.data);
      return {};
    }),
  },
  warehouseReturn: {
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => state.nri),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.nriDibuat.push(a.data);
      return { id: 'nri1', noNri: a.data.noNri as string };
    }),
    update: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.nriUpdates.push(a.data);
      return {};
    }),
  },
  returnCharge: {
    findUnique: vi.fn(async () => state.beban),
    count: vi.fn(async () => state.bebanDiputuskanCount),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.bebanDibuat.push(a.data);
      return {};
    }),
    update: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.bebanUpdates.push(a.data);
      return {};
    }),
    deleteMany: vi.fn(async () => {
      state.bebanDihapus += 1;
      return { count: 1 };
    }),
  },
  paymentClaimDeduction: { findMany: vi.fn(async () => state.potongan) },
  paymentClaimReceivable: { findMany: vi.fn(async () => state.links) },
  inventoryValue: {
    findFirst: vi.fn(async () => state.stok),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.stokDibuat.push(a.data);
      return {};
    }),
    update: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.stokUpdates.push(a.data);
      return {};
    }),
  },
  stockAdjustment: {
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.penyesuaian.push(a.data);
      return {};
    }),
  },
};

vi.mock('@/lib/db/tx-retry', () => ({
  runSerializable: (cb: (c: unknown) => Promise<unknown>) => cb(tx),
}));
vi.mock('@/lib/docNumber', () => ({
  generateDocNumber: async () => 'ADJ/2026/0001',
}));
vi.mock('./writer', () => ({
  hitungUlangPiutang: async (_c: unknown, id: string) => {
    state.dihitungUlang.push(id);
    return 0;
  },
}));
vi.mock('@elorae/db', () => ({
  Prisma: {
    Decimal: class {
      constructor(public value: number) {}
    },
    PrismaClientKnownRequestError: class extends Error {
      code = 'P2002';
    },
  },
}));

const {
  catatReturToko,
  catatHitunganGudang,
  jodohkanRetur,
  lepasPasangan,
  putuskanBeban,
  tandaiBebanLunas,
  batalkanRetur,
} = await import('./return-writer');

const HARI_INI = new Date('2026-08-26T00:00:00+07:00');

beforeEach(() => {
  state.nrt = {
    id: 'nrt1',
    storeId: 't1',
    status: 'MENUNGGU',
    claimedAmount: 1_000_000,
    note: null,
    warehouseReturn: null,
    charges: [],
    items: [{ itemName: 'Cat Tembok', qty: 3 }],
  };
  state.nri = { id: 'nri1', storeReturnId: null, storeId: null, physicalAmount: 800_000 };
  state.nrtDibuat = [];
  state.nriDibuat = [];
  state.nrtUpdates = [];
  state.nriUpdates = [];
  state.beban = { id: 'b1', status: 'TERBUKA', amount: 200_000, storeReturnId: 'nrt1' };
  state.bebanDibuat = [];
  state.bebanUpdates = [];
  state.bebanDihapus = 0;
  state.bebanDiputuskanCount = 0;
  state.potongan = [{ paymentClaimId: 'k1' }];
  state.links = [{ receivableId: 'r1' }, { receivableId: 'r2' }];
  state.dihitungUlang = [];
  state.stok = { id: 'iv1', qtyOnHand: 10, avgCost: 50_000 };
  state.stokDibuat = [];
  state.stokUpdates = [];
  state.penyesuaian = [];
});

const NRT_DASAR = {
  noNrt: 'NRT-4402',
  storeId: 't1',
  claimDate: HARI_INI,
  deliveryMethod: 'SALES' as const,
};

describe('catatReturToko — nomornya milik toko', () => {
  it('menolak tanpa nomor nota', async () => {
    // Nomor nota toko adalah yang dicari pemilik di arsip. Tanpa itu notanya
    // tidak bisa ditemukan lagi.
    expect(await catatReturToko({ ...NRT_DASAR, noNrt: '  ', claimedAmount: 1_000 })).toEqual({
      ok: false,
      alasan: 'NOMOR_WAJIB',
    });
    expect(state.nrtDibuat).toHaveLength(0);
  });

  it('menyimpan nomor toko apa adanya, tidak menghasilkan sendiri', async () => {
    const h = await catatReturToko({ ...NRT_DASAR, claimedAmount: 870_000 });
    expect(h).toEqual({ ok: true, id: 'nrt1', noNrt: 'NRT-4402' });
    expect(state.nrtDibuat[0].noNrt).toBe('NRT-4402');
  });

  it('menghitung total dari rincian barang, bukan dari angka yang diketik', async () => {
    // Total yang diketik di samping rincian yang tidak menjumlah ke sana adalah
    // dua kebenaran untuk satu nota.
    await catatReturToko({
      ...NRT_DASAR,
      claimedAmount: 999_999,
      items: [
        { itemName: 'Cat Tembok', qty: 3, price: 780_000 },
        { itemName: 'Plamir', qty: 4, price: 210_000 },
      ],
    });
    expect(Number((state.nrtDibuat[0].claimedAmount as { value: number }).value)).toBe(3_180_000);
  });

  it('memakai total yang diketik kalau rinciannya belum ada', async () => {
    // Sales memotret nota di lapangan dan belum sempat mengetik barangnya.
    await catatReturToko({ ...NRT_DASAR, claimedAmount: 870_000 });
    expect(Number((state.nrtDibuat[0].claimedAmount as { value: number }).value)).toBe(870_000);
  });

  it('menolak nilai nol', async () => {
    expect(await catatReturToko({ ...NRT_DASAR, claimedAmount: 0 })).toEqual({
      ok: false,
      alasan: 'NILAI_TIDAK_VALID',
    });
  });
});

describe('catatHitunganGudang', () => {
  const DASAR = {
    warehouseUserId: 'g1',
    receivedAt: HARI_INI,
    deliveryMethod: 'SALES' as const,
  };

  it('menerima nol — tidak ada barang yang sampai', async () => {
    // Nol berbeda dari belum dihitung: yang satu sudah bisa dibebankan.
    const h = await catatHitunganGudang({ ...DASAR, storeReturnId: 'nrt1', physicalAmount: 0 });
    expect(h).toMatchObject({ ok: true });
  });

  it('menomori NRI per bulan', async () => {
    const h = await catatHitunganGudang({ ...DASAR, storeReturnId: 'nrt1', physicalAmount: 800_000 });
    expect(h).toMatchObject({ ok: true, noNri: 'NRI/26/08/0001' });
    expect(state.nriDibuat[0].status).toBe('FINAL');
  });

  it('mencatat penerimaan YATIM tanpa nota toko', async () => {
    // Barang datang lewat ekspedisi mendahului notanya. Kalau ini tidak bisa
    // dicatat, barangnya tidak ada di mana pun sampai notanya muncul.
    const h = await catatHitunganGudang({ ...DASAR, deliveryMethod: 'EKSPEDISI', physicalAmount: 941_000 });
    expect(h).toMatchObject({ ok: true });
    expect(state.nriDibuat[0].storeReturnId).toBeNull();
    expect(h.ok && h.piutangDihitungUlang).toBe(0);
  });

  it('menyalin qty klaim per barang supaya selisihnya terbaca per baris', async () => {
    await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemName: 'Cat Tembok', qty: 2, price: 780_000 }],
    });
    const items = (state.nriDibuat[0].items as { create: { qtyClaim: number; qty: number }[] }).create;
    expect(items[0]).toMatchObject({ qtyClaim: 3, qty: 2 });
  });

  it('menolak menghitung nota yang sudah punya NRI', async () => {
    state.nrt = { ...state.nrt, warehouseReturn: { id: 'nri9' } };
    expect(await catatHitunganGudang({ ...DASAR, storeReturnId: 'nrt1', physicalAmount: 1 })).toEqual({
      ok: false,
      alasan: 'SUDAH_DIHITUNG',
    });
    expect(state.nriDibuat).toHaveLength(0);
  });

  it('membuka beban TERBUKA kalau fisik kurang dari klaim', async () => {
    await catatHitunganGudang({ ...DASAR, storeReturnId: 'nrt1', physicalAmount: 800_000 });
    // findUnique dipanggil ulang oleh selaraskan; nota sekarang punya NRI final.
    expect(state.nrtUpdates.some((u) => u.status === 'MENUNGGU' || u.status === 'SELISIH')).toBe(true);
  });

  it('MENAMBAH stok untuk baris yang menunjuk barang katalog', async () => {
    // NRI menambah, tidak mengurangi — barangnya kembali ke gudang. Arah ini
    // pernah salah dan dikoreksi pemilik.
    const h = await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemId: 'brg1', itemName: 'Cat Tembok', qty: 2, price: 780_000 }],
    });
    expect(h).toMatchObject({ ok: true, barisStok: 1 });
    expect(state.stokUpdates[0].qtyOnHand).toBe(12);
    expect(state.penyesuaian[0]).toMatchObject({
      type: 'POSITIVE',
      qtyChange: 2,
      source: 'STORE_RETURN_RECEIVE',
    });
  });

  it('TIDAK menggeser harga rata-rata', async () => {
    // Retur bukan pembelian; ia tidak membawa harga baru. Menggesernya akan
    // mengubah HPP setiap kali ada barang kembali.
    await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemId: 'brg1', itemName: 'Cat Tembok', qty: 2, price: 999_999 }],
    });
    expect(state.penyesuaian[0].prevAvgCost).toBe(50_000);
    expect(state.penyesuaian[0].newAvgCost).toBe(50_000);
    expect(state.stokUpdates[0].totalValue).toBe(12 * 50_000);
  });

  it('tidak menggerakkan stok untuk baris yang hanya diketik namanya', async () => {
    // Nota toko sering memuat barang yang bukan milik kita. Memaksanya masuk
    // buku stok akan menciptakan barang hantu tiap kali ada salah ketik.
    const h = await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemName: 'Barang tidak dikenal', qty: 5, price: 10_000 }],
    });
    expect(h).toMatchObject({ ok: true, barisStok: 0 });
    expect(state.penyesuaian).toHaveLength(0);
  });

  it('membuat baris stok baru kalau barangnya belum pernah ada', async () => {
    state.stok = null;
    await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemId: 'brg9', itemName: 'Barang Baru', qty: 3, price: 100 }],
    });
    expect(state.stokDibuat[0]).toMatchObject({ itemId: 'brg9', qtyOnHand: 3 });
  });

  it('menghitung ulang SETIAP piutang yang tersentuh', async () => {
    const h = await catatHitunganGudang({ ...DASAR, storeReturnId: 'nrt1', physicalAmount: 800_000 });
    expect(h.ok && h.piutangDihitungUlang).toBe(2);
    expect(state.dihitungUlang).toEqual(['r1', 'r2']);
  });
});

describe('jodohkanRetur', () => {
  it('menolak menjodohkan penerimaan yang sudah punya pasangan', async () => {
    state.nri = { ...state.nri, storeReturnId: 'nrtX' };
    expect(await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1' })).toEqual({
      ok: false,
      alasan: 'BUKAN_YATIM',
    });
  });

  it('menolak menjodohkan ke toko yang berbeda', async () => {
    // Memindahkan barang satu toko ke tagihan toko lain.
    state.nri = { ...state.nri, storeId: 't2' };
    expect(await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1' })).toEqual({
      ok: false,
      alasan: 'BEDA_TOKO',
    });
  });

  it('menolak nota yang sudah punya hitungan gudang', async () => {
    state.nrt = { ...state.nrt, warehouseReturn: { id: 'nri9' } };
    expect(await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1' })).toEqual({
      ok: false,
      alasan: 'SUDAH_DIHITUNG',
    });
  });

  it('menjodohkan dan menghitung ulang piutang', async () => {
    const h = await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1' });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2 });
    expect(state.nriUpdates[0]).toMatchObject({ storeReturnId: 'nrt1', storeId: 't1' });
  });
});

describe('lepasPasangan', () => {
  it('MENOLAK melepas kalau bebannya sudah diputuskan', async () => {
    // Seseorang sudah ditetapkan menanggung selisih pasangan ini; melepasnya
    // meninggalkan beban yang menunjuk perbandingan yang tidak ada lagi.
    state.nri = { ...state.nri, storeReturnId: 'nrt1' };
    state.bebanDiputuskanCount = 1;
    expect(await lepasPasangan({ warehouseReturnId: 'nri1' })).toEqual({
      ok: false,
      alasan: 'BEBAN_SUDAH_DIPUTUSKAN',
    });
    expect(state.nriUpdates).toHaveLength(0);
  });

  it('melepas dan membuang beban yang masih terbuka', async () => {
    state.nri = { ...state.nri, storeReturnId: 'nrt1' };
    const h = await lepasPasangan({ warehouseReturnId: 'nri1' });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2 });
    expect(state.bebanDihapus).toBe(1);
    expect(state.nriUpdates[0].storeReturnId).toBeNull();
  });
});

describe('putuskanBeban', () => {
  const DASAR = { chargeId: 'b1', olehUserId: 'u1', alasan: 'hilang di ekspedisi' };

  it('menolak tanpa alasan SEBELUM menulis apa pun', async () => {
    expect(await putuskanBeban({ ...DASAR, bearer: 'TOKO', alasan: '  ' })).toEqual({
      ok: false,
      alasan: 'ALASAN_WAJIB',
    });
    expect(state.bebanUpdates).toHaveLength(0);
  });

  it('menolak keputusan kedua', async () => {
    state.beban = { ...state.beban, status: 'DITETAPKAN' };
    expect(await putuskanBeban({ ...DASAR, bearer: 'TOKO' })).toEqual({
      ok: false,
      alasan: 'SUDAH_DIPUTUSKAN',
    });
  });

  it('menerima GUDANG sebagai penanggung', async () => {
    // Gudang bisa keliru menghitung atau merusak barang di tempatnya; tanpa
    // pilihan ini setiap kerugian begitu jatuh ke sales atau dihapusbukukan.
    const h = await putuskanBeban({ ...DASAR, bearer: 'GUDANG' });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2 });
    expect(state.bebanUpdates[0]).toMatchObject({ bearer: 'GUDANG', status: 'DITETAPKAN' });
  });

  it('menempelkan beban SALES pada orangnya, bukan pada perannya', async () => {
    // Itulah yang membuatnya bisa dipotong dari komisi orang itu nanti.
    await putuskanBeban({ ...DASAR, bearer: 'SALES', bearerUserId: 'sales7' });
    expect(state.bebanUpdates[0].bearerUserId).toBe('sales7');
  });

  it('tidak menempelkan orang pada beban yang bukan ke sales', async () => {
    await putuskanBeban({ ...DASAR, bearer: 'PERUSAHAAN', bearerUserId: 'sales7' });
    expect(state.bebanUpdates[0].bearerUserId).toBeNull();
  });
});

describe('tandaiBebanLunas', () => {
  it('menolak beban yang belum diputuskan', async () => {
    expect(await tandaiBebanLunas({ chargeId: 'b1' })).toEqual({
      ok: false,
      alasan: 'BELUM_DIPUTUSKAN',
    });
  });

  it('menandai lunas TANPA menyentuh piutang', async () => {
    // Fakturnya sudah dilepas saat bebannya ditetapkan. Ini penagihan pengganti
    // yang berjalan sendiri.
    state.beban = { ...state.beban, status: 'DITETAPKAN' };
    expect(await tandaiBebanLunas({ chargeId: 'b1' })).toEqual({ ok: true });
    expect(state.bebanUpdates[0].status).toBe('LUNAS');
    expect(state.dihitungUlang).toEqual([]);
  });

  it('menolak beban yang sudah lunas', async () => {
    state.beban = { ...state.beban, status: 'LUNAS' };
    expect(await tandaiBebanLunas({ chargeId: 'b1' })).toEqual({ ok: false, alasan: 'SUDAH_LUNAS' });
  });
});

describe('batalkanRetur', () => {
  it('menolak tanpa alasan', async () => {
    expect(await batalkanRetur({ storeReturnId: 'nrt1', alasan: '' })).toEqual({
      ok: false,
      alasan: 'ALASAN_WAJIB',
    });
  });

  it('MENOLAK membatalkan kalau bebannya sudah diputuskan', async () => {
    state.bebanDiputuskanCount = 1;
    expect(await batalkanRetur({ storeReturnId: 'nrt1', alasan: 'ditarik' })).toEqual({
      ok: false,
      alasan: 'BEBAN_SUDAH_DIPUTUSKAN',
    });
    expect(state.nrtUpdates).toHaveLength(0);
  });

  it('membatalkan dan menghitung ulang piutang', async () => {
    // Piutang WAJIB dihitung ulang: potongan yang menunjuk nota batal berubah
    // jadi tertahan penuh, dan sisa piutangnya naik.
    const h = await batalkanRetur({ storeReturnId: 'nrt1', alasan: 'toko menarik klaim' });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2 });
    expect(state.nrtUpdates[0].status).toBe('BATAL');
    expect(state.dihitungUlang).toEqual(['r1', 'r2']);
  });
});
