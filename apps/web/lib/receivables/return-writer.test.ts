import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tes penulis retur tanpa menyentuh database.
 *
 * Yang dijaga: hitungan gudang hanya boleh dicatat sekali, beban hanya bisa
 * diputuskan setelah ada hitungan dan hanya kalau ada selisihnya, dan setiap
 * perubahan memicu perhitungan ulang piutang yang tersentuh — kalau tidak,
 * layar piutang tetap menampilkan angka lama dan tidak ada yang tahu.
 */

const state = {
  nota: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  dibuat: [] as Record<string, unknown>[],
  potongan: [] as { paymentClaimId: string }[],
  links: [] as { receivableId: string }[],
  dihitungUlang: [] as string[],
};

const tx = {
  storeReturn: {
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => state.nota),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.dibuat.push(args.data);
      return { id: 'nrt1', docNo: args.data.docNo as string };
    }),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.updates.push(args.data);
      return {};
    }),
  },
  paymentClaimDeduction: { findMany: vi.fn(async () => state.potongan) },
  paymentClaimReceivable: { findMany: vi.fn(async () => state.links) },
};

vi.mock('@/lib/db/tx-retry', () => ({
  runSerializable: (cb: (client: unknown) => Promise<unknown>) => cb(tx),
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

const { catatReturToko, catatHitunganGudang, putuskanBebanSelisih, batalkanRetur } =
  await import('./return-writer');

const HARI_INI = new Date('2026-08-26T00:00:00+07:00');

beforeEach(() => {
  state.nota = {
    id: 'nrt1',
    status: 'DIAJUKAN',
    claimedAmount: 1_000_000,
    countedAmount: null,
    bearer: null,
    note: null,
  };
  state.updates = [];
  state.dibuat = [];
  state.potongan = [{ paymentClaimId: 'k1' }];
  state.links = [{ receivableId: 'r1' }, { receivableId: 'r2' }];
  state.dihitungUlang = [];
});

describe('catatReturToko', () => {
  const dasar = { storeId: 't1', claimDate: HARI_INI };

  it('menolak nilai nol atau negatif', async () => {
    // Nota bernilai nol menahan nol rupiah selamanya dan tak pernah tuntas.
    expect(await catatReturToko({ ...dasar, claimedAmount: 0 })).toEqual({
      ok: false,
      alasan: 'NILAI_TIDAK_VALID',
    });
    expect(await catatReturToko({ ...dasar, claimedAmount: -5 })).toEqual({
      ok: false,
      alasan: 'NILAI_TIDAK_VALID',
    });
    expect(state.dibuat).toHaveLength(0);
  });

  it('menomori NRT menurut tahun tanggal klaim', async () => {
    const h = await catatReturToko({ ...dasar, claimedAmount: 1_000_000 });
    expect(h).toMatchObject({ ok: true, docNo: 'NRT/2026/0001' });
    expect(state.dibuat[0].status).toBe('DIAJUKAN');
    // Gudang belum menghitung apa pun saat nota dibuat.
    expect(state.dibuat[0].countedAmount).toBeUndefined();
  });
});

describe('catatHitunganGudang', () => {
  const dasar = { storeReturnId: 'nrt1', olehUserId: 'u1' };

  it('menerima nol — tidak ada barang yang sampai', async () => {
    // Nol berbeda dari belum dihitung: yang satu sudah bisa dibebankan, yang
    // lain belum. Menolak nol memaksa gudang berbohong.
    const h = await catatHitunganGudang({ ...dasar, countedAmount: 0 });
    expect(h.ok).toBe(true);
    expect(state.updates[0].status).toBe('DIHITUNG');
  });

  it('menolak nilai negatif', async () => {
    expect(await catatHitunganGudang({ ...dasar, countedAmount: -1 })).toEqual({
      ok: false,
      alasan: 'NILAI_TIDAK_VALID',
    });
    expect(state.updates).toHaveLength(0);
  });

  it('menolak menghitung dua kali', async () => {
    // Menimpa hitungan berarti mengubah angka yang mungkin sudah dipakai
    // memutuskan siapa menanggung selisihnya.
    state.nota = { ...state.nota, countedAmount: 800_000, status: 'DIHITUNG' };
    expect(await catatHitunganGudang({ ...dasar, countedAmount: 900_000 })).toEqual({
      ok: false,
      alasan: 'SUDAH_DIHITUNG',
    });
    expect(state.updates).toHaveLength(0);
  });

  it('menolak nota yang sudah dibatalkan', async () => {
    state.nota = { ...state.nota, status: 'BATAL' };
    expect(await catatHitunganGudang({ ...dasar, countedAmount: 500_000 })).toEqual({
      ok: false,
      alasan: 'SUDAH_DIBATALKAN',
    });
  });

  it('menghitung ulang SETIAP piutang yang tersentuh nota ini', async () => {
    // Rantainya panjang: nota → potongan → klaim → piutang. Kalau salah satu
    // terlewat, layar piutang menampilkan angka lama tanpa tanda apa pun.
    const h = await catatHitunganGudang({ ...dasar, countedAmount: 800_000 });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2 });
    expect(state.dihitungUlang).toEqual(['r1', 'r2']);
  });

  it('tidak menghitung ulang apa pun kalau notanya belum dipakai memotong', async () => {
    state.potongan = [];
    const h = await catatHitunganGudang({ ...dasar, countedAmount: 800_000 });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 0 });
    expect(state.dihitungUlang).toEqual([]);
  });
});

