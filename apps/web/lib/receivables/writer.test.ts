import { describe, expect, it, vi } from 'vitest';

/**
 * Tes penulis piutang tanpa menyentuh database.
 *
 * `@elorae/db` dimock supaya perilaku transaksinya bisa diperiksa — khususnya
 * yang paling penting: keputusan hanya boleh diambil sekali, dan penolakan
 * tanpa alasan harus ditolak sebelum apa pun ditulis.
 */

const state = {
  klaim: null as { id: string; status: string } | null,
  updates: [] as { where: unknown; data: Record<string, unknown> }[],
  links: [] as { receivableId: string; settledAmount?: number }[],
  receivable: { amount: 10_000_000, claimLinks: [] } as { amount: number; claimLinks: unknown[]; paidAmount?: number },
  receivableUpdates: [] as Record<string, unknown>[],
  jejak: [] as Record<string, unknown>[],
};

const tx = {
  paymentClaim: {
    findUnique: vi.fn(async () => state.klaim),
    update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
      state.updates.push(args);
      return {};
    }),
    updateMany: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
      state.updates.push(args);
      return { count: 1 };
    }),
  },
  paymentClaimReceivable: { findMany: vi.fn(async () => state.links) },
  // Verifikasi memeriksa ulang pemakaian nota retur; klaim di sini tanpa potongan retur.
  paymentClaimDeduction: { findMany: vi.fn(async () => []) },
  auditLog: {
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.jejak.push(a.data);
      return {};
    }),
  },
  receivable: {
    findUnique: vi.fn(async () => state.receivable),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.receivableUpdates.push(args.data);
      return {};
    }),
  },
};

vi.mock('@/lib/db/tx-retry', () => ({
  runSerializable: (fn: (c: unknown) => Promise<unknown>) => fn(tx),
}));
vi.mock('@elorae/db', () => ({
  prisma: {
    $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    ...tx,
  },
  Prisma: { Decimal: class { constructor(public value: number) {} } },
}));

const { putuskanKlaim, selaraskanSisaPiutang } = await import('./writer');

function reset(klaimStatus: string | null) {
  state.klaim = klaimStatus ? { id: 'k1', status: klaimStatus } : null;
  state.updates = [];
  state.links = [{ receivableId: 'r1' }];
  state.receivable = { amount: 10_000_000, claimLinks: [] };
  state.receivableUpdates = [];
  state.jejak = [];
}

describe('putuskanKlaim', () => {
  it('menolak penolakan tanpa alasan SEBELUM menulis apa pun', async () => {
    // Sales harus tahu apa yang salah; tanpa alasan dia menagih ke tempat yang
    // sama lagi — persis kebocoran informasi yang program ini tutup.
    reset('DIKIRIM');
    const hasil = await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'DITOLAK',
      olehUserId: 'u1',
      catatan: '   ',
    });
    expect(hasil).toEqual({ ok: false, alasan: 'ALASAN_WAJIB' });
    expect(state.updates).toHaveLength(0);
  });

  it('menolak klaim yang sudah pernah diputuskan', async () => {
    // Tanpa penjagaan ini, verifikasi ganda akan menghitung ulang piutang dua
    // kali dan menimpa keputusan admin sebelumnya.
    reset('TERVERIFIKASI');
    const hasil = await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'TERVERIFIKASI',
      olehUserId: 'u1',
    });
    expect(hasil).toEqual({ ok: false, alasan: 'SUDAH_DIPUTUSKAN' });
    expect(state.updates).toHaveLength(0);
  });

  it('menolak klaim yang tidak ada', async () => {
    reset(null);
    const hasil = await putuskanKlaim({
      paymentClaimId: 'hilang',
      keputusan: 'TERVERIFIKASI',
      olehUserId: 'u1',
    });
    expect(hasil).toEqual({ ok: false, alasan: 'TIDAK_DITEMUKAN' });
  });

  it('menyimpan keputusan dan menghitung ulang piutang yang disentuh', async () => {
    reset('DIKIRIM');
    const hasil = await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'TERVERIFIKASI',
      olehUserId: 'u1',
    });
    expect(hasil.ok).toBe(true);
    expect(state.updates[0].data.status).toBe('TERVERIFIKASI');
    expect(state.updates[0].data.verifiedById).toBe('u1');
    // Piutang ikut dihitung ulang dalam transaksi yang sama.
    expect(state.receivableUpdates).toHaveLength(1);
  });

  it('mengosongkan tanggal lunas kalau sisanya kembali di atas nol', async () => {
    // Klaim ditolak setelah sempat terverifikasi: piutangnya harus terbuka lagi,
    // dan lunas_pada tidak boleh tertinggal mengaku sudah lunas.
    reset('DIKIRIM');
    await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'DITOLAK',
      olehUserId: 'u1',
      catatan: 'uang belum masuk rekening',
    });
    expect(state.receivableUpdates[0].settledAt).toBeNull();
  });

  it('menolak BKM atas faktur yang sudah dibayar di kantor', async () => {
    // Uang yang masuk lewat pembayaran kantor (`paidAmount`) tidak lewat BKM.
    // Tanpa ikut dikurangkan, faktur yang sudah lunas di kantor diverifikasi
    // lunas sekali lagi dan piutang tokonya dikredit dua kali.
    reset('DIKIRIM');
    state.receivable = { amount: 10_000_000, claimLinks: [], paidAmount: 10_000_000 };
    state.links = [{ receivableId: 'r1', settledAmount: 1_000_000 }];
    const hasil = await putuskanKlaim({ paymentClaimId: 'k1', keputusan: 'TERVERIFIKASI', olehUserId: 'u1' });
    expect(hasil).toEqual({ ok: false, alasan: 'MELEBIHI_SISA' });
    expect(state.updates).toHaveLength(0);
  });

  it('menyimpan sisa yang sudah dikurangi pembayaran kantor', async () => {
    reset('DIKIRIM');
    state.receivable = { amount: 10_000_000, claimLinks: [], paidAmount: 4_000_000 };
    await putuskanKlaim({ paymentClaimId: 'k1', keputusan: 'DITOLAK', olehUserId: 'u1', catatan: 'uang belum masuk' });
    expect(state.receivableUpdates[0].outstanding).toEqual({ value: 6_000_000 });
    expect(state.receivableUpdates[0].outstandingAmount).toEqual({ value: 6_000_000 });
  });
});

describe('selaraskanSisaPiutang — sesudah pembayaran kantor', () => {
  it('menulis sisa dan tanggal lunas modul ini saja, bukan kolom pembayaran kantor', async () => {
    reset(null);
    state.receivable = { amount: 10_000_000, claimLinks: [], paidAmount: 10_000_000 };
    expect(await selaraskanSisaPiutang(tx as never, 'r1')).toBe(0);
    expect(state.receivableUpdates).toHaveLength(1);
    expect(state.receivableUpdates[0].outstanding).toEqual({ value: 0 });
    expect(state.receivableUpdates[0].settledAt).toBeInstanceOf(Date);
    expect(state.receivableUpdates[0]).not.toHaveProperty('outstandingAmount');
    expect(state.receivableUpdates[0]).not.toHaveProperty('status');
  });

  it('membuka lagi faktur yang pembayaran kantornya dibatalkan', async () => {
    reset(null);
    state.receivable = { amount: 10_000_000, claimLinks: [], paidAmount: 0 };
    expect(await selaraskanSisaPiutang(tx as never, 'r1')).toBe(10_000_000);
    expect(state.receivableUpdates[0].settledAt).toBeNull();
  });
});
