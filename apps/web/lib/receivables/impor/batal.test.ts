import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tes pembatalan impor tanpa menyentuh database.
 *
 * Yang dijaga: pembatalan TIDAK BOLEH menghapus faktur yang sudah disentuh.
 * Relasi di modul ini `relationMode = "prisma"`, jadi tidak ada foreign key
 * yang akan menghentikannya — penghapusannya akan BERHASIL, dan yang tersisa
 * adalah klaim yang melunasi sesuatu yang tidak ada lagi.
 */

class Desimal {
  constructor(public n: number) {}
  equals(lain: Desimal) {
    return this.n === lain.n;
  }
}

const state = {
  jejak: null as { id: string; action: string; metadata: unknown; createdAt: Date } | null,
  piutang: [] as { id: string; invoiceNo: string; amount: Desimal; outstanding: Desimal }[],
  tautanKlaim: [] as { receivableId: string }[],
  tautanKontrabon: [] as { receivableId: string }[],
  hapusPiutang: [] as string[],
  hapusRincian: [] as string[],
  jejakBaru: [] as Record<string, unknown>[],
};

const tx = {
  auditLog: {
    findUnique: vi.fn(async () => state.jejak),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.jejakBaru.push(a.data);
      return {};
    }),
  },
  receivable: {
    findMany: vi.fn(async (a: { where: { id: { in: string[] } } }) =>
      state.piutang.filter((r) => a.where.id.in.includes(r.id)),
    ),
    deleteMany: vi.fn(async (a: { where: { id: { in: string[] } } }) => {
      state.hapusPiutang.push(...a.where.id.in);
      return { count: a.where.id.in.length };
    }),
  },
  receivableItem: {
    deleteMany: vi.fn(async (a: { where: { receivableId: { in: string[] } } }) => {
      state.hapusRincian.push(...a.where.receivableId.in);
      return { count: 0 };
    }),
  },
  paymentClaimReceivable: { findMany: vi.fn(async () => state.tautanKlaim) },
  collectionNoteReceivable: { findMany: vi.fn(async () => state.tautanKontrabon) },
};

vi.mock('@/lib/db/tx-retry', () => ({
  runSerializable: (cb: (c: unknown) => Promise<unknown>) => cb(tx),
}));
vi.mock('@elorae/db', () => ({ prisma: tx, Prisma: {} }));

const { batalkanImpor } = await import('./batal');

const DASAR = { auditLogId: 'jejak1', alasan: 'kolom tertukar', olehUserId: 'u1' };

beforeEach(() => {
  state.jejak = {
    id: 'jejak1',
    action: 'RECEIVABLE_IMPORTED',
    metadata: { receivableIds: ['r1', 'r2'] },
    createdAt: new Date('2026-08-20T03:00:00Z'),
  };
  state.piutang = [
    { id: 'r1', invoiceNo: 'INV/1', amount: new Desimal(1_000), outstanding: new Desimal(1_000) },
    { id: 'r2', invoiceNo: 'INV/2', amount: new Desimal(2_000), outstanding: new Desimal(2_000) },
  ];
  state.tautanKlaim = [];
  state.tautanKontrabon = [];
  state.hapusPiutang = [];
  state.hapusRincian = [];
  state.jejakBaru = [];
  vi.clearAllMocks();
});

describe('batalkanImpor', () => {
  it('menghapus seluruh faktur batch yang belum tersentuh', async () => {
    const hasil = await batalkanImpor(DASAR);
    expect(hasil).toEqual({ ok: true, dihapus: 2 });
    expect(state.hapusPiutang.sort()).toEqual(['r1', 'r2']);
  });

  it('menghapus baris rincian SEBELUM induknya', async () => {
    // Tidak ada foreign key yang ikut membersihkan; menghapus induk lebih dulu
    // meninggalkan baris rincian menggantung selamanya.
    await batalkanImpor(DASAR);
    const urutRincian = tx.receivableItem.deleteMany.mock.invocationCallOrder[0];
    const urutInduk = tx.receivable.deleteMany.mock.invocationCallOrder[0];
    expect(urutRincian).toBeLessThan(urutInduk);
  });

  it('MENOLAK seluruh batch kalau satu faktur sudah dilunasi klaim', async () => {
    state.tautanKlaim = [{ receivableId: 'r2' }];
    const hasil = await batalkanImpor(DASAR);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) {
      expect(hasil.alasan).toBe('SUDAH_DIPAKAI');
      // Menyebut yang menghalangi. "Tidak bisa" tanpa sebab memaksa orang menebak.
      expect(hasil.dipakai).toEqual(['INV/2']);
    }
    // Yang penting: r1 pun TIDAK ikut terhapus. Menghapus sebagian batch
    // meninggalkan keadaan yang tidak bisa dijelaskan siapa pun.
    expect(state.hapusPiutang).toHaveLength(0);
  });

  it('MENOLAK kalau satu faktur sudah masuk kontrabon', async () => {
    state.tautanKontrabon = [{ receivableId: 'r1' }];
    const hasil = await batalkanImpor(DASAR);
    expect(hasil.ok).toBe(false);
    expect(state.hapusPiutang).toHaveLength(0);
  });

  it('MENOLAK kalau sisanya sudah tidak penuh, walau tautannya tidak terbaca', async () => {
    // Sisa yang bergerak berarti ada sesuatu yang menyentuhnya.
    state.piutang[0].outstanding = new Desimal(400);
    const hasil = await batalkanImpor(DASAR);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.dipakai).toEqual(['INV/1']);
  });

  it('menolak tanpa alasan SEBELUM membaca apa pun', async () => {
    const hasil = await batalkanImpor({ ...DASAR, alasan: '   ' });
    expect(hasil).toEqual({ ok: false, alasan: 'ALASAN_WAJIB' });
    expect(tx.auditLog.findUnique).not.toHaveBeenCalled();
  });

  it('menolak catatan jejak yang bukan impor', async () => {
    state.jejak!.action = 'RECEIVABLE_CLAIM_VERIFIED';
    expect(await batalkanImpor(DASAR)).toEqual({ ok: false, alasan: 'BUKAN_IMPOR' });
  });

  it('menolak batch yang daftar idnya kosong, bukan melaporkan berhasil', async () => {
    /*
     * `{ id: { in: [] } }` memang aman, tapi pemeriksaan "sudah dipakai"-nya
     * ikut kosong dan hasilnya jadi keberhasilan yang tidak menghapus apa pun.
     */
    state.jejak!.metadata = { receivableIds: [] };
    expect(await batalkanImpor(DASAR)).toEqual({ ok: false, alasan: 'SUDAH_DIBATALKAN' });
  });

  it('menolak batch yang fakturnya sudah tidak ada lagi', async () => {
    state.piutang = [];
    expect(await batalkanImpor(DASAR)).toEqual({ ok: false, alasan: 'SUDAH_DIBATALKAN' });
  });

  it('mencatat jejak pembatalan lengkap dengan alasan dan nomor fakturnya', async () => {
    await batalkanImpor(DASAR);
    expect(state.jejakBaru).toHaveLength(1);
    const j = state.jejakBaru[0];
    expect(j.action).toBe('RECEIVABLE_IMPORT_REVERTED');
    expect(j.reason).toBe('kolom tertukar');
    expect((j.metadata as { noFaktur: string[] }).noFaktur).toEqual(['INV/1', 'INV/2']);
  });
});
