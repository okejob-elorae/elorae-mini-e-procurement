import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededId } from '@elorae/db';
import { KUNCI_PEMETAAN_WARNA } from './pemetaan-warna';
import { ambilPemetaanWarna, ambilPenjualanWarna } from './queries';
import { simpanPemetaanWarna } from './writer';

/**
 * Warna laris dan pemetaan nama warna terhadap basis data sungguhan.
 * Baris penjualan memakai nama warna bertanda unik dan dihapus lewat id-nya;
 * pengaturan pemetaan dipotret dan dikembalikan.
 */
const tag = `ZZWL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const HARI = 24 * 60 * 60 * 1000;
const SEKARANG = new Date('2026-09-18T05:00:00.000Z');
let dibuat: string[] = [];
let semula: string | null = null;

beforeAll(async () => {
  const baris = await prisma.systemSetting.findUnique({ where: { key: KUNCI_PEMETAAN_WARNA } });
  semula = baris?.value ?? null;
});

afterAll(async () => {
  if (semula === null) await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_PEMETAAN_WARNA) } });
  else await prisma.systemSetting.update({ where: { key: KUNCI_PEMETAAN_WARNA }, data: { value: semula } });
});

beforeEach(() => {
  dibuat = [];
});

afterEach(async () => {
  for (const id of dibuat) await prisma.salesHistory.delete({ where: { id: seededId(id) } });
});

async function jual(warna: string, kategori: string, qty: number, hariLalu: number, status: 'COMPLETED' | 'CANCELLED' = 'COMPLETED') {
  const b = await prisma.salesHistory.create({
    data: {
      channel: 'OTHER',
      orderId: `${tag}-${dibuat.length}`,
      orderStatus: status,
      variantSku: `${tag}-SKU`,
      parentSku: `${tag}`,
      productName: `Uji ${tag}`,
      color: warna,
      productCategory: kategori,
      quantity: qty,
      netQuantity: qty,
      unitPrice: 100000,
      unitPriceAfterDiscount: 100000,
      lineTotal: 100000 * qty,
      orderTotal: 100000 * qty,
      orderDate: new Date(SEKARANG.getTime() - hariLalu * HARI),
    },
  });
  dibuat.push(b.id);
}

describe('ambilPenjualanWarna', () => {
  it('menjumlahkan per nama warna dan kategori, memisahkan 90 hari terakhir dari 90 hari sebelumnya', async () => {
    await jual(`${tag} Hitam`, `${tag}-Kaos`, 5, 10);
    await jual(`${tag} Hitam`, `${tag}-Kaos`, 3, 40);
    await jual(`${tag} Hitam`, `${tag}-Kaos`, 7, 120);
    await jual(`${tag} Hitam`, `${tag}-Hoodie`, 2, 5);
    // Di luar dua jendela, dan pesanan batal: tidak dihitung.
    await jual(`${tag} Hitam`, `${tag}-Kaos`, 50, 200);
    await jual(`${tag} Hitam`, `${tag}-Kaos`, 50, 3, 'CANCELLED');

    const baris = (await ambilPenjualanWarna(SEKARANG)).filter((b) => b.nama?.startsWith(tag));
    const urut = baris.sort((a, b) => (a.kategori ?? '').localeCompare(b.kategori ?? ''));
    expect(urut).toEqual([
      { nama: `${tag} Hitam`, kategori: `${tag}-Hoodie`, kini: 2, lalu: 0 },
      { nama: `${tag} Hitam`, kategori: `${tag}-Kaos`, kini: 8, lalu: 7 },
    ]);
  });
});

describe('pemetaan warna', () => {
  it('menyimpan, mengganti, dan menghapus satu nama tanpa menghapus yang lain', async () => {
    const a = await simpanPemetaanWarna(`${tag} Galaxy`, '#2B2F4A');
    expect(a.ok).toBe(true);
    await simpanPemetaanWarna(`${tag} Nebula`, '#445566');
    const peta = await ambilPemetaanWarna();
    expect(peta[`${tag.toLowerCase()} galaxy`]).toBe('#2b2f4a');
    expect(peta[`${tag.toLowerCase()} nebula`]).toBe('#445566');

    await simpanPemetaanWarna(`${tag} Galaxy`, null);
    const sesudah = await ambilPemetaanWarna();
    expect(sesudah[`${tag.toLowerCase()} galaxy`]).toBeUndefined();
    expect(sesudah[`${tag.toLowerCase()} nebula`]).toBe('#445566');
  });

  it('tidak menulis apa pun kalau hex tidak sah', async () => {
    const sebelum = await ambilPemetaanWarna();
    expect(await simpanPemetaanWarna(`${tag} Rusak`, 'ungu')).toEqual({ ok: false, alasan: 'HEX_TIDAK_SAH' });
    expect(await ambilPemetaanWarna()).toEqual(sebelum);
  });
});
