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
  /** Nota retur yang sudah tercatat dengan kunci kiriman tertentu. */
  nrtBerkunci: null as { id: string; noNrt: string; salesmanId: string | null } | null,
  kalahBalapan: 0,
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
  /** Hasil bandingkan-lalu-tukar (`updateMany`) pada beban — 0 = kalah balapan. */
  casBeban: 1,
  /** Beban TERBUKA berlapor DITEMUKAN di toko yang sama (penjaga nota baru). */
  bebanDitemukan: [] as Record<string, unknown>[],
  /** Hitungan susulan yang menempel pada nota (penjaga lepas pasangan). */
  susulanCount: 0,
  notifKantor: [] as Record<string, unknown>[],
  potongan: [] as { paymentClaimId: string }[],
  links: [] as { receivableId: string }[],
  dihitungUlang: [] as string[],
  stok: null as { id: string; qtyOnHand: number; avgCost: number } | null,
  /** Panggilan `moveMainStock` — satu per gerakan stok gudang, masing-masing menulis buku stok. */
  gerakStok: [] as Record<string, unknown>[],
  penyesuaian: [] as Record<string, unknown>[],
  jejak: [] as Record<string, unknown>[],
  /** Variasi `inventoryValue.findFirst` terakhir — untuk memeriksa pencarian varian. */
  cariStok: [] as Record<string, unknown>[],
  bukuAda: true,
  opnameTerakhir: null as { countedAt: Date } | null,
  saldoToko: [] as { itemId: string; variantSku: string; _sum: { qty: number } }[],
  bukuNota: [] as { storeId: string; itemId: string; variantSku: string; _sum: { qty: number } }[],
  gerakBuku: [] as Record<string, unknown>[],
  // Berpemegang: lonceng kantor untuk toko tanpa pemegang diuji di `retur-tanpa-pemegang.test.ts`.
  toko: null as { termsType: 'PUTUS' | 'KONSI'; markupPercent: number | null; salesmanId?: string | null } | null,
  barang: [] as { id: string; nameId: string; sellingPrice: number | null; variants: unknown }[],
  /** Nomor TRK terakhir yang sudah ada di basis data. */
  trkTerakhir: null as { noNrt: string } | null,
  /** Gerakan gudang barang rusak yang ditulis hitungan gudang. */
  gudangRusak: [] as Record<string, unknown>[],
  /** Baris retur pembeli (konter SPG) yang ditunjuk baris NRT. */
  returPembeli: [] as {
    id: string;
    itemId: string;
    variantSku: string;
    qty: number;
    condition: string;
    saleReturn: { storeId: string; status: string };
  }[],
  /** Yang sudah dikirim balik per baris retur pembeli (nota tidak batal). */
  returPembeliTerpakai: [] as { spgSaleReturnLineId: string; _sum: { qty: number } }[],
  /** Siklus konsinyasi terkunci di bulan terima penerimaan yang mendapat toko (`siklusTerkunciDi`). */
  siklusTerkunci: [] as { noKonsi: string }[],
};

const tx = {
  // Pemilik foto (`fotoBolehDipakai`): foto tiruan tidak ada di tabel `Foto`,
  // jadi tidak ada yang bisa dicuci — pemeriksaannya diuji di foto-pencatat.test.ts.
  foto: { findMany: vi.fn(async () => []) },
  storeReturn: {
    // Tidak ada nota BATAL bernomor sama di tiruan ini — pelepasan nomor diuji
    // terhadap basis data sungguhan di koreksi.test.ts.
    findFirst: vi.fn(async (a?: { where?: { noNrt?: unknown } }) =>
      typeof a?.where?.noNrt === 'object' ? state.trkTerakhir : null,
    ),
    findUnique: vi.fn(async (a?: { where?: { idempotencyKey?: string } }) =>
      a?.where?.idempotencyKey !== undefined ? state.nrtBerkunci : state.nrt,
    ),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      if (state.kalahBalapan > 0) {
        state.kalahBalapan -= 1;
        state.nrtBerkunci = { id: 'nrt-kembar', noNrt: a.data.noNrt as string, salesmanId: 'u1' };
        const { Prisma } = await import('@elorae/db');
        const err = new Prisma.PrismaClientKnownRequestError('unik', { code: 'P2002', clientVersion: 'x' });
        Object.assign(err, { meta: { target: 'StoreReturn_idempotencyKey_key' } });
        throw err;
      }
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
    count: vi.fn(async () => state.susulanCount),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.nriDibuat.push(a.data);
      const baris = ((a.data.items as { create?: Record<string, unknown>[] } | undefined)?.create ?? []).map((b, i) => ({
        id: `nrib${i + 1}`,
        itemId: (b.itemId as string | null) ?? null,
        variantSku: (b.variantSku as string | undefined) ?? '',
        itemName: b.itemName as string,
        qty: b.qty as number,
        condition: (b.condition as string | undefined) ?? 'LAYAK',
      }));
      return { id: 'nri1', noNri: a.data.noNri as string, items: baris };
    }),
    update: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.nriUpdates.push(a.data);
      return {};
    }),
  },
  returnCharge: {
    findUnique: vi.fn(async () => state.beban),
    findMany: vi.fn(async () => state.bebanDitemukan),
    count: vi.fn(async () => state.bebanDiputuskanCount),
    updateMany: vi.fn(async (a: { data: Record<string, unknown> }) => {
      if (state.casBeban !== 1) return { count: state.casBeban };
      state.bebanUpdates.push(a.data);
      return { count: 1 };
    }),
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
  auditLog: {
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.jejak.push(a.data);
      return {};
    }),
  },
  adminNotification: {
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.notifKantor.push(a.data);
      return { id: `an${state.notifKantor.length}`, ...a.data };
    }),
  },
  paymentClaimDeduction: { findMany: vi.fn(async () => state.potongan) },
  paymentClaimReceivable: { findMany: vi.fn(async () => state.links) },
  inventoryValue: {
    findFirst: vi.fn(async (a: { where: Record<string, unknown> }) => {
      state.cariStok.push(a.where);
      return state.stok;
    }),
  },
  stockAdjustment: {
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.penyesuaian.push(a.data);
      return { id: `adj${state.penyesuaian.length}`, docNumber: a.data.docNumber };
    }),
    findMany: vi.fn(async () => []),
  },
  // HPP saat dijual (`hppJualTerakhir`): tanpa penjualan sebelumnya → harga rata-rata (perilaku lama).
  fieldSalesDeliveryLine: { findMany: vi.fn(async () => []) },
  // Buku stok toko — hanya disentuh oleh NRT dari SPG dan pembatalannya.
  storeStockMovement: {
    findFirst: vi.fn(async () => (state.bukuAda ? { id: 'g0' } : null)),
    groupBy: vi.fn(async (a: { by: string[] }) => (a.by.includes('storeId') ? state.bukuNota : state.saldoToko)),
    createMany: vi.fn(async (a: { data: Record<string, unknown>[] }) => {
      state.gerakBuku.push(...a.data);
      return { count: a.data.length };
    }),
  },
  storeOpname: { findFirst: vi.fn(async () => state.opnameTerakhir) },
  damagedStockMovement: {
    findMany: vi.fn(async () => []),
    createMany: vi.fn(async (a: { data: Record<string, unknown>[] }) => {
      state.gudangRusak.push(...a.data);
      return { count: a.data.length };
    }),
  },
  spgSaleReturnLine: {
    findMany: vi.fn(async (a: { where: { id: { in: string[] } } }) => state.returPembeli.filter((r) => a.where.id.in.includes(r.id))),
  },
  storeReturnItem: { groupBy: vi.fn(async () => state.returPembeliTerpakai) },
  store: { findUnique: vi.fn(async () => state.toko) },
  consignmentCycle: { findMany: vi.fn(async () => state.siklusTerkunci) },
  item: {
    findMany: vi.fn(async (a: { where: { id: { in: string[] } } }) =>
      state.barang.filter((b) => a.where.id.in.includes(b.id)),
    ),
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
  bacaSisaPiutang: async () => 0,
}));
// Lonceng kantor disebar sesudah commit — tesnya sendiri di admin-fanout.test.ts.
vi.mock('@/lib/notifications/admin-fanout', () => ({ fanOutAdminNotification: async () => undefined }));
// Push stok ke Jubelio sesudah commit punya tesnya sendiri (return-writer-push-stok.test.ts).
vi.mock('@/lib/jubelio/antre-push-stok', () => ({
  antrekanPushStok: async () => ({ diantrekan: [], sudahAntre: [], tanpaPemetaan: [], barisGabungan: [], gagal: false }),
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
  // Penggerak stok gudang: menambah qty secara atom dan menulis buku stok. Tiruan ini hanya
  // mencatat panggilannya; penggeraknya sendiri diuji di packages/db.
  moveMainStock: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
    state.gerakStok.push(input);
    return { balanceQty: Number(state.stok?.qtyOnHand ?? 0) + Number(input.qtyDelta) };
  }),
}));

