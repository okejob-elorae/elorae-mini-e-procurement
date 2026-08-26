import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tes penulis klaim pembayaran tanpa menyentuh database.
 *
 * Yang paling penting dijaga di sini: membuat BKM TIDAK mengurangi piutang.
 * Itu Aturan 1, dan ia paling mudah runtuh justru di jalur ini — di sinilah
 * angka pelunasan pertama kali disebut.
 */

const state = {
  tokoPkp: false,
  jenis: [] as { id: string; method: string; noteRequired: boolean; pkpOnly: boolean }[],
  piutang: [] as { id: string; storeId: string }[],
  retur: [] as { id: string; storeId: string }[],
  sisa: new Map<string, number>(),
  dibuat: [] as Record<string, unknown>[],
  dihitungUlang: [] as string[],
  jejak: [] as Record<string, unknown>[],
};

/**
 * Tiruan `findMany` yang benar-benar MENYARING menurut id yang diminta.
 *
 * Yang selalu mengembalikan seluruh isi state membuat penulisnya menyimpulkan
 * "ada id yang tidak ditemukan" pada setiap tes yang meminta lebih sedikit
 * baris daripada yang diseed — dan menutupi penolakan yang sebenarnya diuji.
 */
const saring = <T extends { id: string }>(sumber: () => T[]) =>
  vi.fn(async (args?: { where?: { id?: { in?: string[] } } }) => {
    const minta = args?.where?.id?.in;
    return minta ? sumber().filter((r) => minta.includes(r.id)) : sumber();
  });

const tx = {
  store: { findUnique: vi.fn(async () => ({ isPkp: state.tokoPkp })) },
  deductionType: {
    findMany: vi.fn(async (args?: { where?: { id?: { in?: string[] } } }) => {
      const minta = args?.where?.id?.in;
      return minta ? state.jenis.filter((j) => minta.includes(j.id)) : state.jenis;
    }),
  },
  receivable: { findMany: saring(() => state.piutang) },
  storeReturn: { findMany: saring(() => state.retur) },
  auditLog: {
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.jejak.push(a.data);
      return {};
    }),
  },
  paymentClaim: {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.dibuat.push(a.data);
      return { id: 'bkm1', docNo: a.data.docNo as string };
    }),
  },
};

