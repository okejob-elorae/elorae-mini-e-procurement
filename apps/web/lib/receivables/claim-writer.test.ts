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
  /** BKM yang sudah tercatat dengan kunci kiriman tertentu. */
  klaimBerkunci: null as { id: string; docNo: string; salesmanId: string } | null,
  /** Berapa kali `create` harus kalah balapan kunci sebelum boleh berhasil. */
  kalahBalapan: 0,
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
  // Pemilik foto (`fotoBolehDipakai`): foto tiruan tidak ada di tabel `Foto`,
  // jadi tidak ada yang bisa dicuci — pemeriksaannya diuji di foto-pencatat.test.ts.
  foto: { findMany: vi.fn(async () => []) },
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
    findUnique: vi.fn(async () => state.klaimBerkunci),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      if (state.kalahBalapan > 0) {
        // Kiriman kembar yang tiba bersamaan: yang lain menang lebih dulu.
        state.kalahBalapan -= 1;
        state.klaimBerkunci = { id: 'bkm-kembar', docNo: 'BKM/2026/0009', salesmanId: 'u1' };
        const { Prisma } = await import('@elorae/db');
        const err = new Prisma.PrismaClientKnownRequestError('unik', { code: 'P2002', clientVersion: 'x' });
        Object.assign(err, { meta: { target: 'PaymentClaim_idempotencyKey_key' } });
        throw err;
      }
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
  // Pemakaian NRT diuji terhadap basis data di `pelunasan-ganda.test.ts`;
  // di sini setiap nota dianggap belum terpakai.
  returYangMelebihi: async () => null,
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
  state.klaimBerkunci = null;
  state.kalahBalapan = 0;
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

describe('kiriman dari antrean offline HP', () => {
  /*
   * Antrean mengirim ulang sampai servernya menjawab. Kalau BKM sebenarnya
   * sudah tersimpan tapi jawabannya hilang di jalan, kiriman berikutnya
   * TIDAK boleh mencatatnya dua kali — dua BKM untuk satu transfer.
   */
  const KIRIMAN = { ...DASAR, idempotencyKey: 'hp-1', pelunasan: [{ receivableId: 'r1', nilai: 1_000_000 }] };

  it('menyimpan kunci kirimannya pada BKM baru', async () => {
    const hasil = await buatKlaimPembayaran(KIRIMAN);
    expect(hasil.ok).toBe(true);
    expect(state.dibuat[0].idempotencyKey).toBe('hp-1');
  });

  it('mengembalikan BKM yang sudah ada untuk kunci yang sama, tanpa membuat baru', async () => {
    state.klaimBerkunci = { id: 'bkm0', docNo: 'BKM/2026/0007', salesmanId: 'u1' };
    expect(await buatKlaimPembayaran(KIRIMAN)).toEqual({ ok: true, id: 'bkm0', docNo: 'BKM/2026/0007' });
    expect(state.dibuat).toHaveLength(0);
    expect(state.jejak).toHaveLength(0);
  });

  it('mengenali kiriman ulang SEBELUM memeriksa sisa — fakturnya mungkin sudah lunas sejak itu', async () => {
    // Kalau pemeriksaan sisa didahulukan, kiriman ulang BKM yang sudah
    // diverifikasi akan ditolak "sudah lunas" dan sales mengira laporannya hilang.
    state.klaimBerkunci = { id: 'bkm0', docNo: 'BKM/2026/0007', salesmanId: 'u1' };
    state.sisa.set('r1', 0);
    expect(await buatKlaimPembayaran(KIRIMAN)).toEqual({ ok: true, id: 'bkm0', docNo: 'BKM/2026/0007' });
  });

  it('tidak menyerahkan BKM milik sales lain yang kebetulan berkunci sama', async () => {
    state.klaimBerkunci = { id: 'bkmX', docNo: 'BKM/2026/0001', salesmanId: 'u9' };
    expect(await buatKlaimPembayaran(KIRIMAN)).toEqual({ ok: false, alasan: 'KUNCI_DIPAKAI' });
    expect(state.dibuat).toHaveLength(0);
  });

  it('dua kiriman kembar yang tiba bersamaan menghasilkan satu BKM', async () => {
    state.kalahBalapan = 1;
    expect(await buatKlaimPembayaran(KIRIMAN)).toEqual({ ok: true, id: 'bkm-kembar', docNo: 'BKM/2026/0009' });
    expect(state.dibuat).toHaveLength(0);
  });

  it('BKM dari kantor tanpa kunci tetap seperti biasa', async () => {
    const hasil = await buatKlaimPembayaran({ ...DASAR, pelunasan: [{ receivableId: 'r1', nilai: 1_000_000 }] });
    expect(hasil.ok).toBe(true);
    expect(state.dibuat[0].idempotencyKey ?? null).toBeNull();
  });
});