const {
  catatReturToko,
  catatHitunganGudang,
  jodohkanRetur,
  lepasPasangan,
  putuskanBeban,
  tandaiBebanLunas,
  batalkanRetur,
  nilaiDariRincian,
  alihkanBeban,
  laporHasilCekSelisih,
  lebihBayarBaru,
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
  state.nrtBerkunci = null;
  state.kalahBalapan = 0;
  state.nrtDibuat = [];
  state.nriDibuat = [];
  state.nrtUpdates = [];
  state.nriUpdates = [];
  state.beban = { id: 'b1', status: 'TERBUKA', amount: 200_000, storeReturnId: 'nrt1' };
  state.bebanDibuat = [];
  state.bebanUpdates = [];
  state.bebanDihapus = 0;
  state.bebanDiputuskanCount = 0;
  state.casBeban = 1;
  state.bebanDitemukan = [];
  state.susulanCount = 0;
  state.notifKantor = [];
  state.potongan = [{ paymentClaimId: 'k1' }];
  state.links = [{ receivableId: 'r1' }, { receivableId: 'r2' }];
  state.dihitungUlang = [];
  state.stok = { id: 'iv1', qtyOnHand: 10, avgCost: 50_000 };
  state.gerakStok = [];
  state.penyesuaian = [];
  state.jejak = [];
  state.cariStok = [];
  state.bukuAda = true;
  state.opnameTerakhir = null;
  state.saldoToko = [];
  state.bukuNota = [];
  state.gerakBuku = [];
  state.toko = { termsType: 'KONSI', markupPercent: 20, salesmanId: 'pemegang1' };
  state.barang = [
    { id: 'brg1', nameId: 'Kemeja', sellingPrice: 80_000, variants: [{ sku: 'KMJ-M', size: 'M' }] },
    { id: 'brg2', nameId: 'Blus', sellingPrice: null, variants: [] },
  ];
  state.trkTerakhir = null;
  state.gudangRusak = [];
  state.returPembeli = [];
  state.returPembeliTerpakai = [];
  state.siklusTerkunci = [];
  tx.consignmentCycle.findMany.mockClear();
});

const NRT_DASAR = {
  noNrt: 'NRT-4402',
  storeId: 't1',
  claimDate: HARI_INI,
  deliveryMethod: 'SALES' as const,
  olehUserId: 'u1',
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

describe('catatReturToko — kiriman dari antrean offline HP', () => {
  const KIRIMAN = { ...NRT_DASAR, salesmanId: 'u1', claimedAmount: 870_000, idempotencyKey: 'hp-9' };

  it('menyimpan kunci kirimannya pada nota baru', async () => {
    await catatReturToko(KIRIMAN);
    expect(state.nrtDibuat[0].idempotencyKey).toBe('hp-9');
  });

  it('mengembalikan nota yang sudah ada untuk kunci yang sama', async () => {
    // Tanpa ini kiriman ulang ditolak "nomor sudah dipakai" — oleh notanya
    // sendiri — dan sales mengira laporannya gagal.
    state.nrtBerkunci = { id: 'nrt0', noNrt: 'NRT-4402', salesmanId: 'u1' };
    expect(await catatReturToko(KIRIMAN)).toEqual({ ok: true, id: 'nrt0', noNrt: 'NRT-4402' });
    expect(state.nrtDibuat).toHaveLength(0);
    expect(state.jejak).toHaveLength(0);
  });

  it('tidak menyerahkan nota milik sales lain', async () => {
    state.nrtBerkunci = { id: 'nrtX', noNrt: 'NRT-1', salesmanId: 'u9' };
    expect(await catatReturToko(KIRIMAN)).toEqual({ ok: false, alasan: 'KUNCI_DIPAKAI' });
  });

  it('kiriman kembar yang tiba bersamaan menghasilkan satu nota, bukan "nomor sudah dipakai"', async () => {
    state.kalahBalapan = 1;
    expect(await catatReturToko(KIRIMAN)).toEqual({ ok: true, id: 'nrt-kembar', noNrt: 'NRT-4402' });
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
    expect(state.penyesuaian[0]).toMatchObject({
      type: 'POSITIVE',
      qtyChange: 2,
      prevQty: 10,
      newQty: 12,
      source: 'STORE_RETURN_RECEIVE',
    });
    // Lewat penggerak stok (+2, buku stok ikut tertulis), dipatok ke baris yang dibaca, dan
    // baris buku stoknya menunjuk penyesuaian itu.
    expect(state.gerakStok).toHaveLength(1);
    expect(state.gerakStok[0]).toMatchObject({
      itemId: 'brg1',
      variantSku: null,
      qtyDelta: 2,
      inventoryValueId: 'iv1',
      createIfMissing: false,
      totalValue: 12 * 50_000,
      balanceValue: 12 * 50_000,
      refType: 'StockAdjustment',
      refId: 'adj1',
      refDocNumber: 'ADJ/2026/0001',
      createdById: 'g1',
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
    // Tanpa `avgCost`: penggeraknya tidak menyentuh harga rata-rata; nilai masuknya × harga lama.
    expect(state.gerakStok[0]).not.toHaveProperty('avgCost');
    expect(state.gerakStok[0]).toMatchObject({ unitCost: 50_000, totalCost: 2 * 50_000 });
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
    expect(state.gerakStok).toHaveLength(0);
  });

  it('membuat baris stok baru kalau barangnya belum pernah ada', async () => {
    state.stok = null;
    await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemId: 'brg9', itemName: 'Barang Baru', qty: 3, price: 100 }],
    });
    // Penggeraknya yang membuka baris (tanpa varian = null) dengan +3 sebagai saldo awalnya.
    expect(state.gerakStok[0]).toMatchObject({ itemId: 'brg9', variantSku: null, qtyDelta: 3, createIfMissing: true });
    expect(state.gerakStok[0].inventoryValueId).toBeUndefined();
    expect(state.penyesuaian[0]).toMatchObject({ prevQty: 0, newQty: 3 });
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
    expect(await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1', olehUserId: 'u1' })).toEqual({
      ok: false,
      alasan: 'BUKAN_YATIM',
    });
  });

  it('menolak menjodohkan hitungan SUSULAN nota lain — ia bukan yatim', async () => {
    state.nri = { ...state.nri, followUpOfStoreReturnId: 'nrtX' };
    expect(await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1', olehUserId: 'u1' })).toEqual({
      ok: false,
      alasan: 'BUKAN_YATIM',
    });
    expect(state.nriUpdates).toHaveLength(0);
  });

  it('menolak menjodohkan ke toko yang berbeda', async () => {
    // Memindahkan barang satu toko ke tagihan toko lain.
    state.nri = { ...state.nri, storeId: 't2' };
    expect(await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1', olehUserId: 'u1' })).toEqual({
      ok: false,
      alasan: 'BEDA_TOKO',
    });
  });

  it('menolak nota yang sudah punya hitungan gudang', async () => {
    state.nrt = { ...state.nrt, warehouseReturn: { id: 'nri9' } };
    expect(await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1', olehUserId: 'u1' })).toEqual({
      ok: false,
      alasan: 'SUDAH_DIHITUNG',
    });
  });

  it('menjodohkan dan menghitung ulang piutang', async () => {
    const h = await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1', olehUserId: 'u1' });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2, selisihBaru: null });
    expect(state.nriUpdates[0]).toMatchObject({ storeReturnId: 'nrt1', storeId: 't1' });
  });

  it('penerimaan TANPA toko di bulan yang sudah dikunci di siklus konsinyasi toko nota: ditolak sampai dikonfirmasi', async () => {
    // Penerimaannya mendapat toko nota — stok titipan bulan terimanya di toko itu berubah,
    // sama dengan `jadikanSusulan` dan `pindahkanNriKeToko`.
    state.nri = { ...state.nri, receivedAt: HARI_INI };
    state.siklusTerkunci = [{ noKonsi: 'KONSI/2026/08/0001' }];
    expect(await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1', olehUserId: 'u1' })).toEqual({
      ok: false,
      alasan: 'SIKLUS_TERKUNCI',
      noKonsi: ['KONSI/2026/08/0001'],
    });
    expect(state.nriUpdates).toHaveLength(0);
    expect(state.jejak).toHaveLength(0);
    expect(tx.consignmentCycle.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ storeId: { in: ['t1'] }, periodYear: 2026, periodMonth: 8 }),
      }),
    );

    const h = await jodohkanRetur({
      warehouseReturnId: 'nri1',
      storeReturnId: 'nrt1',
      olehUserId: 'u1',
      setujuSiklusTerkunci: true,
    });
    expect(h).toMatchObject({ ok: true });
    expect(state.nriUpdates[0]).toMatchObject({ storeReturnId: 'nrt1', storeId: 't1' });
    const jejak = state.jejak.find((j) => j.action === 'STORE_RETURN_MATCHED');
    expect((jejak?.metadata as Record<string, unknown>).siklusTerkunci).toEqual(['KONSI/2026/08/0001']);
  });

  it('penerimaan yang sudah bertoko tidak diperiksa siklusnya — tokonya tidak berubah', async () => {
    state.nri = { ...state.nri, storeId: 't1', receivedAt: HARI_INI };
    state.siklusTerkunci = [{ noKonsi: 'KONSI/2026/08/0001' }];
    expect(await jodohkanRetur({ warehouseReturnId: 'nri1', storeReturnId: 'nrt1', olehUserId: 'u1' })).toMatchObject({
      ok: true,
    });
    expect(tx.consignmentCycle.findMany).not.toHaveBeenCalled();
    const jejak = state.jejak.find((j) => j.action === 'STORE_RETURN_MATCHED');
    expect((jejak?.metadata as Record<string, unknown>).siklusTerkunci).toBeUndefined();
  });
});

