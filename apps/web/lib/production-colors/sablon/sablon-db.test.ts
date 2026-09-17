import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, seededId } from '@elorae/db';
import { ambilTintaDasar } from './queries';
import { KUNCI_TINTA_DASAR } from './tinta-dasar';
import { simpanTintaDasar } from './writer';

/**
 * Tinta dasar terhadap basis data sungguhan.
 *
 * Pengaturan ini dipakai bersama di basis data dev, jadi nilai yang ada
 * DIPOTRET sebelum tes dan DIKEMBALIKAN sesudahnya — termasuk kembali tidak
 * ada, kalau memang belum pernah disimpan.
 */
let semula: string | null = null;

beforeAll(async () => {
  const baris = await prisma.systemSetting.findUnique({ where: { key: KUNCI_TINTA_DASAR } });
  semula = baris?.value ?? null;
});

afterAll(async () => {
  if (semula === null) {
    await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_TINTA_DASAR) } });
  } else {
    await prisma.systemSetting.update({ where: { key: KUNCI_TINTA_DASAR }, data: { value: semula } });
  }
});

describe('tinta dasar', () => {
  it('membaca kembali daftar yang disimpan, sudah dirapikan', async () => {
    const r = await simpanTintaDasar([
      { nama: ' Reflex Blue ', hex: '001D8A', kode: 'Reflex Blue C' },
      { nama: 'Putih', hex: '#FFFFFF' },
    ]);
    expect(r.ok).toBe(true);
    expect(await ambilTintaDasar()).toEqual([
      { nama: 'Reflex Blue', hex: '#001d8a', kode: 'Reflex Blue C' },
      { nama: 'Putih', hex: '#ffffff', kode: null },
    ]);
  });

  it('tidak menimpa apa pun kalau daftarnya tidak sah', async () => {
    await simpanTintaDasar([{ nama: 'Putih', hex: '#ffffff' }]);
    const r = await simpanTintaDasar([{ nama: 'Rusak', hex: 'bukan-warna' }]);
    expect(r).toEqual({ ok: false, alasan: 'HEX_TIDAK_SAH' });
    expect(await ambilTintaDasar()).toEqual([{ nama: 'Putih', hex: '#ffffff', kode: null }]);
  });
});
