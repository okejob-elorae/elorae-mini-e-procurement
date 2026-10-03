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
  /** Baris per model Prisma — model yang tidak diisi tes mengembalikan kosong. */
  baris: {} as Record<string, Record<string, unknown>[]>,
  dihapus: [] as string[],
  saringUmur: null as Date | null,
};

const fotoDelegasi = {
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
};

const prisma = new Proxy({} as Record<string, unknown>, {
  get(_, model: string) {
    if (model === 'foto') return fotoDelegasi;
    return { findMany: vi.fn(async () => state.baris[model] ?? []) };
  },
});

vi.mock('@elorae/db', () => ({ prisma }));

const { sapuFotoYatim, pemakaianFoto, JAM_MASA_TENGGANG, KOLOM_FOTO, urlFotoDalam } = await import('./pembersih');

const lama = (jamLalu: number) => new Date(Date.now() - jamLalu * 60 * 60 * 1000);

beforeEach(() => {
  state.foto = [
    { id: 'dipakai', sizeBytes: 1_000, createdAt: lama(48) },
    { id: 'yatim', sizeBytes: 2_000, createdAt: lama(48) },
    { id: 'barusaja', sizeBytes: 4_000, createdAt: lama(1) },
  ];
  state.baris = { paymentClaim: [{ transferPhotoUrl: '/api/foto/dipakai', breakdownPhotoUrl: null }] };
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

  it('membaca SETIAP kolom foto yang terdaftar — bukan hanya bukti transfer', async () => {
    // Satu kolom yang terlewat berarti foto yang masih dipakai ikut tersapu.
    // Sampai 2026-10-03 bukti terima, struk biaya, swafoto, dll. tersapu semua.
    state.foto = KOLOM_FOTO.map((k, i) => ({ id: `f${i}`, sizeBytes: 1, createdAt: lama(48) }));
    state.baris = Object.fromEntries(
      KOLOM_FOTO.map((k, i) => [
        k.model,
        [{ [k.kolom[0]]: k.json ? [`/api/foto/f${i}`] : `/api/foto/f${i}` }],
      ]),
    );
    const r = await sapuFotoYatim({ kering: false });
    expect(r.id).toEqual([]);
    expect(state.dihapus).toHaveLength(0);
  });

  it('mengenali beberapa URL di satu kolom teks atau JSON', () => {
    expect(urlFotoDalam('["/api/foto/a","/api/foto/b-1"]')).toEqual(['/api/foto/a', '/api/foto/b-1']);
    expect(urlFotoDalam([{ url: '/api/foto/c' }])).toEqual(['/api/foto/c']);
    expect(urlFotoDalam(null)).toEqual([]);
    expect(urlFotoDalam('https://r2.example/x.jpg')).toEqual([]);
  });

  it('tidak memanggil deleteMany sama sekali kalau tidak ada yatim', async () => {
    // `deleteMany` dengan daftar kosong adalah kueri sia-sia, dan sebuah daftar
    // kosong yang bocor jadi `undefined` akan menghapus seluruh tabel.
    state.foto = [{ id: 'dipakai', sizeBytes: 1, createdAt: lama(48) }];
    await sapuFotoYatim({ kering: false });
    expect(fotoDelegasi.deleteMany).not.toHaveBeenCalled();
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