describe('lepasPasangan', () => {
  it('MENOLAK melepas kalau bebannya sudah diputuskan', async () => {
    // Seseorang sudah ditetapkan menanggung selisih pasangan ini; melepasnya
    // meninggalkan beban yang menunjuk perbandingan yang tidak ada lagi.
    state.nri = { ...state.nri, storeReturnId: 'nrt1' };
    state.bebanDiputuskanCount = 1;
    expect(await lepasPasangan({ warehouseReturnId: 'nri1', olehUserId: 'u1' })).toEqual({
      ok: false,
      alasan: 'BEBAN_SUDAH_DIPUTUSKAN',
    });
    expect(state.nriUpdates).toHaveLength(0);
  });

  it('MENOLAK melepas selama nota itu punya hitungan susulan', async () => {
    state.nri = { ...state.nri, storeReturnId: 'nrt1' };
    state.susulanCount = 1;
    expect(await lepasPasangan({ warehouseReturnId: 'nri1', olehUserId: 'u1' })).toEqual({ ok: false, alasan: 'ADA_SUSULAN' });
    expect(state.nriUpdates).toHaveLength(0);
    expect(state.bebanDihapus).toBe(0);
  });

  it('melepas dan membuang beban yang masih terbuka', async () => {
    state.nri = { ...state.nri, storeReturnId: 'nrt1' };
    const h = await lepasPasangan({ warehouseReturnId: 'nri1', olehUserId: 'u1' });
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

  it('menolak TOKO di toko konsinyasi — tidak ada nota asal yang menahan selisihnya', async () => {
    state.beban = { ...state.beban, storeId: 't1' };
    state.toko = { termsType: 'KONSI', markupPercent: 20 };
    expect(await putuskanBeban({ ...DASAR, bearer: 'TOKO' })).toEqual({ ok: false, alasan: 'TOKO_KONSI' });
    expect(state.bebanUpdates).toHaveLength(0);
  });

  it('TOKO di toko putus: diputuskan tanpa faktur baru — selisihnya tetap terbuka di nota asal', async () => {
    state.beban = { ...state.beban, storeId: 't1' };
    state.toko = { termsType: 'PUTUS', markupPercent: null };
    const h = await putuskanBeban({ ...DASAR, bearer: 'TOKO' });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2 });
    expect(state.bebanUpdates[0]).toMatchObject({ bearer: 'TOKO', status: 'DITETAPKAN' });
    expect(state.dihitungUlang).toEqual(['r1', 'r2']);
  });

  it('kantor memilih orangnya: siapa pun yang dipilih tersimpan, tidak dipaksa pemegang toko (P85)', async () => {
    await putuskanBeban({ ...DASAR, bearer: 'SALES', bearerUserId: 'sales-lain' });
    expect(state.bebanUpdates[0]).toMatchObject({ bearer: 'SALES', bearerUserId: 'sales-lain' });
  });

  it('kalah balapan bandingkan-lalu-tukar = sudah diputuskan, tanpa jejak', async () => {
    state.casBeban = 0;
    expect(await putuskanBeban({ ...DASAR, bearer: 'GUDANG' })).toEqual({ ok: false, alasan: 'SUDAH_DIPUTUSKAN' });
    expect(state.jejak).toHaveLength(0);
  });
});