describe('putuskanBebanSelisih', () => {
  const dasar = { storeReturnId: 'nrt1', bearer: 'TOKO' as const, olehUserId: 'u1' };

  it('menolak tanpa alasan SEBELUM menulis apa pun', async () => {
    expect(await putuskanBebanSelisih({ ...dasar, alasan: '  ' })).toEqual({
      ok: false,
      alasan: 'ALASAN_WAJIB',
    });
    expect(state.updates).toHaveLength(0);
  });

  it('menolak selama gudang belum menghitung', async () => {
    // Tanpa hitungan, besar selisihnya belum diketahui siapa pun.
    expect(await putuskanBebanSelisih({ ...dasar, alasan: 'hilang' })).toEqual({
      ok: false,
      alasan: 'BELUM_DIHITUNG',
    });
  });

  it('menolak kalau tidak ada selisih', async () => {
    // Mencatat beban di sini menuduh seseorang atas kerugian nol.
    state.nota = { ...state.nota, countedAmount: 1_000_000, status: 'DIHITUNG' };
    expect(await putuskanBebanSelisih({ ...dasar, alasan: 'hilang' })).toEqual({
      ok: false,
      alasan: 'TIDAK_ADA_SELISIH',
    });
  });

  it('menolak kalau gudang menerima LEBIH dari klaim', async () => {
    state.nota = { ...state.nota, countedAmount: 1_200_000, status: 'DIHITUNG' };
    expect(await putuskanBebanSelisih({ ...dasar, alasan: 'hilang' })).toEqual({
      ok: false,
      alasan: 'TIDAK_ADA_SELISIH',
    });
  });

  it('menolak keputusan kedua', async () => {
    state.nota = { ...state.nota, countedAmount: 800_000, status: 'SELESAI', bearer: 'SALES' };
    expect(await putuskanBebanSelisih({ ...dasar, alasan: 'hilang' })).toEqual({
      ok: false,
      alasan: 'SUDAH_DIPUTUSKAN',
    });
  });

  it('menyimpan keputusan dan menghitung ulang piutang', async () => {
    state.nota = { ...state.nota, countedAmount: 800_000, status: 'DIHITUNG' };
    const h = await putuskanBebanSelisih({ ...dasar, alasan: 'hilang di ekspedisi' });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2 });
    expect(state.updates[0]).toMatchObject({
      bearer: 'TOKO',
      bearerReason: 'hilang di ekspedisi',
      status: 'SELESAI',
    });
  });
});

describe('batalkanRetur', () => {
  it('menolak tanpa alasan', async () => {
    expect(await batalkanRetur({ storeReturnId: 'nrt1', alasan: '' })).toEqual({
      ok: false,
      alasan: 'ALASAN_WAJIB',
    });
  });

  it('membatalkan dan menghitung ulang piutang', async () => {
    // Piutang WAJIB dihitung ulang: potongan yang menunjuk nota batal berubah
    // jadi tertahan penuh, dan sisa piutangnya naik.
    const h = await batalkanRetur({ storeReturnId: 'nrt1', alasan: 'toko menarik klaim' });
    expect(h).toEqual({ ok: true, piutangDihitungUlang: 2 });
    expect(state.updates[0].status).toBe('BATAL');
    expect(state.dihitungUlang).toEqual(['r1', 'r2']);
  });

  it('menolak nota yang sudah batal', async () => {
    state.nota = { ...state.nota, status: 'BATAL' };
    expect(await batalkanRetur({ storeReturnId: 'nrt1', alasan: 'lagi' })).toEqual({
      ok: false,
      alasan: 'SUDAH_DIBATALKAN',
    });
  });
});