describe('pelunasan dengan giro', () => {
  const TERBIT = new Date('2026-09-01T00:00:00+07:00');
  const EFEKTIF = new Date('2026-09-20T00:00:00+07:00');
  const GIRO = {
    ...DASAR,
    method: 'giro',
    transferPhotoUrl: '/api/foto/bilyet',
    pelunasan: [{ receivableId: 'r1', nilai: 1_000_000 }],
    giro: { nomor: 'BG 001122', bank: 'BCA', tanggalTerbit: TERBIT, tanggalEfektif: EFEKTIF },
  };

  it('menyimpan rincian bilyet dan menandainya MENUNGGU', async () => {
    // Giro dicatat sebagai janji bank yang belum cair — klaimnya pun DIKIRIM.
    const h = await buatKlaimPembayaran(GIRO);
    expect(h.ok).toBe(true);
    expect(state.dibuat[0]).toMatchObject({
      method: 'giro',
      status: 'DIKIRIM',
      giroNo: 'BG 001122',
      giroBank: 'BCA',
      giroIssueDate: TERBIT,
      giroEffectiveDate: EFEKTIF,
      giroStatus: 'MENUNGGU',
    });
  });

  it('menolak giro tanpa nomor, bank, atau tanggal SEBELUM menyentuh basis data', async () => {
    expect(await buatKlaimPembayaran({ ...GIRO, giro: { ...GIRO.giro, nomor: '' } })).toEqual({
      ok: false,
      alasan: 'GIRO_NOMOR_WAJIB',
    });
    expect(await buatKlaimPembayaran({ ...GIRO, giro: null })).toEqual({
      ok: false,
      alasan: 'GIRO_NOMOR_WAJIB',
    });
    expect(state.dibuat).toHaveLength(0);
    expect(state.dihitungUlang).toHaveLength(0);
  });

  it('menolak tanggal efektif di luar masa berlaku 70 hari', async () => {
    const h = await buatKlaimPembayaran({
      ...GIRO,
      giro: { ...GIRO.giro, tanggalEfektif: new Date('2026-11-11T00:00:00+07:00') },
    });
    expect(h).toEqual({ ok: false, alasan: 'GIRO_LEWAT_MASA_BERLAKU' });
  });

  it('tetap menuntut foto (bilyet giro)', async () => {
    expect(await buatKlaimPembayaran({ ...GIRO, transferPhotoUrl: null })).toEqual({
      ok: false,
      alasan: 'FOTO_WAJIB',
    });
  });

  it('mengabaikan isian giro pada cara bayar lain', async () => {
    // Formulir bisa mengirim sisa isian giro yang sempat diketik sebelum cara
    // bayarnya diganti. Transfer tidak boleh ikut tertahan menunggu "cair".
    const h = await buatKlaimPembayaran({ ...GIRO, method: 'transfer' });
    expect(h.ok).toBe(true);
    expect(state.dibuat[0].giroStatus ?? null).toBeNull();
    expect(state.dibuat[0].giroNo ?? null).toBeNull();
  });
});