describe('tandaiBebanLunas', () => {
  it('menolak beban yang belum diputuskan', async () => {
    expect(await tandaiBebanLunas({ chargeId: 'b1', olehUserId: 'u1' })).toEqual({
      ok: false,
      alasan: 'BELUM_DIPUTUSKAN',
    });
  });

  it('menandai lunas TANPA menyentuh piutang (gudang / perusahaan), tercatat terbayar penuh', async () => {
    // Fakturnya sudah dilepas saat bebannya ditetapkan. Ini penagihan pengganti
    // yang berjalan sendiri.
    state.beban = { ...state.beban, status: 'DITETAPKAN', bearer: 'GUDANG' };
    expect(await tandaiBebanLunas({ chargeId: 'b1', olehUserId: 'u1' })).toEqual({ ok: true });
    expect(state.bebanUpdates[0].status).toBe('LUNAS');
    expect(Number((state.bebanUpdates[0].settledAmount as { value: number }).value)).toBe(200_000);
    expect(state.dihitungUlang).toEqual([]);
  });

  it('menolak beban TOKO — dibayar lewat nota asalnya', async () => {
    state.beban = { ...state.beban, status: 'DITETAPKAN', bearer: 'TOKO' };
    expect(await tandaiBebanLunas({ chargeId: 'b1', olehUserId: 'u1' })).toEqual({ ok: false, alasan: 'DITAGIH_LEWAT_PIUTANG' });
  });

  it('menolak beban SALES — dipotong dari komisinya di Laporan → Komisi salesman', async () => {
    state.beban = { ...state.beban, status: 'DITETAPKAN', bearer: 'SALES' };
    expect(await tandaiBebanLunas({ chargeId: 'b1', olehUserId: 'u1' })).toEqual({ ok: false, alasan: 'POTONG_LEWAT_KOMISI' });
    expect(state.bebanUpdates).toHaveLength(0);
  });

  it('menolak beban yang sudah lunas', async () => {
    state.beban = { ...state.beban, status: 'LUNAS' };
    expect(await tandaiBebanLunas({ chargeId: 'b1', olehUserId: 'u1' })).toEqual({ ok: false, alasan: 'SUDAH_LUNAS' });
  });
});

describe('batalkanRetur', () => {
  it('menolak tanpa alasan', async () => {
    expect(await batalkanRetur({ storeReturnId: 'nrt1', alasan: '', olehUserId: 'u1' })).toEqual({
      ok: false,
      alasan: 'ALASAN_WAJIB',
    });
  });

  it('MENOLAK membatalkan kalau bebannya sudah diputuskan', async () => {
    state.bebanDiputuskanCount = 1;
    expect(await batalkanRetur({ storeReturnId: 'nrt1', alasan: 'ditarik', olehUserId: 'u1' })).toEqual({
      ok: false,
      alasan: 'BEBAN_SUDAH_DIPUTUSKAN',
    });
    expect(state.nrtUpdates).toHaveLength(0);
  });

  it('membatalkan dan menghitung ulang piutang', async () => {
    // Piutang WAJIB dihitung ulang: potongan yang menunjuk nota batal berubah
    // jadi tertahan penuh, dan sisa piutangnya naik.
    const h = await batalkanRetur({ storeReturnId: 'nrt1', alasan: 'toko menarik klaim', olehUserId: 'u1' });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2 });
    expect(state.nrtUpdates[0].status).toBe('BATAL');
    expect(state.dihitungUlang).toEqual(['r1', 'r2']);
  });
});

describe('nilaiDariRincian — rincian tanpa harga tidak menghapus nilai yang diketik', () => {
  it('memakai angka yang diketik kalau SEMUA harga baris nol', () => {
    expect(nilaiDariRincian([{ qty: 3, price: 0 }, { qty: 1, price: 0 }], 450_000)).toBe(450_000);
  });

  it('memakai jumlah rincian kalau ada satu saja harga', () => {
    expect(nilaiDariRincian([{ qty: 3, price: 0 }, { qty: 1, price: 10_000 }], 450_000)).toBe(10_000);
  });

  it('memakai angka yang diketik kalau rinciannya kosong', () => {
    expect(nilaiDariRincian([], 70_000)).toBe(70_000);
  });
});

describe('catatHitunganGudang — per baris, per varian, per kondisi', () => {
  const DASAR = {
    warehouseUserId: 'g1',
    receivedAt: HARI_INI,
    deliveryMethod: 'SALES' as const,
  };

  it('nilai fisik yang diketik MENANG kalau semua harga baris nol', async () => {
    // NRT SPG toko putus: barisnya hanya qty. Tanpa aturan ini fisiknya
    // terbaca nol dan seluruh klaim berubah jadi selisih.
    await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      physicalAmount: 640_000,
      items: [{ itemId: 'brg1', itemName: 'Kemeja', qty: 2, price: 0 }],
    });
    expect(Number((state.nriDibuat[0].physicalAmount as { value: number }).value)).toBe(640_000);
  });

  it('mencari stok varian PERSIS kalau variantSku diisi', async () => {
    await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja', qty: 1, price: 0 }],
    });
    expect(state.cariStok[0]).toEqual({ itemId: 'brg1', variantSku: 'KMJ-M' });
  });

  it('mencari dengan toleran (null atau "") kalau variantSku kosong', async () => {
    await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemId: 'brg2', itemName: 'Blus', qty: 1, price: 0 }],
    });
    expect(state.cariStok[0]).toEqual({ itemId: 'brg2', OR: [{ variantSku: null }, { variantSku: '' }] });
  });

  it('membuat baris stok varian baru dengan variantSku-nya, bukan baris pukul-rata', async () => {
    state.stok = null;
    await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja', qty: 2, price: 0 }],
    });
    expect(state.gerakStok[0]).toMatchObject({ itemId: 'brg1', variantSku: 'KMJ-M', qtyDelta: 2, createIfMissing: true });
  });

  it('TIDAK memasukkan baris RUSAK atau EXPIRED ke stok jual, tapi tetap mencatatnya', async () => {
    const h = await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      physicalAmount: 1,
      items: [
        { itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja', qty: 2, price: 0, condition: 'LAYAK' },
        { itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja', qty: 1, price: 0, condition: 'RUSAK' },
        { itemId: 'brg2', itemName: 'Blus', qty: 1, price: 0, condition: 'EXPIRED' },
      ],
    });
    expect(h).toMatchObject({ ok: true, barisStok: 1 });
    expect(state.penyesuaian).toHaveLength(1);
    expect(state.penyesuaian[0].qtyChange).toBe(2);
    const dibuat = (state.nriDibuat[0].items as { create: { condition?: string; qty: number }[] }).create;
    expect(dibuat.map((d) => d.condition)).toEqual(['LAYAK', 'RUSAK', 'EXPIRED']);
  });

  it('menyalin qty klaim per barang + varian, bukan per nama', async () => {
    // Dua varian satu barang bernama sama; dipetakan per nama, keduanya
    // mendapat qty klaim varian yang terakhir.
    state.nrt = {
      ...state.nrt,
      items: [
        { itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja', qty: 3 },
        { itemId: 'brg1', variantSku: 'KMJ-L', itemName: 'Kemeja', qty: 5 },
      ],
    };
    await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      physicalAmount: 0,
      items: [
        { itemId: 'brg1', variantSku: 'KMJ-L', itemName: 'Kemeja', qty: 4, price: 0 },
        { itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja', qty: 3, price: 0 },
      ],
    });
    const dibuat = (state.nriDibuat[0].items as { create: { variantSku?: string; qtyClaim: number }[] }).create;
    expect(dibuat).toEqual([
      expect.objectContaining({ variantSku: 'KMJ-L', qtyClaim: 5 }),
      expect.objectContaining({ variantSku: 'KMJ-M', qtyClaim: 3 }),
    ]);
  });
});

