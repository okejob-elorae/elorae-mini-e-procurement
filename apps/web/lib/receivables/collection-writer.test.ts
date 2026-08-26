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
  collectionLinks: { collectionNote: { status: string } }[];
};

const state = {
  piutang: [] as Piutang[],
  sisa: new Map<string, number>(),
  dibuat: [] as Record<string, unknown>[],
  nota: null as { id: string; status: string; note: string | null } | null,
  notaUpdates: [] as Record<string, unknown>[],
};

const tx = {
  receivable: { findMany: vi.fn(async () => state.piutang) },
  collectionNote: {
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () =>
      state.nota ? { ...state.nota, receivableLinks: state.piutang.map((p) => ({ receivableId: p.id })) } : null,
    ),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.dibuat.push(args.data);
      return { id: 'tt1', docNo: args.data.docNo as string };
    }),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.notaUpdates.push(args.data);
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

const { buatKontrabon, tutupKontrabon } = await import('./collection-writer');

const SERAH = new Date('2026-08-26T00:00:00+07:00');
const JANJI = new Date('2026-09-09T00:00:00+07:00');

function bebas(id: string, storeId = 'toko1'): Piutang {
  return { id, storeId, collectionLinks: [] };
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
    const h = await tutupKontrabon({ collectionNoteId: 'tt1', keputusan: 'BATAL' });
    expect(h).toEqual({ ok: false, alasan: 'ALASAN_WAJIB' });
    expect(state.notaUpdates).toHaveLength(0);
  });

  it('menolak menandai selesai selama masih ada sisa', async () => {
    // "Selesai" adalah pernyataan bahwa uangnya sudah masuk; sisanya dihitung
    // ulang saat itu juga, bukan dibaca dari kolom.
    const h = await tutupKontrabon({ collectionNoteId: 'tt1', keputusan: 'SELESAI' });
    expect(h).toEqual({ ok: false, alasan: 'MASIH_ADA_SISA' });
    expect(state.notaUpdates).toHaveLength(0);
  });

  it('menandai selesai kalau semua fakturnya lunas', async () => {
    state.sisa = new Map([
      ['r1', 0],
      ['r2', 0],
    ]);
    const h = await tutupKontrabon({ collectionNoteId: 'tt1', keputusan: 'SELESAI' });
    expect(h).toEqual({ ok: true, status: 'SELESAI' });
    expect(state.notaUpdates[0].status).toBe('SELESAI');
  });

  it('menolak kontrabon yang sudah ditutup', async () => {
    state.nota = { id: 'tt1', status: 'SELESAI', note: null };
    const h = await tutupKontrabon({
      collectionNoteId: 'tt1',
      keputusan: 'BATAL',
      catatan: 'ditarik',
    });
    expect(h).toEqual({ ok: false, alasan: 'SUDAH_DITUTUP' });
  });

  it('menyimpan alasan pembatalan tanpa menghapus catatan lama', async () => {
    state.nota = { id: 'tt1', status: 'BERJALAN', note: 'catatan awal' };
    await tutupKontrabon({
      collectionNoteId: 'tt1',
      keputusan: 'BATAL',
      catatan: 'faktur ditarik kembali',
    });
    expect(state.notaUpdates[0].note).toBe('catatan awal\nfaktur ditarik kembali');
  });
});
