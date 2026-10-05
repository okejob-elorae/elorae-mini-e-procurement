import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tes penulis kontrabon tanpa menyentuh database.
 *
 * Yang dijaga di sini adalah penolakan-penolakannya, bukan jalan mulusnya:
 * setiap penolakan mencegah satu keadaan yang sudah pernah terjadi di lapangan
 * — faktur yang sama ditagih dua sales, tanda terima lintas toko yang tak bisa
 * ditandatangani, dan tanda terima berisi faktur yang uangnya sudah masuk.
 */

type Piutang = {
  id: string;
  storeId: string;
  /** Penjual faktur. */
  salesmanId: string | null;
  /** Pemegang toko sekarang. */
  store: { salesmanId: string | null };
  collectionLinks: { collectionNote: { status: string } }[];
};

type Nota = {
  id: string;
  docNo?: string;
  status: string;
  note: string | null;
  source?: string;
  confirmedAt?: Date | null;
  salesmanId?: string;
  storeId?: string;
};

const state = {
  piutang: [] as Piutang[],
  sisa: new Map<string, number>(),
  dibuat: [] as Record<string, unknown>[],
  nota: null as Nota | null,
  notaUpdates: [] as Record<string, unknown>[],
  jejak: [] as Record<string, unknown>[],
  /** Kontrabon yang sudah tercatat dengan kunci kiriman tertentu. */
  notaBerkunci: null as { id: string; docNo: string; salesmanId: string; amount: number } | null,
  /** Berapa baris yang "menang" saat konfirmasi bertanding-lalu-tukar. */
  konfirmasiMenang: 1,
};

const tx = {
  // Pemilik foto (`fotoBolehDipakai`): foto tiruan tidak ada di tabel `Foto`,
  // jadi tidak ada yang bisa dicuci — pemeriksaannya diuji di foto-pencatat.test.ts.
  foto: { findMany: vi.fn(async () => []) },
  receivable: { findMany: vi.fn(async () => state.piutang) },
  collectionNote: {
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async (args: { where: { id?: string; idempotencyKey?: string } }) => {
      if (args.where.idempotencyKey !== undefined) return state.notaBerkunci;
      return state.nota
        ? { ...state.nota, receivableLinks: state.piutang.map((p) => ({ receivableId: p.id })) }
        : null;
    }),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.dibuat.push(args.data);
      return { id: 'tt1', docNo: args.data.docNo as string };
    }),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.notaUpdates.push(args.data);
      return {};
    }),
    updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => {
      if (state.konfirmasiMenang > 0) state.notaUpdates.push(args.data);
      return { count: state.konfirmasiMenang };
    }),
  },
  auditLog: {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.jejak.push(args.data);
      return {};
    }),
  },
};