describe('catatReturToko — NRT dari SPG', () => {
  const SPG = {
    ...NRT_DASAR,
    noNrt: '',
    salesmanId: 'spg1',
    olehUserId: 'spg1',
    reportedBySpg: true,
    barisSpg: [{ itemId: 'brg1', variantSku: 'KMJ-M', qty: 2, condition: 'LAYAK' as const }],
  };

  it('menolak NRT SPG tanpa baris barang', async () => {
    expect(await catatReturToko({ ...SPG, barisSpg: [] })).toEqual({ ok: false, alasan: 'BARIS_WAJIB' });
    expect(state.nrtDibuat).toHaveLength(0);
  });

  it('KONSI tanpa nomor: sistem memberi nomor TRK bulan WIB', async () => {
    state.trkTerakhir = { noNrt: 'TRK/26/08/0007 (batal)' };
    const h = await catatReturToko(SPG);
    expect(h).toEqual({ ok: true, id: 'nrt1', noNrt: 'TRK/26/08/0008' });
    expect(state.nrtDibuat[0]).toMatchObject({ noNrt: 'TRK/26/08/0008', reportedBySpg: true });
  });

  it('KONSI: nilai klaim dihitung server dari harga konsinyasi, bukan dari HP', async () => {
    // 80.000 × (1 + 20%) = 96.000 per potong.
    await catatReturToko({ ...SPG, claimedAmount: 1 });
    expect(Number((state.nrtDibuat[0].claimedAmount as { value: number }).value)).toBe(192_000);
    const baris = (state.nrtDibuat[0].items as { create: Record<string, unknown>[] }).create;
    expect(baris[0]).toMatchObject({ itemId: 'brg1', variantSku: 'KMJ-M', qty: 2, condition: 'LAYAK', itemName: 'Kemeja — size: M' });
  });

  it('KONSI: barang tanpa harga jual tetap bisa dikembalikan (bernilai nol)', async () => {
    const h = await catatReturToko({ ...SPG, barisSpg: [{ itemId: 'brg2', qty: 1 }] });
    expect(h).toMatchObject({ ok: true });
    expect(Number((state.nrtDibuat[0].claimedAmount as { value: number }).value)).toBe(0);
  });

  it('KONSI tanpa markup yang sah: ditolak, tidak dinilai harga katalog', async () => {
    // Harga katalog (80.000) di tempat harga konsinyasi (96.000) mengecilkan
    // klaim barang titipan yang kembali tanpa ada yang melihatnya.
    for (const markupPercent of [null, -5, 1_000]) {
      state.toko = { termsType: 'KONSI', markupPercent, salesmanId: 'pemegang1' };
      expect(await catatReturToko(SPG)).toEqual({ ok: false, alasan: 'HARGA_KONSI_TIDAK_SAH' });
    }
    expect(state.nrtDibuat).toHaveLength(0);
    expect(state.gerakBuku).toHaveLength(0);
  });

  it('menolak barang yang tidak ada di master', async () => {
    expect(await catatReturToko({ ...SPG, barisSpg: [{ itemId: 'hantu', qty: 1 }] })).toEqual({
      ok: false,
      alasan: 'BARANG_TIDAK_DITEMUKAN',
    });
  });

  it('PUTUS: nomor nota toko wajib', async () => {
    state.toko = { termsType: 'PUTUS', markupPercent: null, salesmanId: 'pemegang1' };
    expect(await catatReturToko({ ...SPG, claimedAmount: 150_000, photoUrl: '/api/foto/1' })).toEqual({
      ok: false,
      alasan: 'NOMOR_WAJIB',
    });
  });

  it('PUTUS: foto nota toko wajib', async () => {
    state.toko = { termsType: 'PUTUS', markupPercent: null, salesmanId: 'pemegang1' };
    expect(await catatReturToko({ ...SPG, noNrt: 'RT-9', claimedAmount: 150_000 })).toEqual({
      ok: false,
      alasan: 'FOTO_WAJIB',
    });
  });

  it('PUTUS: nilainya total nota toko yang diketik; barisnya hanya qty', async () => {
    state.toko = { termsType: 'PUTUS', markupPercent: null, salesmanId: 'pemegang1' };
    const h = await catatReturToko({ ...SPG, noNrt: 'RT-9', claimedAmount: 150_000, photoUrl: '/api/foto/1' });
    expect(h).toEqual({ ok: true, id: 'nrt1', noNrt: 'RT-9' });
    expect(Number((state.nrtDibuat[0].claimedAmount as { value: number }).value)).toBe(150_000);
    const baris = (state.nrtDibuat[0].items as { create: { price: { value: number } }[] }).create;
    expect(baris[0].price.value).toBe(0);
  });

  it('menulis RETUR_KELUAR −qty ke buku toko di transaksi yang sama', async () => {
    await catatReturToko(SPG);
    expect(state.gerakBuku).toEqual([
      expect.objectContaining({ storeId: 't1', itemId: 'brg1', variantSku: 'KMJ-M', qty: -2, kind: 'RETUR_KELUAR', refType: 'StoreReturn', refId: 'nrt1' }),
    ]);
  });

  it('melewati buku toko yang belum dimulai', async () => {
    state.bukuAda = false;
    await catatReturToko(SPG);
    expect(state.gerakBuku).toHaveLength(0);
    expect((state.jejak[0].metadata as Record<string, unknown>).bukuToko).toBe('BELUM_ADA_BUKU');
  });

  it('melewati retur bertanggal pada HARI sebelum opname terakhir (opname sudah menghitungnya)', async () => {
    state.opnameTerakhir = { countedAt: new Date(HARI_INI.getTime() + 26 * 3_600_000) };
    await catatReturToko(SPG);
    expect(state.gerakBuku).toHaveLength(0);
    expect((state.jejak[0].metadata as Record<string, unknown>).bukuToko).toBe('SEBELUM_OPNAME');
  });

  it('retur di HARI yang sama dengan opname tetap keluar dari buku (tanggal nota tanpa jam, opname berjam)', async () => {
    // Tanggal nota tengah malam; opname sore harinya. Barangnya ikut terhitung
    // di opname itu, jadi laporan retur sesudahnya harus mengurangi buku.
    state.opnameTerakhir = { countedAt: new Date(HARI_INI.getTime() + 19 * 3_600_000) };
    await catatReturToko(SPG);
    expect(state.gerakBuku).toEqual([expect.objectContaining({ qty: -2, kind: 'RETUR_KELUAR' })]);
  });

  it('tidak menolak qty di atas saldo buku, tapi mencatatnya di jejak', async () => {
    state.saldoToko = [{ itemId: 'brg1', variantSku: 'KMJ-M', _sum: { qty: 1 } }];
    expect(await catatReturToko(SPG)).toMatchObject({ ok: true });
    expect((state.jejak[0].metadata as Record<string, unknown>).melebihiSaldo).toEqual([
      { itemId: 'brg1', variantSku: 'KMJ-M', qty: 2, saldo: 1 },
    ]);
  });

  it('NRT salesman (bukan SPG) tidak menyentuh buku toko', async () => {
    await catatReturToko({ ...NRT_DASAR, claimedAmount: 870_000 });
    expect(state.gerakBuku).toHaveLength(0);
    expect(state.nrtDibuat[0].reportedBySpg).toBeUndefined();
  });
});

