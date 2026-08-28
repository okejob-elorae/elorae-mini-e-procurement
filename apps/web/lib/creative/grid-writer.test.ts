import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededIds } from '@elorae/db';
import { hapusBanyakKonten, hapusKonten, simpanKonten, tukarJadwalKonten } from './writer';
import { daftarKonten } from './queries';
import { susunFeed } from './feed';

/**
 * Menghapus dan menukar ubin grid, terhadap basis data sungguhan.
 *
 * Diuji di sini dan bukan sebagai fungsi murni karena yang bisa salah bukan
 * aritmetikanya melainkan APA YANG TERSENTUH: sebuah penukaran yang menulis
 * satu sisi saja, atau penghapusan yang ikut membawa baris lain.
 */

const tag = `GRIDUJI-${Math.random().toString(36).slice(2, 7)}`;
let ids: string[] = [];
let userId = '';

async function buat(judul: string, tanggal: string | null) {
  const r = await simpanKonten({
    isi: {
      title: `${tag} ${judul}`,
      platform: 'INSTAGRAM',
      format: 'FEED',
      status: 'IDE',
      scheduledAt: tanggal ? new Date(`${tanggal}T03:00:00Z`) : null,
    },
    olehUserId: userId,
  });
  if (!r.ok) throw new Error(r.alasan);
  ids.push(r.id);
  return r.id;
}

beforeEach(async () => {
  ids = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(ids) } } });
  await prisma.contentPlan.deleteMany({ where: { id: { in: seededIds(ids) } } });
});

describe('hapusKonten', () => {
  it('menghapus barisnya dan tidak menyentuh yang lain', async () => {
    const a = await buat('a', '2026-09-01');
    const b = await buat('b', '2026-09-02');
    expect((await hapusKonten({ id: a, olehUserId: userId })).ok).toBe(true);

    const sisa = (await daftarKonten()).filter((k) => k.title.startsWith(tag));
    expect(sisa.map((k) => k.id)).toEqual([b]);
  });

  it('mencatat jejaknya lengkap dengan judul dan jadwalnya', async () => {
    /*
     * Barisnya benar-benar hilang, jadi jejak adalah satu-satunya tempat isi
     * konten yang dihapus masih bisa dibaca.
     */
    const a = await buat('a', '2026-09-01');
    await hapusKonten({ id: a, olehUserId: userId });

    const j = await prisma.auditLog.findFirst({
      where: { entityId: a, action: 'CONTENT_PLAN_DELETED' },
      select: { metadata: true },
    });
    const m = j!.metadata as { title: string; scheduledAt: string | null };
    expect(m.title).toBe(`${tag} a`);
    expect(m.scheduledAt).toContain('2026-09-01');
  });

  it('menolak konten yang tidak ada, bukan diam-diam berhasil', async () => {
    const h = await hapusKonten({ id: 'tidak-ada', olehUserId: userId });
    expect(h).toEqual({ ok: false, alasan: 'TIDAK_DITEMUKAN' });
  });
});

describe('tukarJadwalKonten', () => {
  it('BENAR-BENAR menukar posisinya di grid', async () => {
    const a = await buat('a', '2026-09-01');
    const b = await buat('b', '2026-09-08');

    const sebelum = susunFeed((await daftarKonten()).filter((k) => k.title.startsWith(tag)));
    expect(sebelum[0].sel.map((s) => s.konten.id)).toEqual([b, a]);

    expect((await tukarJadwalKonten({ idA: a, idB: b, olehUserId: userId })).ok).toBe(true);

    const sesudah = susunFeed((await daftarKonten()).filter((k) => k.title.startsWith(tag)));
    expect(sesudah[0].sel.map((s) => s.konten.id)).toEqual([a, b]);
  });

  it('menukar KEDUA sisinya, bukan hanya yang diseret', async () => {
    // Menulis satu sisi saja membuat dua konten berbagi tanggal yang sama, dan
    // urutan di antara keduanya jadi tidak ditentukan apa pun.
    const a = await buat('a', '2026-09-01');
    const b = await buat('b', '2026-09-08');
    await tukarJadwalKonten({ idA: a, idB: b, olehUserId: userId });

    const peta = new Map(
      (await daftarKonten())
        .filter((k) => k.title.startsWith(tag))
        .map((k) => [k.id, k.scheduledAt?.slice(0, 10)]),
    );
    expect(peta.get(a)).toBe('2026-09-08');
    expect(peta.get(b)).toBe('2026-09-01');
  });

  it('bisa menukar dengan ubin yang belum berjadwal', async () => {
    // Yang belum berjadwal ada di dasar grid; menyeretnya ke atas adalah cara
    // paling wajar memberinya tanggal.
    const a = await buat('a', '2026-09-01');
    const b = await buat('b', null);
    await tukarJadwalKonten({ idA: b, idB: a, olehUserId: userId });

    const peta = new Map(
      (await daftarKonten())
        .filter((k) => k.title.startsWith(tag))
        .map((k) => [k.id, k.scheduledAt]),
    );
    expect(peta.get(b)).toContain('2026-09-01');
    expect(peta.get(a)).toBeNull();
  });

  it('menolak menukar ubin dengan dirinya sendiri', async () => {
    const a = await buat('a', '2026-09-01');
    expect(await tukarJadwalKonten({ idA: a, idB: a, olehUserId: userId })).toEqual({
      ok: false,
      alasan: 'TIDAK_VALID',
    });
  });

  it('menolak kalau salah satu ubinnya sudah tidak ada', async () => {
    const a = await buat('a', '2026-09-01');
    expect(await tukarJadwalKonten({ idA: a, idB: 'hilang', olehUserId: userId })).toEqual({
      ok: false,
      alasan: 'TIDAK_DITEMUKAN',
    });
  });

  it('mencatat kedua sisi penukaran di jejaknya', async () => {
    // Penukaran yang hanya tercatat di satu sisi tidak bisa ditelusuri balik
    // dari sisi yang lain.
    const a = await buat('a', '2026-09-01');
    const b = await buat('b', '2026-09-08');
    await tukarJadwalKonten({ idA: a, idB: b, olehUserId: userId });

    const j = await prisma.auditLog.findFirst({
      where: { entityId: a, action: 'CONTENT_PLAN_SWAPPED' },
      select: { metadata: true },
    });
    expect((j!.metadata as { pasanganId: string }).pasanganId).toBe(b);
  });
});