vi.mock('@/lib/db/tx-retry', () => ({
  runSerializable: (cb: (client: unknown) => Promise<unknown>) => cb(tx),
}));
vi.mock('./writer', () => ({
  hitungUlangPiutang: async (_c: unknown, id: string) => state.sisa.get(id) ?? 0,
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

const { buatKontrabon, konfirmasiKontrabon, tutupKontrabon } = await import('./collection-writer');

const SERAH = new Date('2026-08-26T00:00:00+07:00');
const JANJI = new Date('2026-09-09T00:00:00+07:00');
const dasarKantor = { salesmanId: 'admin', handoverDate: SERAH, promisedDate: JANJI };

function bebas(id: string, storeId = 'toko1', pemegang: string | null = 'u1'): Piutang {
  return { id, storeId, salesmanId: 'penjual-lama', store: { salesmanId: pemegang }, collectionLinks: [] };
}

beforeEach(() => {
  state.piutang = [bebas('r1'), bebas('r2')];
  state.sisa = new Map([
    ['r1', 4_000_000],
    ['r2', 1_000_000],
  ]);
  state.dibuat = [];
  state.nota = { id: 'tt1', status: 'BERJALAN', note: null };
  state.notaUpdates = [];
  state.jejak = [];
  state.notaBerkunci = null;
  state.konfirmasiMenang = 1;
});

describe('buatKontrabon', () => {
  const dasar = { salesmanId: 'u1', handoverDate: SERAH, promisedDate: JANJI };

  it('menolak daftar kosong', async () => {
    const h = await buatKontrabon({ ...dasar, receivableIds: [] });
    expect(h).toEqual({ ok: false, alasan: 'TANPA_PIUTANG' });
  });

  it('menolak janji bayar yang mendahului tanggal serah', async () => {
    // Kalau lolos, tanda terimanya langsung tampil "lewat tempo" pada hari
    // faktur itu diserahkan — angka yang tidak berarti apa-apa bagi siapa pun.
    const h = await buatKontrabon({
      ...dasar,
      receivableIds: ['r1'],
      promisedDate: new Date('2026-08-20T00:00:00+07:00'),
    });
    expect(h).toEqual({ ok: false, alasan: 'JANJI_SEBELUM_SERAH' });
  });

  it('menolak faktur dari dua toko berbeda', async () => {
    state.piutang = [bebas('r1', 'toko1'), bebas('r2', 'toko2')];
    const h = await buatKontrabon({ ...dasar, receivableIds: ['r1', 'r2'] });
    expect(h).toEqual({ ok: false, alasan: 'BEDA_TOKO' });
    expect(state.dibuat).toHaveLength(0);
  });

  it('menolak faktur yang sudah dipegang toko lewat kontrabon berjalan', async () => {
    // Inilah penjagaan intinya: tanpa ini, dua sales menagih faktur yang sama
    // ke toko yang sama.
    state.piutang = [{ ...bebas('r1'), collectionLinks: [{ collectionNote: { status: 'BERJALAN' } }] }];
    const h = await buatKontrabon({ ...dasar, receivableIds: ['r1'] });
    expect(h).toEqual({ ok: false, alasan: 'SUDAH_DI_KONTRABON' });
  });

  it('mengizinkan faktur yang kontrabon lamanya sudah dibatalkan', async () => {
    // Membatalkan berarti fakturnya ditarik kembali — ia bebas lagi.
    state.piutang = [{ ...bebas('r1'), collectionLinks: [{ collectionNote: { status: 'BATAL' } }] }];
    const h = await buatKontrabon({ ...dasar, receivableIds: ['r1'] });
    expect(h.ok).toBe(true);
  });

  it('menolak seluruh daftar kalau ada faktur yang sudah lunas', async () => {
    // Ditolak, bukan disaring diam-diam: yang menyusun tanda terima perlu tahu
    // daftarnya sudah basi sebelum kertasnya dicetak.
    state.sisa.set('r2', 0);
    const h = await buatKontrabon({ ...dasar, receivableIds: ['r1', 'r2'] });
    expect(h).toEqual({ ok: false, alasan: 'SUDAH_LUNAS' });
    expect(state.dibuat).toHaveLength(0);
  });

  it('menolak id yang tidak ada', async () => {
    const h = await buatKontrabon({ ...dasar, receivableIds: ['r1', 'r2', 'hantu'] });
    expect(h).toEqual({ ok: false, alasan: 'PIUTANG_TIDAK_DITEMUKAN' });
  });

  it('menilai kontrabon dari sisa yang dihitung ulang, bukan nilai faktur', async () => {
    const h = await buatKontrabon({ ...dasar, receivableIds: ['r1', 'r2'] });
    expect(h).toMatchObject({ ok: true, nilai: 5_000_000 });
    expect(state.dibuat[0].docNo).toBe('TT/2026/0001');
  });

  it('membuang id kembar sebelum menyimpan', async () => {
    // Satu faktur dicentang dua kali tidak boleh menghitung nilainya dua kali.
    const h = await buatKontrabon({ ...dasar, receivableIds: ['r1', 'r1', 'r2'] });
    expect(h).toMatchObject({ ok: true, nilai: 5_000_000 });
  });
});

describe('tutupKontrabon', () => {
  it('menolak pembatalan tanpa alasan SEBELUM menulis apa pun', async () => {
    const h = await tutupKontrabon({ collectionNoteId: 'tt1', olehUserId: 'u1', keputusan: 'BATAL' });
    expect(h).toEqual({ ok: false, alasan: 'ALASAN_WAJIB' });
    expect(state.notaUpdates).toHaveLength(0);
  });

  it('menolak menandai selesai selama masih ada sisa', async () => {
    // "Selesai" adalah pernyataan bahwa uangnya sudah masuk; sisanya dihitung
    // ulang saat itu juga, bukan dibaca dari kolom.
    const h = await tutupKontrabon({ collectionNoteId: 'tt1', olehUserId: 'u1', keputusan: 'SELESAI' });
    expect(h).toEqual({ ok: false, alasan: 'MASIH_ADA_SISA' });
    expect(state.notaUpdates).toHaveLength(0);
  });

  it('menandai selesai kalau semua fakturnya lunas', async () => {
    state.sisa = new Map([
      ['r1', 0],
      ['r2', 0],
    ]);
    const h = await tutupKontrabon({ collectionNoteId: 'tt1', olehUserId: 'u1', keputusan: 'SELESAI' });
    expect(h).toEqual({ ok: true, status: 'SELESAI' });
    expect(state.notaUpdates[0].status).toBe('SELESAI');
  });

  it('menolak kontrabon yang sudah ditutup', async () => {
    state.nota = { id: 'tt1', status: 'SELESAI', note: null };
    const h = await tutupKontrabon({
      collectionNoteId: 'tt1',
      olehUserId: 'u1',
      keputusan: 'BATAL',
      catatan: 'ditarik',
    });
    expect(h).toEqual({ ok: false, alasan: 'SUDAH_DITUTUP' });
  });

  it('menyimpan alasan pembatalan tanpa menghapus catatan lama', async () => {
    state.nota = { id: 'tt1', status: 'BERJALAN', note: 'catatan awal' };
    await tutupKontrabon({
      collectionNoteId: 'tt1',
      olehUserId: 'u1',
      keputusan: 'BATAL',
      catatan: 'faktur ditarik kembali',
    });
    expect(state.notaUpdates[0].note).toBe('catatan awal\nfaktur ditarik kembali');
  });
});

describe('buatKontrabon — janji bayar dari lapangan', () => {
  const lapangan = {
    receivableIds: ['r1', 'r2'],
    salesmanId: 'u1',
    handoverDate: SERAH,
    promisedDate: JANJI,
    receivedBy: 'Bu Ani',
    photoUrl: '/api/foto/tt',
    source: 'FIELD' as const,
    penagihId: 'u1',
    idempotencyKey: 'kunci-1',
  };

  it('menuntut foto lembar yang ditandatangani toko', async () => {
    // Tanpa foto, kantor tidak punya apa pun untuk dikonfirmasi — padahal
    // janjinya sudah menggeser keadaan faktur sejak dicatat.
    const h = await buatKontrabon({ ...lapangan, photoUrl: '  ' });
    expect(h).toEqual({ ok: false, alasan: 'FOTO_WAJIB' });
    expect(state.dibuat).toHaveLength(0);
  });

  it('menuntut nama orang toko yang menerima', async () => {
    const h = await buatKontrabon({ ...lapangan, receivedBy: '' });
    expect(h).toEqual({ ok: false, alasan: 'PENERIMA_WAJIB' });
  });

  it('kontrabon kantor tetap boleh tanpa foto dan penerima', async () => {
    // Urutan kantor: tanda terima dibuat dulu, kertasnya ditandatangani di
    // toko, fotonya menyusul. Aturan lapangan tidak boleh merembes ke sini.
    const h = await buatKontrabon({ ...dasarKantor, receivableIds: ['r1', 'r2'] });
    expect(h.ok).toBe(true);
    expect(state.dibuat[0].source).toBe('OFFICE');
  });

  it('menolak faktur yang tidak ia tagih', async () => {
    // Tokonya sudah dirotasi ke sales lain. Layar HP menyaringnya, tapi kiriman
    // dari antrean bisa tiba sesudah rotasi — penulis yang menjaga.
    state.piutang = [bebas('r1'), bebas('r2', 'toko1', 'u2')];
    const h = await buatKontrabon(lapangan);
    expect(h).toEqual({ ok: false, alasan: 'BUKAN_PENAGIH' });
    expect(state.dibuat).toHaveLength(0);
  });

  it('penjual asli menagih selama toko belum punya pemegang', async () => {
    state.piutang = [
      { ...bebas('r1', 'toko1', null), salesmanId: 'u1' },
      { ...bebas('r2', 'toko1', null), salesmanId: 'u1' },
    ];
    const h = await buatKontrabon(lapangan);
    expect(h.ok).toBe(true);
  });

  it('menandai asal lapangan dan menyimpan kunci kirimannya', async () => {
    const h = await buatKontrabon(lapangan);
    expect(h).toMatchObject({ ok: true, nilai: 5_000_000 });
    expect(state.dibuat[0]).toMatchObject({ source: 'FIELD', idempotencyKey: 'kunci-1', receivedBy: 'Bu Ani' });
    // Tidak ada stempel konfirmasi saat dibuat — itu pekerjaan kantor.
    expect(state.dibuat[0].confirmedAt).toBeUndefined();
    expect(state.jejak[0].metadata).toMatchObject({ sumber: 'FIELD' });
  });

  it('kiriman ulang mengembalikan kontrabon yang sama, SEBELUM memeriksa faktur', async () => {
    // Kiriman pertama sudah mengunci fakturnya. Memeriksanya lagi akan
    // menjawab "sudah di kontrabon" dan sales mengira laporannya hilang.
    state.notaBerkunci = { id: 'tt9', docNo: 'TT/2026/0009', salesmanId: 'u1', amount: 5_000_000 };
    state.piutang = [{ ...bebas('r1'), collectionLinks: [{ collectionNote: { status: 'BERJALAN' } }] }];
    const h = await buatKontrabon(lapangan);
    expect(h).toEqual({ ok: true, id: 'tt9', docNo: 'TT/2026/0009', nilai: 5_000_000 });
    expect(state.dibuat).toHaveLength(0);
  });

  it('kunci milik sales lain tidak menyerahkan kontrabon orang itu', async () => {
    state.notaBerkunci = { id: 'tt9', docNo: 'TT/2026/0009', salesmanId: 'u2', amount: 1 };
    const h = await buatKontrabon(lapangan);
    expect(h).toEqual({ ok: false, alasan: 'KUNCI_DIPAKAI' });
  });
});

describe('konfirmasiKontrabon', () => {
  const lapangan: Nota = {
    id: 'tt1',
    docNo: 'TT/2026/0001',
    status: 'BERJALAN',
    note: null,
    source: 'FIELD',
    confirmedAt: null,
    salesmanId: 'u1',
    storeId: 'toko1',
  };

  it('mengonfirmasi janji lapangan dan mencatat siapa yang mengonfirmasi', async () => {
    state.nota = { ...lapangan };
    const h = await konfirmasiKontrabon({ collectionNoteId: 'tt1', olehUserId: 'admin' });
    expect(h).toEqual({ ok: true, docNo: 'TT/2026/0001', salesmanId: 'u1', storeId: 'toko1' });
    expect(state.notaUpdates[0]).toMatchObject({ confirmedById: 'admin' });
    expect(state.notaUpdates[0].confirmedAt).toBeInstanceOf(Date);
    expect(state.jejak[0]).toMatchObject({
      action: 'COLLECTION_NOTE_CONFIRMED',
      entityId: 'tt1',
      userId: 'admin',
    });
  });

  it('menolak kontrabon kantor — tidak ada yang perlu dikonfirmasi', async () => {
    state.nota = { ...lapangan, source: 'OFFICE' };
    const h = await konfirmasiKontrabon({ collectionNoteId: 'tt1', olehUserId: 'admin' });
    expect(h).toEqual({ ok: false, alasan: 'BUKAN_DARI_LAPANGAN' });
    expect(state.jejak).toHaveLength(0);
  });

  it('menolak konfirmasi kedua', async () => {
    state.nota = { ...lapangan, confirmedAt: new Date() };
    const h = await konfirmasiKontrabon({ collectionNoteId: 'tt1', olehUserId: 'admin' });
    expect(h).toEqual({ ok: false, alasan: 'SUDAH_DIKONFIRMASI' });
  });

  it('yang kalah balapan dengan admin lain tidak menulis jejak', async () => {
    state.nota = { ...lapangan };
    state.konfirmasiMenang = 0;
    const h = await konfirmasiKontrabon({ collectionNoteId: 'tt1', olehUserId: 'admin' });
    expect(h).toEqual({ ok: false, alasan: 'SUDAH_DIKONFIRMASI' });
    expect(state.jejak).toHaveLength(0);
  });

  it('menolak kontrabon yang sudah ditutup', async () => {
    state.nota = { ...lapangan, status: 'BATAL' };
    const h = await konfirmasiKontrabon({ collectionNoteId: 'tt1', olehUserId: 'admin' });
    expect(h).toEqual({ ok: false, alasan: 'SUDAH_DITUTUP' });
  });
});
