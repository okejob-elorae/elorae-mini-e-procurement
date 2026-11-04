import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Giro pada pintu verifikasi — tanpa database.
 *
 * Giro adalah janji bank, bukan uang. Tes ini menjaga dua hal: klaim giro yang
 * belum cair TIDAK BISA diverifikasi lewat tombol biasa, dan "giro cair"
 * menyetel status giro serta memverifikasi klaimnya dalam SATU transaksi —
 * supaya tidak pernah ada giro yang tercatat cair sementara piutangnya penuh,
 * atau sebaliknya.
 */

type Klaim = { id: string; docNo: string; status: string; verifyNote: string | null; giroStatus: string | null };

const state = {
  klaim: null as Klaim | null,
  updates: [] as Record<string, unknown>[],
  dihitungUlang: 0,
  jejak: [] as Record<string, unknown>[],
  transaksi: 0,
};

const tx = {
  paymentClaim: {
    findUnique: vi.fn(async () => state.klaim),
    update: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.updates.push(a.data);
      return {};
    }),
    updateMany: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.updates.push(a.data);
      return { count: 1 };
    }),
  },
  paymentClaimReceivable: { findMany: vi.fn(async () => [{ receivableId: 'r1' }]) },
  // Verifikasi memeriksa ulang pemakaian nota retur; klaim di sini tanpa potongan retur.
  paymentClaimDeduction: { findMany: vi.fn(async () => []) },
  receivable: {
    findUnique: vi.fn(async () => ({ amount: 1_000_000, claimLinks: [] })),
    // Dihitung saat sisa baru DISIMPAN. Verifikasi juga membaca sisa lebih dulu
    // (menolak pelunasan yang melebihi sisa), dan bacaan itu bukan hitung ulang.
    update: vi.fn(async () => {
      state.dihitungUlang += 1;
      return {};
    }),
  },
  auditLog: {
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.jejak.push(a.data);
      return {};
    }),
  },
};

vi.mock('@/lib/db/tx-retry', () => ({
  runSerializable: (fn: (c: unknown) => Promise<unknown>) => {
    state.transaksi += 1;
    return fn(tx);
  },
}));
vi.mock('@elorae/db', () => ({
  prisma: {
    $transaction: async (fn: (c: unknown) => Promise<unknown>) => {
      state.transaksi += 1;
      return fn(tx);
    },
  },
  Prisma: { Decimal: class { constructor(public value: number) {} } },
}));

const { putuskanKlaim } = await import('./writer');

const giroMenunggu = (): Klaim => ({
  id: 'k1',
  docNo: 'BKM/2026/0001',
  status: 'DIKIRIM',
  verifyNote: null,
  giroStatus: 'MENUNGGU',
});

beforeEach(() => {
  state.klaim = giroMenunggu();
  state.updates = [];
  state.dihitungUlang = 0;
  state.jejak = [];
  state.transaksi = 0;
});

describe('putuskanKlaim — giro belum lunas sampai cair', () => {
  it('menolak verifikasi biasa selama giro masih menunggu', async () => {
    const h = await putuskanKlaim({ paymentClaimId: 'k1', keputusan: 'TERVERIFIKASI', olehUserId: 'fin' });
    expect(h).toEqual({ ok: false, alasan: 'GIRO_BELUM_CAIR' });
    expect(state.updates).toHaveLength(0);
    expect(state.dihitungUlang).toBe(0);
  });

  it('tetap mengizinkan penolakan biasa (laporannya sendiri salah)', async () => {
    const h = await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'DITOLAK',
      olehUserId: 'fin',
      catatan: 'foto bilyet tidak terbaca',
    });
    expect(h.ok).toBe(true);
  });

  it('klaim non-giro dan giro lama tanpa status tetap diverifikasi seperti dulu', async () => {
    state.klaim = { ...giroMenunggu(), giroStatus: null };
    const h = await putuskanKlaim({ paymentClaimId: 'k1', keputusan: 'TERVERIFIKASI', olehUserId: 'fin' });
    expect(h.ok).toBe(true);
  });

  it('giro cair: status giro, stempel cair, dan verifikasi dalam SATU transaksi', async () => {
    const h = await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'TERVERIFIKASI',
      olehUserId: 'fin',
      giro: 'CAIR',
    });
    expect(h.ok).toBe(true);
    expect(state.transaksi).toBe(1);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ status: 'TERVERIFIKASI', giroStatus: 'CAIR' });
    expect(state.updates[0].giroSettledAt).toBeInstanceOf(Date);
    // Piutang dihitung ulang di transaksi yang sama — di sinilah ia berkurang.
    expect(state.dihitungUlang).toBe(1);
    expect(state.jejak[0]).toMatchObject({ action: 'RECEIVABLE_CLAIM_VERIFIED' });
    expect(state.jejak[0].changes).toMatchObject({
      before: { giroStatus: 'MENUNGGU' },
      after: { giroStatus: 'CAIR' },
    });
  });

  it('giro ditolak bank: klaim ditolak dengan alasannya, giro ditandai ditolak', async () => {
    const h = await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'DITOLAK',
      olehUserId: 'fin',
      catatan: 'saldo tidak cukup',
      giro: 'DITOLAK',
    });
    expect(h.ok).toBe(true);
    expect(state.updates[0]).toMatchObject({
      status: 'DITOLAK',
      giroStatus: 'DITOLAK',
      verifyNote: 'saldo tidak cukup',
    });
    expect(state.updates[0].giroSettledAt).toBeUndefined();
    expect(state.jejak[0]).toMatchObject({ action: 'RECEIVABLE_CLAIM_REJECTED' });
  });

  it('giro ditolak tanpa alasan ditolak sebelum menulis apa pun', async () => {
    const h = await putuskanKlaim({ paymentClaimId: 'k1', keputusan: 'DITOLAK', olehUserId: 'fin', giro: 'DITOLAK' });
    expect(h).toEqual({ ok: false, alasan: 'ALASAN_WAJIB' });
    expect(state.updates).toHaveLength(0);
  });

  it('menolak menandai cair klaim yang bukan giro menunggu', async () => {
    state.klaim = { ...giroMenunggu(), giroStatus: null };
    const h = await putuskanKlaim({ paymentClaimId: 'k1', keputusan: 'TERVERIFIKASI', olehUserId: 'fin', giro: 'CAIR' });
    expect(h).toEqual({ ok: false, alasan: 'BUKAN_GIRO_MENUNGGU' });
    expect(state.updates).toHaveLength(0);
  });

  it('menolak giro cair atas klaim yang sudah diputuskan', async () => {
    state.klaim = { ...giroMenunggu(), status: 'DITOLAK' };
    const h = await putuskanKlaim({ paymentClaimId: 'k1', keputusan: 'TERVERIFIKASI', olehUserId: 'fin', giro: 'CAIR' });
    expect(h).toEqual({ ok: false, alasan: 'SUDAH_DIPUTUSKAN' });
  });
});