describe('hapusBanyakKonten', () => {
  it('menghapus semua yang diminta dan tidak menyentuh yang lain', async () => {
    const a = await buat('a', '2026-09-01');
    const b = await buat('b', '2026-09-02');
    const c = await buat('c', '2026-09-03');

    const h = await hapusBanyakKonten({ ids: [a, c], olehUserId: userId });
    expect(h).toMatchObject({ ok: true, dihapus: 2 });

    const sisa = (await daftarKonten()).filter((k) => k.title.startsWith(tag));
    expect(sisa.map((k) => k.id)).toEqual([b]);
  });

  it('menulis SATU jejak per konten, bukan satu untuk seluruh kumpulan', async () => {
    /*
     * Barisnya benar-benar hilang, jadi jejak satu-satunya tempat isinya masih
     * bisa dibaca — dan mencarinya nanti dilakukan per konten, bukan per
     * penghapusan massal yang nomornya tidak diingat siapa pun.
     */
    const a = await buat('a', '2026-09-01');
    const b = await buat('b', '2026-09-02');
    await hapusBanyakKonten({ ids: [a, b], olehUserId: userId });

    const jejak = await prisma.auditLog.findMany({
      where: { entityId: { in: seededIds([a, b]) }, action: 'CONTENT_PLAN_DELETED' },
      select: { entityId: true, metadata: true },
    });
    expect(jejak).toHaveLength(2);
    expect((jejak[0].metadata as { sekaligus: number }).sekaligus).toBe(2);
  });

  it('membuang id kembar, tidak menghitungnya dua kali', async () => {
    const a = await buat('a', '2026-09-01');
    const h = await hapusBanyakKonten({ ids: [a, a, a], olehUserId: userId });
    expect(h).toMatchObject({ ok: true, dihapus: 1 });
  });

  it('menolak daftar kosong, bukan diam-diam berhasil', async () => {
    // `deleteMany` dengan daftar kosong berhasil tanpa menghapus apa pun, dan
    // pemanggilnya diberi tahu bahwa penghapusannya jadi.
    expect(await hapusBanyakKonten({ ids: [], olehUserId: userId })).toEqual({
      ok: false,
      alasan: 'TIDAK_VALID',
    });
  });

  it('menolak kalau tidak ada satu pun yang benar-benar ada', async () => {
    expect(await hapusBanyakKonten({ ids: ['hilang'], olehUserId: userId })).toEqual({
      ok: false,
      alasan: 'TIDAK_DITEMUKAN',
    });
  });

  it('menghapus yang ada dan mengabaikan yang tidak, tanpa gagal seluruhnya', async () => {
    // Sebuah ubin bisa dihapus orang lain di antara pilih dan tekan hapus.
    // Menggagalkan seluruhnya karena itu membuat pekerjaan orang hilang.
    const a = await buat('a', '2026-09-01');
    const h = await hapusBanyakKonten({ ids: [a, 'hilang'], olehUserId: userId });
    expect(h).toMatchObject({ ok: true, dihapus: 1 });
  });
});