describe('batalkanRetur — membalik buku toko', () => {
  it('menulis pembalik +qty untuk RETUR_KELUAR yang masih bersisa, tanpa menghapus', async () => {
    state.bukuNota = [{ storeId: 't1', itemId: 'brg1', variantSku: 'KMJ-M', _sum: { qty: -2 } }];
    await batalkanRetur({ storeReturnId: 'nrt1', alasan: 'salah barang', olehUserId: 'u1' });
    expect(state.gerakBuku).toEqual([
      expect.objectContaining({ storeId: 't1', itemId: 'brg1', variantSku: 'KMJ-M', qty: 2, kind: 'RETUR_KELUAR', refId: 'nrt1' }),
    ]);
  });

  it('tidak menulis pembalik kedua kalau sudah dibalik', async () => {
    state.bukuNota = [{ storeId: 't1', itemId: 'brg1', variantSku: 'KMJ-M', _sum: { qty: 0 } }];
    await batalkanRetur({ storeReturnId: 'nrt1', alasan: 'salah barang', olehUserId: 'u1' });
    expect(state.gerakBuku).toHaveLength(0);
  });
});

describe('catatHitunganGudang — gudang barang rusak', () => {
  const DASAR = { warehouseUserId: 'g1', receivedAt: HARI_INI, deliveryMethod: 'SALES' as const, storeReturnId: 'nrt1', physicalAmount: 1 };

  it('baris RUSAK/EXPIRED ber-barang katalog masuk gudang barang rusak, satu gerakan per baris NRI', async () => {
    const h = await catatHitunganGudang({
      ...DASAR,
      items: [
        { itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja M', qty: 2, price: 0, condition: 'LAYAK' },
        { itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja M', qty: 1, price: 0, condition: 'RUSAK' },
        { itemId: 'brg2', itemName: 'Blus', qty: 3, price: 0, condition: 'EXPIRED' },
        // Diketik namanya saja: tidak punya tempat di buku barang.
        { itemName: 'Barang tanpa kode', qty: 1, price: 0, condition: 'RUSAK' },
      ],
    });
    expect(h).toMatchObject({ ok: true, barisStok: 1, barisGudangRusak: 2 });
    expect(state.gudangRusak).toEqual([
      expect.objectContaining({ itemId: 'brg1', variantSku: 'KMJ-M', qty: 1, kind: 'MASUK_RETUR', refType: 'WarehouseReturnItem', refId: 'nrib2', createdById: 'g1' }),
      expect.objectContaining({ itemId: 'brg2', variantSku: '', qty: 3, kind: 'MASUK_RETUR', refType: 'WarehouseReturnItem', refId: 'nrib3' }),
    ]);
    // Stok JUAL tetap hanya yang LAYAK.
    expect(state.penyesuaian).toHaveLength(1);
    expect((state.jejak[0].metadata as Record<string, unknown>).barisGudangRusak).toBe(2);
  });

  it('hitungan tanpa barang rusak tidak menulis apa pun ke gudang barang rusak', async () => {
    const h = await catatHitunganGudang({
      ...DASAR,
      items: [{ itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja M', qty: 2, price: 0, condition: 'LAYAK' }],
    });
    expect(h).toMatchObject({ ok: true, barisGudangRusak: 0 });
    expect(state.gudangRusak).toHaveLength(0);
    expect((state.jejak[0].metadata as Record<string, unknown>).barisGudangRusak).toBeUndefined();
  });
});

describe('catatReturToko — barang rusak dari pembeli (retur konter SPG)', () => {
  const SPG = {
    ...NRT_DASAR,
    noNrt: '',
    salesmanId: 'spg1',
    olehUserId: 'spg1',
    reportedBySpg: true,
    barisSpg: [{ itemId: 'brg1', variantSku: 'KMJ-M', qty: 2, condition: 'RUSAK' as const, spgSaleReturnLineId: 'rpl1' }],
  };
  beforeEach(() => {
    state.returPembeli = [
      { id: 'rpl1', itemId: 'brg1', variantSku: 'KMJ-M', qty: 3, condition: 'RUSAK', saleReturn: { storeId: 't1', status: 'DISETUJUI' } },
    ];
  });

  it('menyimpan penunjuknya dan TIDAK menulis RETUR_KELUAR (barangnya tidak pernah kembali ke rak)', async () => {
    const h = await catatReturToko(SPG);
    expect(h).toMatchObject({ ok: true });
    const baris = (state.nrtDibuat[0].items as { create: Record<string, unknown>[] }).create;
    expect(baris[0]).toMatchObject({ itemId: 'brg1', variantSku: 'KMJ-M', qty: 2, condition: 'RUSAK', spgSaleReturnLineId: 'rpl1' });
    expect(state.gerakBuku).toHaveLength(0);
    expect((state.jejak[0].metadata as Record<string, unknown>).barisTanpaBuku).toBe(1);
  });

  it('baris biasa di nota yang sama tetap keluar dari buku', async () => {
    await catatReturToko({ ...SPG, barisSpg: [...SPG.barisSpg, { itemId: 'brg1', variantSku: 'KMJ-M', qty: 1, condition: 'LAYAK' as const }] });
    expect(state.gerakBuku).toEqual([expect.objectContaining({ itemId: 'brg1', qty: -1, kind: 'RETUR_KELUAR' })]);
  });

  it('menolak retur pembeli toko lain', async () => {
    state.returPembeli[0].saleReturn.storeId = 't-lain';
    expect(await catatReturToko(SPG)).toEqual({ ok: false, alasan: 'RETUR_PEMBELI_TIDAK_SAH' });
    expect(state.nrtDibuat).toHaveLength(0);
  });

  it('menolak retur pembeli yang belum disetujui kantor — penulisnya yang menahan, bukan hanya layar', async () => {
    state.returPembeli[0].saleReturn.status = 'MENUNGGU';
    expect(await catatReturToko(SPG)).toEqual({ ok: false, alasan: 'RETUR_PEMBELI_TIDAK_SAH' });
    expect(state.nrtDibuat).toHaveLength(0);
    expect(state.jejak).toHaveLength(0);
  });

  it.each(['DITOLAK', 'DIBATALKAN'])('menolak retur pembeli berstatus %s — tidak pernah berlaku', async (status) => {
    state.returPembeli[0].saleReturn.status = status;
    expect(await catatReturToko(SPG)).toEqual({ ok: false, alasan: 'RETUR_PEMBELI_TIDAK_SAH' });
    expect(state.nrtDibuat).toHaveLength(0);
  });

  it('memilih status laporan retur pembeli saat membaca barisnya', async () => {
    await catatReturToko(SPG);
    const a = tx.spgSaleReturnLine.findMany.mock.calls.at(-1)?.[0] as unknown as {
      select: { saleReturn: { select: Record<string, boolean> } };
    };
    expect(a.select.saleReturn.select).toMatchObject({ storeId: true, status: true });
  });

  it('menolak retur pembeli yang LAYAK, atau baris NRT-nya LAYAK', async () => {
    state.returPembeli[0].condition = 'LAYAK';
    expect(await catatReturToko(SPG)).toEqual({ ok: false, alasan: 'RETUR_PEMBELI_TIDAK_SAH' });
    state.returPembeli[0].condition = 'RUSAK';
    expect(await catatReturToko({ ...SPG, barisSpg: [{ ...SPG.barisSpg[0], condition: 'LAYAK' as const }] })).toEqual({
      ok: false,
      alasan: 'RETUR_PEMBELI_TIDAK_SAH',
    });
  });

  it('menolak barang atau varian yang berbeda, dan penunjuk yang tidak ada', async () => {
    state.returPembeli[0].variantSku = 'KMJ-L';
    expect(await catatReturToko(SPG)).toEqual({ ok: false, alasan: 'RETUR_PEMBELI_TIDAK_SAH' });
    state.returPembeli = [];
    expect(await catatReturToko(SPG)).toEqual({ ok: false, alasan: 'RETUR_PEMBELI_TIDAK_SAH' });
  });

  it('menolak baris yang sekaligus menunjuk baris tanda terima', async () => {
    expect(await catatReturToko({ ...SPG, barisSpg: [{ ...SPG.barisSpg[0], storeReceiptLineId: 'srl1' }] })).toEqual({
      ok: false,
      alasan: 'RETUR_PEMBELI_TIDAK_SAH',
    });
  });

  it('menolak jumlah di atas qty rusak dikurangi yang sudah dikirim di nota yang tidak batal', async () => {
    state.returPembeliTerpakai = [{ spgSaleReturnLineId: 'rpl1', _sum: { qty: 2 } }];
    expect(await catatReturToko(SPG)).toEqual({ ok: false, alasan: 'RETUR_PEMBELI_MELEBIHI' });
    expect(await catatReturToko({ ...SPG, barisSpg: [{ ...SPG.barisSpg[0], qty: 1 }] })).toMatchObject({ ok: true });
  });
});

describe('catatHitunganGudang — hitungan dimulai kosong, dua tangan', () => {
  const DASAR = { warehouseUserId: 'g1', receivedAt: HARI_INI, deliveryMethod: 'SALES' as const };

  it('menolak baris bernama yang jumlahnya belum diisi — tidak membuangnya diam-diam', async () => {
    const h = await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [
        { itemName: 'Cat Tembok', qty: 2, price: 0 },
        { itemName: 'Kuas', qty: Number.NaN, price: 0 },
      ],
      physicalAmount: 500_000,
    });
    expect(h).toEqual({ ok: false, alasan: 'HITUNGAN_KOSONG' });
    expect(state.nriDibuat).toHaveLength(0);
  });

  it('menolak jumlah yang bukan bilangan bulat atau negatif', async () => {
    for (const qty of [1.5, -1, null as unknown as number]) {
      expect(
        await catatHitunganGudang({ ...DASAR, storeReturnId: 'nrt1', items: [{ itemName: 'Cat Tembok', qty, price: 0 }], physicalAmount: 0 }),
      ).toEqual({ ok: false, alasan: 'HITUNGAN_KOSONG' });
    }
  });

  it('menerima nol yang diketik pada baris', async () => {
    const h = await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemName: 'Cat Tembok', qty: 0, price: 0 }],
      physicalAmount: 0,
    });
    expect(h).toMatchObject({ ok: true });
  });

  it('mengembalikan klaim toko SESUDAH tersimpan, untuk dibandingkan di layar', async () => {
    const h = await catatHitunganGudang({
      ...DASAR,
      storeReturnId: 'nrt1',
      items: [{ itemName: 'Cat Tembok', qty: 2, price: 0 }],
      physicalAmount: 666_000,
    });
    expect(h).toMatchObject({ ok: true, klaim: { nilai: 1_000_000, qty: 3 }, fisik: { nilai: 666_000, qty: 2 } });
  });

  it('menolak bila penghitung adalah pelapor notanya', async () => {
    state.nrt = { ...state.nrt, salesmanId: 'g1' };
    const h = await catatHitunganGudang({ ...DASAR, storeReturnId: 'nrt1', physicalAmount: 1_000_000 });
    expect(h).toEqual({ ok: false, alasan: 'PENGHITUNG_SAMA_PELAPOR' });
    expect(state.nriDibuat).toHaveLength(0);
  });

  it('menomori NRI dengan bulan WIB, juga di server UTC', async () => {
    const zona = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      // 1 September 00.00 WIB = 31 Agustus 17.00 UTC.
      const h = await catatHitunganGudang({
        ...DASAR,
        storeReturnId: 'nrt1',
        receivedAt: new Date('2026-09-01T00:00:00+07:00'),
        physicalAmount: 1_000_000,
      });
      expect(h).toMatchObject({ ok: true, noNri: 'NRI/26/09/0001' });
      // Tahun berganti di WIB lebih dulu.
      const h2 = await catatHitunganGudang({
        ...DASAR,
        storeReturnId: 'nrt1',
        receivedAt: new Date('2027-01-01T00:00:00+07:00'),
        physicalAmount: 1_000_000,
      });
      expect(h2).toMatchObject({ ok: true, noNri: 'NRI/27/01/0001' });
    } finally {
      if (zona === undefined) delete process.env.TZ;
      else process.env.TZ = zona;
    }
  });
});