vi.mock('@/lib/db/tx-retry', () => ({
  runSerializable: (cb: (c: unknown) => Promise<unknown>) => cb(tx),
}));
vi.mock('./writer', () => ({
  hitungUlangPiutang: async (_c: unknown, id: string) => {
    state.dihitungUlang.push(id);
    return state.sisa.get(id) ?? 0;
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

const { buatKlaimPembayaran } = await import('./claim-writer');

const HARI_INI = new Date('2026-08-26T00:00:00+07:00');
const DASAR = {
  storeId: 't1',
  salesmanId: 'u1',
  createdById: 'u1',
  claimedTransferAt: HARI_INI,
  method: 'transfer',
  transferPhotoUrl: '/api/foto/f1',
};

beforeEach(() => {
  state.piutang = [
    { id: 'r1', storeId: 't1' },
    { id: 'r2', storeId: 't1' },
  ];
  state.retur = [{ id: 'nrt1', storeId: 't1' }];
  state.sisa = new Map([
    ['r1', 5_000_000],
    ['r2', 3_000_000],
  ]);
  state.dibuat = [];
  state.dihitungUlang = [];
  state.jejak = [];
  state.tokoPkp = false;
  state.jenis = [
    { id: 'pph23', method: 'NOMINAL', noteRequired: false, pkpOnly: true },
    { id: 'biasa', method: 'NOMINAL', noteRequired: false, pkpOnly: false },
  ];
});

const angka = (v: unknown) => Number((v as { value: number }).value);

describe('buatKlaimPembayaran', () => {
  it('menolak tanpa faktur', async () => {
    expect(await buatKlaimPembayaran({ ...DASAR, pelunasan: [] })).toEqual({
      ok: false,
      alasan: 'TANPA_PIUTANG',
    });
  });

  it('menolak tanpa foto bukti transfer', async () => {
    // Tanpa foto, BKM hanya klaim lisan: admin keuangan tidak punya apa pun
    // untuk dicocokkan dengan mutasi rekening, dan sales tidak punya apa pun
    // untuk membantah penolakan.
    expect(
      await buatKlaimPembayaran({
        ...DASAR,
        transferPhotoUrl: '   ',
        pelunasan: [{ receivableId: 'r1', nilai: 1_000_000 }],
      }),
    ).toEqual({ ok: false, alasan: 'FOTO_WAJIB' });
    expect(state.dibuat).toHaveLength(0);
  });

  it('menolak faktur dari toko lain', async () => {
    state.piutang = [{ id: 'r1', storeId: 't9' }];
    expect(
      await buatKlaimPembayaran({ ...DASAR, pelunasan: [{ receivableId: 'r1', nilai: 1_000 }] }),
    ).toEqual({ ok: false, alasan: 'BEDA_TOKO' });
  });

  it('menolak faktur yang ternyata sudah lunas', async () => {
    // Ditolak seluruh daftarnya, bukan disaring diam-diam: sales perlu tahu
    // laporannya sudah basi sebelum dikirim.
    state.sisa.set('r2', 0);
    expect(
      await buatKlaimPembayaran({
        ...DASAR,
        pelunasan: [
          { receivableId: 'r1', nilai: 1_000_000 },
          { receivableId: 'r2', nilai: 1_000_000 },
        ],
      }),
    ).toEqual({ ok: false, alasan: 'SUDAH_LUNAS' });
    expect(state.dibuat).toHaveLength(0);
  });

  it('menolak pelunasan melebihi sisa faktur', async () => {
    // Porsi klaim ini akan melebihi 100% dan menggeser perhitungan setiap
    // klaim lain atas faktur yang sama.
    expect(
      await buatKlaimPembayaran({
        ...DASAR,
        pelunasan: [{ receivableId: 'r1', nilai: 6_000_000 }],
      }),
    ).toEqual({ ok: false, alasan: 'MELEBIHI_SISA' });
  });

  it('menolak potongan yang melebihi nilai faktur', async () => {
    // Toko mengirim uang negatif.
    expect(
      await buatKlaimPembayaran({
        ...DASAR,
        pelunasan: [{ receivableId: 'r1', nilai: 1_000_000 }],
        potongan: [{ nama: 'Retur', nilai: 2_000_000 }],
      }),
    ).toEqual({ ok: false, alasan: 'POTONGAN_MELEBIHI' });
  });

  it('menolak nota retur milik toko lain', async () => {
    // Memindahkan pengurang dari satu tagihan ke tagihan lain.
    state.retur = [{ id: 'nrt1', storeId: 't9' }];
    expect(
      await buatKlaimPembayaran({
        ...DASAR,
        pelunasan: [{ receivableId: 'r1', nilai: 1_000_000 }],
        potongan: [{ nama: 'Retur', nilai: 100_000, storeReturnId: 'nrt1' }],
      }),
    ).toEqual({ ok: false, alasan: 'RETUR_BEDA_TOKO' });
  });

  it('menghitung diterima = faktur − potongan', async () => {
    const h = await buatKlaimPembayaran({
      ...DASAR,
      pelunasan: [{ receivableId: 'r1', nilai: 5_000_000 }],
      potongan: [{ nama: 'Retur barang', nilai: 870_000, storeReturnId: 'nrt1' }],
    });
    expect(h).toMatchObject({ ok: true, docNo: 'BKM/2026/0001' });
    expect(angka(state.dibuat[0].invoiceAmount)).toBe(5_000_000);
    expect(angka(state.dibuat[0].deductionTotal)).toBe(870_000);
    expect(angka(state.dibuat[0].receivedAmount)).toBe(4_130_000);
  });

  it('menyimpan tautan potongan ke nota returnya', async () => {
    // Tautan inilah yang membuat Aturan 2 bisa bekerja. Tanpanya potongan ini
    // cuma pengurang harga biasa dan tidak pernah ditahan.
    await buatKlaimPembayaran({
      ...DASAR,
      pelunasan: [{ receivableId: 'r1', nilai: 5_000_000 }],
      potongan: [{ nama: 'Retur barang', nilai: 870_000, storeReturnId: 'nrt1' }],
    });
    const potongan = (state.dibuat[0].deductions as { create: { storeReturnId: string | null }[] })
      .create;
    expect(potongan[0].storeReturnId).toBe('nrt1');
  });

  it('membiarkan potongan non-retur tanpa tautan', async () => {
    await buatKlaimPembayaran({
      ...DASAR,
      pelunasan: [{ receivableId: 'r1', nilai: 5_000_000 }],
      potongan: [{ nama: 'Promosi', nilai: 50_000 }],
    });
    const potongan = (state.dibuat[0].deductions as { create: { storeReturnId: string | null }[] })
      .create;
    expect(potongan[0].storeReturnId).toBeNull();
  });

  it('menyimpan klaim berstatus DIKIRIM — bukan lunas', async () => {
    // Aturan 1. Selama DIKIRIM, nilai yang diakui nol.
    await buatKlaimPembayaran({
      ...DASAR,
      pelunasan: [{ receivableId: 'r1', nilai: 5_000_000 }],
    });
    expect(state.dibuat[0].status).toBe('DIKIRIM');
  });
});

describe('aturan jenis potongan yang menempel pada toko', () => {
  const potonganPph = (deductionTypeId: string) => ({
    ...DASAR,
    pelunasan: [{ receivableId: 'r1', nilai: 1_000_000 }],
    potongan: [{ nama: 'PPh 23', nilai: 20_000, deductionTypeId }],
  });

  it('MENOLAK potongan khusus PKP pada toko non-PKP', async () => {
    /*
     * Sebelum `Store.isPkp` ada, `pkpOnly` adalah aturan yang tidak menjaga
     * apa pun — tidak ada kolom yang bisa ditanya, jadi potongan pajak yang
     * seharusnya tidak ada mengurangi tagihan diam-diam.
     */
    state.tokoPkp = false;
    expect(await buatKlaimPembayaran(potonganPph('pph23'))).toEqual({
      ok: false,
      alasan: 'JENIS_HANYA_PKP',
    });
    expect(state.dibuat).toHaveLength(0);
  });

  it('mengizinkannya pada toko PKP', async () => {
    state.tokoPkp = true;
    const hasil = await buatKlaimPembayaran(potonganPph('pph23'));
    expect(hasil.ok).toBe(true);
  });

  it('tidak menghalangi potongan biasa di toko non-PKP', async () => {
    // Penjagaannya harus sempit: hanya jenis yang ditandai, bukan semua potongan.
    state.tokoPkp = false;
    const hasil = await buatKlaimPembayaran(potonganPph('biasa'));
    expect(hasil.ok).toBe(true);
  });
});
