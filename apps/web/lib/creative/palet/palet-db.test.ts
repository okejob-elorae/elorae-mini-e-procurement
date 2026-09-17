import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededId } from '@elorae/db';
import { daftarPalet, daftarPantoneTcx } from './queries';
import { hexKeHsb, hsbKeHex } from './warna';
import { hapusPalet, simpanPalet } from './writer';

/**
 * Palet terhadap basis data sungguhan: yang ditulis adalah yang dibaca kembali,
 * dan baris yang rusak tidak merobohkan daftarnya.
 */

const tag = `PAL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const WARNA = ['#FF0000', '#00ff00', '#0000FF', '#ffff00', '#f0f'];
let userId = '';
let dibuat: string[] = [];

beforeEach(async () => {
  userId = '';
  dibuat = [];
  const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
  userId = user.id;
});

afterEach(async () => {
  for (const id of dibuat) {
    await prisma.colorPalette.deleteMany({ where: { id: seededId(id) } });
  }
});

describe('palet warna', () => {
  it('membaca kembali palet yang disimpan, warnanya rapi dan urutannya utuh', async () => {
    const r = await simpanPalet({
      masukan: { nama: `${tag} Feed Agustus`, aturan: 'TRIAD', warna: WARNA },
      olehUserId: userId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    dibuat.push(r.id);

    const baris = (await daftarPalet()).find((p) => p.id === r.id);
    expect(baris).toMatchObject({
      nama: `${tag} Feed Agustus`,
      aturan: 'TRIAD',
      warna: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'],
    });
  });

  it('tidak menulis apa pun kalau paletnya tidak sah', async () => {
    const sebelum = await prisma.colorPalette.count();
    const r = await simpanPalet({
      masukan: { nama: `${tag} kurang`, aturan: 'TRIAD', warna: WARNA.slice(0, 3) },
      olehUserId: userId,
    });
    expect(r).toEqual({ ok: false, alasan: 'WARNA_TIDAK_SAH' });
    expect(await prisma.colorPalette.count()).toBe(sebelum);
  });

  it('menghapus palet, dan melapor kalau paletnya sudah tidak ada', async () => {
    const r = await simpanPalet({
      masukan: { nama: `${tag} hapus`, aturan: 'CUSTOM', warna: WARNA },
      olehUserId: userId,
    });
    if (!r.ok) throw new Error('gagal menyiapkan palet');
    dibuat.push(r.id);

    expect(await hapusPalet(r.id)).toEqual({ ok: true });
    expect(await hapusPalet(r.id)).toEqual({ ok: false, alasan: 'TIDAK_DITEMUKAN' });
    expect((await daftarPalet()).some((p) => p.id === r.id)).toBe(false);
  });

  it('menolak id kosong alih-alih menghapus semuanya', async () => {
    /*
     * Prisma membuang filter bernilai kosong. Tanpa penjaga, penghapusan
     * dengan id yang tidak terisi bisa menyapu seluruh tabel.
     */
    const r = await simpanPalet({
      masukan: { nama: `${tag} penjaga`, aturan: 'CUSTOM', warna: WARNA },
      olehUserId: userId,
    });
    if (!r.ok) throw new Error('gagal menyiapkan palet');
    dibuat.push(r.id);

    expect(await hapusPalet('')).toEqual({ ok: false, alasan: 'TIDAK_DITEMUKAN' });
    expect(await hapusPalet(undefined as unknown as string)).toEqual({ ok: false, alasan: 'TIDAK_DITEMUKAN' });
    expect(await prisma.colorPalette.count({ where: { id: r.id } })).toBe(1);
  });

  it('melewati baris yang kolom warnanya rusak tanpa merobohkan daftar', async () => {
    const baik = await simpanPalet({
      masukan: { nama: `${tag} baik`, aturan: 'SHADES', warna: WARNA },
      olehUserId: userId,
    });
    if (!baik.ok) throw new Error('gagal menyiapkan palet');
    dibuat.push(baik.id);

    const rusak = await prisma.colorPalette.create({
      data: { name: `${tag} rusak`, harmony: 'RAINBOW', colors: { bukan: 'daftar' } },
      select: { id: true },
    });
    dibuat.push(rusak.id);

    const daftar = await daftarPalet();
    expect(daftar.some((p) => p.id === baik.id)).toBe(true);
    expect(daftar.some((p) => p.id === rusak.id)).toBe(false);
  });

  it('membaca aturan yang tidak dikenal lagi sebagai bebas', async () => {
    const lama = await prisma.colorPalette.create({
      data: { name: `${tag} lama`, harmony: 'ATURAN_LAMA', colors: WARNA },
      select: { id: true },
    });
    dibuat.push(lama.id);
    expect((await daftarPalet()).find((p) => p.id === lama.id)?.aturan).toBe('CUSTOM');
  });

  it('mengirim TCX sebagai kode unik dengan hex yang sah dan kembali utuh lewat roda', async () => {
    const tcx = await daftarPantoneTcx();
    expect(new Set(tcx.map(([kode]) => kode)).size).toBe(tcx.length);
    for (const [kode, hex, nama] of tcx) {
      expect(hex, kode).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(nama, kode).toBeTruthy();
      expect(hsbKeHex(hexKeHsb(hex)), kode).toBe(hex.toLowerCase());
    }
  });
});