describe('putuskanBeban / alihkanBeban — SALES wajib orangnya di server', () => {
  it('putuskanBeban menolak SALES tanpa orang, sebelum menulis apa pun', async () => {
    for (const bearerUserId of [undefined, null, '  ']) {
      expect(
        await putuskanBeban({ chargeId: 'b1', bearer: 'SALES', bearerUserId, alasan: 'x', olehUserId: 'u1' }),
      ).toEqual({ ok: false, alasan: 'PENANGGUNG_WAJIB' });
    }
    expect(state.bebanUpdates).toHaveLength(0);
  });

  it('alihkanBeban menolak SALES tanpa orang', async () => {
    state.beban = { ...state.beban, status: 'DITETAPKAN', bearer: 'GUDANG' };
    expect(await alihkanBeban({ chargeId: 'b1', bearer: 'SALES', alasan: 'x', olehUserId: 'u1' })).toEqual({
      ok: false,
      alasan: 'PENANGGUNG_WAJIB',
    });
    expect(state.bebanUpdates).toHaveLength(0);
  });
});

describe('alihkanBeban — yang sudah dipotong tidak dialihkan', () => {
  it('menolak SUDAH_DIPOTONG begitu ada potongan dari komisi penanggungnya', async () => {
    state.beban = { ...state.beban, status: 'DITETAPKAN', bearer: 'SALES', bearerUserId: 'sales7', settledAmount: 50_000 };
    expect(
      await alihkanBeban({ chargeId: 'b1', bearer: 'PERUSAHAAN', alasan: 'salah orang', olehUserId: 'u1' }),
    ).toEqual({ ok: false, alasan: 'SUDAH_DIPOTONG' });
    expect(state.bebanUpdates).toHaveLength(0);
  });

  it('menghitung ulang piutang yang tersentuh, karena tahanan faktur mengikuti penanggungnya', async () => {
    state.beban = { ...state.beban, status: 'DITETAPKAN', bearer: 'GUDANG', settledAmount: 0 };
    const h = await alihkanBeban({ chargeId: 'b1', bearer: 'SALES', bearerUserId: 'sales7', alasan: 'x', olehUserId: 'u1' });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2 });
    expect(state.bebanUpdates[0]).toMatchObject({ bearer: 'SALES', bearerUserId: 'sales7' });
  });
});

