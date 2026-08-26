import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tes penyapu foto tanpa menyentuh database.
 *
 * Yang dijaga di sini bukan "berapa yang terhapus" melainkan APA YANG TIDAK
 * BOLEH terhapus: foto yang masih ditunjuk dokumen, dan foto yang baru saja
 * diunggah dari formulir yang mungkin masih terbuka.
 */

const state = {
  foto: [] as { id: string; sizeBytes: number; createdAt: Date }[],
  klaim: [] as { transferPhotoUrl: string | null; breakdownPhotoUrl: string | null }[],
  kontrabon: [] as { photoUrl: string | null }[],
  retur: [] as { photoUrl: string | null }[],
  dihapus: [] as string[],
  saringUmur: null as Date | null,
};

const prisma = {
  foto: {
    findMany: vi.fn(async (args: { where?: { createdAt?: { lt?: Date } }; take?: number }) => {
      const batas = args?.where?.createdAt?.lt;
      state.saringUmur = batas ?? null;
      const cocok = batas ? state.foto.filter((f) => f.createdAt < batas) : state.foto;
      return cocok.slice(0, args?.take ?? cocok.length);
    }),
    deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
      state.dihapus.push(...args.where.id.in);
      return { count: args.where.id.in.length };
    }),
    aggregate: vi.fn(async () => ({
      _count: { _all: state.foto.length },
      _sum: { sizeBytes: state.foto.reduce((s, f) => s + f.sizeBytes, 0) },
    })),
  },
  paymentClaim: { findMany: vi.fn(async () => state.klaim) },
  collectionNote: { findMany: vi.fn(async () => state.kontrabon) },
  storeReturn: { findMany: vi.fn(async () => state.retur) },
};

vi.mock('@elorae/db', () => ({ prisma }));

const { sapuFotoYatim, pemakaianFoto, JAM_MASA_TENGGANG } = await import('./pembersih');

const lama = (jamLalu: number) => new Date(Date.now() - jamLalu * 60 * 60 * 1000);

beforeEach(() => {
  state.foto = [
    { id: 'dipakai', sizeBytes: 1_000, createdAt: lama(48) },
    { id: 'yatim', sizeBytes: 2_000, createdAt: lama(48) },
    { id: 'barusaja', sizeBytes: 4_000, createdAt: lama(1) },
  ];
  state.klaim = [{ transferPhotoUrl: '/api/foto/dipakai', breakdownPhotoUrl: null }];
  state.kontrabon = [];
  state.retur = [];
  state.dihapus = [];
  state.saringUmur = null;
  // Hitungan panggilan menumpuk antar tes kalau tidak dibersihkan, dan tes yang
  // memeriksa "tidak dipanggil sama sekali" jadi gagal karena tes sebelumnya.
  vi.clearAllMocks();
});

describe('sapuFotoYatim', () => {
  it('TIDAK PERNAH menghapus foto yang masih ditunjuk dokumen', async () => {
    await sapuFotoYatim({ kering: false });
    expect(state.dihapus).not.toContain('dipakai');
    expect(state.dihapus).toContain('yatim');
  });

  it('TIDAK menyentuh foto yang baru diunggah — masa tenggang', async () => {
    /*
     * Foto yang baru diunggah SELALU yatim: kolom penunjuknya baru terisi saat
     * dokumennya disimpan. Tanpa lantai umur, penyapuan ini menghapus foto dari
     * formulir yang sedang diisi orang.
     */
    await sapuFotoYatim({ kering: false });
    expect(state.dihapus).not.toContain('barusaja');
    // Saringan umurnya benar-benar dipasang di kueri, bukan disaring belakangan.
    const jarakJam = (Date.now() - (state.saringUmur as Date).getTime()) / 3_600_000;
    expect(Math.round(jarakJam)).toBe(JAM_MASA_TENGGANG);
  });

  it('bawaannya KERING — tidak menghapus apa pun kalau tidak diminta', async () => {
    // Fungsi yang menghapus baris harus diminta terang-terangan.
    const r = await sapuFotoYatim();
    expect(state.dihapus).toHaveLength(0);
    expect(r.dihapus).toBe(0);
    // ...tapi tetap melaporkan apa yang AKAN terhapus.
    expect(r.id).toEqual(['yatim']);
    expect(r.byteDibebaskan).toBe(2_000);
  });

  it('membaca keempat kolom penunjuk, bukan hanya bukti transfer', async () => {
    // Satu kolom yang terlewat berarti foto yang masih dipakai ikut tersapu.
    state.foto = [
      { id: 'a', sizeBytes: 1, createdAt: lama(48) },
      { id: 'b', sizeBytes: 1, createdAt: lama(48) },
      { id: 'c', sizeBytes: 1, createdAt: lama(48) },
      { id: 'd', sizeBytes: 1, createdAt: lama(48) },
    ];
    state.klaim = [{ transferPhotoUrl: '/api/foto/a', breakdownPhotoUrl: '/api/foto/b' }];
    state.kontrabon = [{ photoUrl: '/api/foto/c' }];
    state.retur = [{ photoUrl: '/api/foto/d' }];
    const r = await sapuFotoYatim({ kering: false });
    expect(r.id).toHaveLength(0);
    expect(state.dihapus).toHaveLength(0);
  });

  it('tidak memanggil deleteMany sama sekali kalau tidak ada yatim', async () => {
    // `deleteMany` dengan daftar kosong adalah kueri sia-sia, dan sebuah daftar
    // kosong yang bocor jadi `undefined` akan menghapus seluruh tabel.
    state.foto = [{ id: 'dipakai', sizeBytes: 1, createdAt: lama(48) }];
    await sapuFotoYatim({ kering: false });
    expect(prisma.foto.deleteMany).not.toHaveBeenCalled();
  });
});

describe('pemakaianFoto', () => {
  it('memisahkan yang terpakai dari yang sampah', async () => {
    const p = await pemakaianFoto();
    expect(p.jumlah).toBe(3);
    expect(p.totalByte).toBe(7_000);
    expect(p.yatimJumlah).toBe(1);
    expect(p.yatimByte).toBe(2_000);
  });
});
