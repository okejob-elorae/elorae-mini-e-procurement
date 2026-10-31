import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Jejak keputusan ditulis DI DALAM transaksinya.
 *
 * Yang diuji bukan bentuk barisnya melainkan janjinya: setiap keputusan uang
 * yang bisa dibalik meninggalkan nama pelakunya dan keadaan sebelumnya. Sebuah
 * pembalikan tanpa jejak adalah lubang yang tepat di tengah modul yang seluruh
 * gunanya pertanggungjawaban.
 */

const state = {
  klaim: null as Record<string, unknown> | null,
  jejak: [] as Record<string, unknown>[],
  links: [] as { receivableId: string }[],
  receivable: { amount: 10_000_000, claimLinks: [] as unknown[] },
};

const tx = {
  paymentClaim: {
    findUnique: vi.fn(async () => state.klaim),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  paymentClaimReceivable: { findMany: vi.fn(async () => state.links) },
  // Verifikasi memeriksa ulang pemakaian nota retur; klaim di sini tanpa potongan retur.
  paymentClaimDeduction: { findMany: vi.fn(async () => []) },
  receivable: {
    findUnique: vi.fn(async () => state.receivable),
    update: vi.fn(async () => ({})),
  },
  auditLog: {
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.jejak.push(a.data);
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

const { putuskanKlaim } = await import('./writer');

beforeEach(() => {
  state.klaim = { id: 'k1', docNo: 'BKM/2026/0009', status: 'DIKIRIM', verifyNote: null };
  state.jejak = [];
  state.links = [{ receivableId: 'r1' }];
  state.receivable = { amount: 10_000_000, claimLinks: [] };
});

describe('jejak keputusan klaim', () => {
  it('menulis satu jejak berisi pelakunya', async () => {
    await putuskanKlaim({ paymentClaimId: 'k1', keputusan: 'TERVERIFIKASI', olehUserId: 'u9' });
    expect(state.jejak).toHaveLength(1);
    expect(state.jejak[0]).toMatchObject({
      userId: 'u9',
      action: 'RECEIVABLE_CLAIM_VERIFIED',
      entityType: 'PaymentClaim',
      entityId: 'k1',
    });
  });

  it('menyimpan keadaan SEBELUM, yang tidak ada lagi di barisnya', async () => {
    // Barisnya hanya menyimpan keadaan terakhir. Keputusan yang tergantikan
    // hanya bisa dibaca dari sini.
    await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'DITOLAK',
      olehUserId: 'u9',
      catatan: 'uang belum masuk rekening',
    });
    expect(state.jejak[0].changes).toMatchObject({
      before: { status: 'DIKIRIM', verifyNote: null },
      after: { status: 'DITOLAK', verifyNote: 'uang belum masuk rekening' },
    });
  });

  it('membedakan verifikasi dari penolakan', async () => {
    await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'DITOLAK',
      olehUserId: 'u9',
      catatan: 'salah nominal',
    });
    expect(state.jejak[0].action).toBe('RECEIVABLE_CLAIM_REJECTED');
    expect(state.jejak[0].reason).toBe('salah nominal');
  });

  it('TIDAK menulis jejak kalau keputusannya ditolak penulis', async () => {
    // Jejak untuk sesuatu yang tidak terjadi lebih buruk daripada tidak ada
    // jejak: ia menyatakan perubahan yang tidak pernah ada.
    state.klaim = { ...state.klaim, status: 'TERVERIFIKASI' };
    const hasil = await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'TERVERIFIKASI',
      olehUserId: 'u9',
    });
    expect(hasil.ok).toBe(false);
    expect(state.jejak).toHaveLength(0);
  });

  it('tidak menulis jejak untuk penolakan tanpa alasan', async () => {
    const hasil = await putuskanKlaim({
      paymentClaimId: 'k1',
      keputusan: 'DITOLAK',
      olehUserId: 'u9',
      catatan: '   ',
    });
    expect(hasil.ok).toBe(false);
    expect(state.jejak).toHaveLength(0);
  });
});