describe('laporHasilCekSelisih — isian ditolak sebelum menulis apa pun', () => {
  const DASAR = { chargeId: 'b1', olehUserId: 'pemegang1' };

  it('menolak hasil yang bukan ditemukan / tidak ditemukan', async () => {
    expect(await laporHasilCekSelisih({ ...DASAR, hasil: 'MUNGKIN' as never })).toEqual({ ok: false, alasan: 'HASIL_TIDAK_SAH' });
  });

  it('TIDAK_DITEMUKAN wajib membawa jawaban toko dan SPG; DITEMUKAN boleh tanpa catatan', async () => {
    expect(await laporHasilCekSelisih({ ...DASAR, hasil: 'TIDAK_DITEMUKAN', catatan: '  ' })).toEqual({
      ok: false,
      alasan: 'CATATAN_WAJIB',
    });
    state.beban = { ...state.beban, checkStatus: 'DITANYAKAN', storeReturn: { id: 'nrt1', status: 'SELISIH', store: { salesmanId: 'pemegang1' } } };
    expect(await laporHasilCekSelisih({ ...DASAR, hasil: 'DITEMUKAN' })).toEqual({ ok: true, notifikasi: null });
    expect(state.bebanUpdates[0]).toMatchObject({ checkStatus: 'DITEMUKAN', checkNote: null, checkedById: 'pemegang1' });
  });

  it('menolak catatan di atas 500 karakter (dihitung per code point)', async () => {
    expect(await laporHasilCekSelisih({ ...DASAR, hasil: 'TIDAK_DITEMUKAN', catatan: '😀'.repeat(501) })).toEqual({
      ok: false,
      alasan: 'CATATAN_TERLALU_PANJANG',
    });
    expect(state.bebanUpdates).toHaveLength(0);
  });

  it('hanya pemegang toko SEKARANG yang melapor (P85)', async () => {
    state.beban = { ...state.beban, storeReturn: { id: 'nrt1', status: 'SELISIH', store: { salesmanId: 'pemegang1' } } };
    expect(await laporHasilCekSelisih({ ...DASAR, olehUserId: 'spg1', hasil: 'DITEMUKAN' })).toEqual({
      ok: false,
      alasan: 'BUKAN_PEMEGANG',
    });
    expect(state.bebanUpdates).toHaveLength(0);
  });

  it('menolak sesudah bebannya diputuskan', async () => {
    state.beban = { ...state.beban, status: 'DITETAPKAN', storeReturn: { id: 'nrt1', status: 'SELISIH', store: { salesmanId: 'pemegang1' } } };
    expect(await laporHasilCekSelisih({ ...DASAR, hasil: 'DITEMUKAN' })).toEqual({ ok: false, alasan: 'SUDAH_DIPUTUSKAN' });
  });

  it('menulis jejak sebelum/sesudah di transaksi yang sama', async () => {
    state.beban = { ...state.beban, checkStatus: 'DITANYAKAN', checkNote: null, storeReturn: { id: 'nrt1', status: 'SELISIH', store: { salesmanId: 'pemegang1' } } };
    await laporHasilCekSelisih({ ...DASAR, hasil: 'DITEMUKAN', catatan: 'ada di gudang toko' });
    expect(state.jejak[0]).toMatchObject({
      action: 'RETURN_CHARGE_CHECK_REPORTED',
      changes: { before: { checkStatus: 'DITANYAKAN', checkNote: null }, after: { checkStatus: 'DITEMUKAN', checkNote: 'ada di gudang toko' } },
    });
  });
});

describe('catatReturToko — barang selisih yang sedang dikirim balik', () => {
  const BEBAN_DITEMUKAN = {
    storeReturn: {
      noNrt: 'NRT-LAMA',
      items: [{ itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja — M', qty: 3 }],
      warehouseReturn: { status: 'FINAL', items: [{ itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja — M', qty: 1 }] },
      followUps: [],
    },
  };
  const NRT_KANTOR = {
    ...NRT_DASAR,
    noNrt: 'NRT-BARU',
    items: [{ itemId: 'brg1', variantSku: 'KMJ-M', itemName: 'Kemeja — M', qty: 2, price: 80_000 }],
  };

  it('menolak baris yang jumlahnya muat di kekurangan nota lain yang dilaporkan DITEMUKAN', async () => {
    state.bebanDitemukan = [BEBAN_DITEMUKAN];
    expect(await catatReturToko(NRT_KANTOR)).toEqual({ ok: false, alasan: 'ADA_SELISIH_DITEMUKAN', noNrt: 'NRT-LAMA' });
    expect(state.nrtDibuat).toHaveLength(0);
  });

  it('menolak juga baris yang melebihi kekurangan itu — barang selisih bercampur retur baru (R16b)', async () => {
    state.bebanDitemukan = [BEBAN_DITEMUKAN];
    const lima = { ...NRT_KANTOR, items: [{ ...NRT_KANTOR.items[0], qty: 5 }] };
    expect(await catatReturToko(lima)).toEqual({ ok: false, alasan: 'ADA_SELISIH_DITEMUKAN', noNrt: 'NRT-LAMA' });
    expect(state.nrtDibuat).toHaveLength(0);
    const h = await catatReturToko({ ...lima, returLain: true });
    expect(h).toMatchObject({ ok: true });
    expect((state.jejak[0].metadata as Record<string, unknown>).returLainDariSelisih).toEqual([
      { noNrt: 'NRT-LAMA', itemId: 'brg1', variantSku: 'KMJ-M', qty: 5, qtyKurang: 2 },
    ]);
  });

  it('2 pcs yang ketemu dikirim bersama 1 pcs retur baru (3 pcs atas kurang 2) tetap ditolak (P22, P22a)', async () => {
    state.bebanDitemukan = [BEBAN_DITEMUKAN];
    const tiga = { ...NRT_KANTOR, items: [{ ...NRT_KANTOR.items[0], qty: 3 }] };
    expect(await catatReturToko(tiga)).toEqual({ ok: false, alasan: 'ADA_SELISIH_DITEMUKAN', noNrt: 'NRT-LAMA' });
    expect(state.nrtDibuat).toHaveLength(0);
    expect(await catatReturToko({ ...tiga, returLain: true })).toMatchObject({ ok: true });
    expect(state.nrtDibuat).toHaveLength(1);
    expect((state.jejak[0].metadata as Record<string, unknown>).returLainDariSelisih).toEqual([
      { noNrt: 'NRT-LAMA', itemId: 'brg1', variantSku: 'KMJ-M', qty: 3, qtyKurang: 2 },
    ]);
  });

  it('menerima bila pelapor menyatakan retur lain, dan mencatat kecocokannya di jejak', async () => {
    state.bebanDitemukan = [BEBAN_DITEMUKAN];
    const h = await catatReturToko({ ...NRT_KANTOR, returLain: true });
    expect(h).toMatchObject({ ok: true });
    expect((state.jejak[0].metadata as Record<string, unknown>).returLainDariSelisih).toEqual([
      { noNrt: 'NRT-LAMA', itemId: 'brg1', variantSku: 'KMJ-M', qty: 2, qtyKurang: 2 },
    ]);
  });

  it('tidak membaca beban sama sekali untuk baris yang hanya diketik namanya', async () => {
    state.bebanDitemukan = [BEBAN_DITEMUKAN];
    expect(await catatReturToko({ ...NRT_DASAR, claimedAmount: 100_000 })).toMatchObject({ ok: true });
  });
});

describe('lebihBayarBaru — kelebihan bayar yang LAHIR dari perubahan', () => {
  it('menandai sisa yang menjadi negatif dan lebih rendah dari sebelumnya', () => {
    expect(lebihBayarBaru(new Map([['r1', 0], ['r2', 50]]), new Map([['r1', -200], ['r2', 10]]))).toEqual(['r1']);
  });

  it('tidak menyalahkan kelebihan bayar yang sudah ada sebelumnya', () => {
    expect(lebihBayarBaru(new Map([['r1', -200]]), new Map([['r1', -200]]))).toEqual([]);
  });
});
