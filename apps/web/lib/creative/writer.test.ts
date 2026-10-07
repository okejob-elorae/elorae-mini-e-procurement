import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededId } from '@elorae/db';
import { buatBrief, pindahTahapKolaborasi, simpanKol } from './writer';

/**
 * Penulis creative marketing, terhadap basis data sungguhan.
 *
 * Yang diuji di sini bukan aturannya — itu sudah terbukti sebagai fungsi murni
 * — melainkan bahwa penulisnya benar-benar MEMATUHINYA saat menyentuh baris
 * nyata. Jaraknya di situ: stok yang bergerak dua kali, atau tidak bergerak
 * sama sekali, hanya kelihatan di sini.
 */

const tag = `KRE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let kolId = '';
let itemId = '';
let uomId = '';
let invId = '';
let userId = '';
let briefId = '';
let campaignId = '';

beforeEach(async () => {
  kolId = '';
  itemId = '';
  uomId = '';
  invId = '';
  userId = '';
  briefId = '';
  campaignId = '';

  const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
  userId = user.id;

  const uom = await prisma.uOM.create({
    data: { code: `${tag}-U`, nameId: 'pcs', nameEn: 'pcs' },
  });
  uomId = uom.id;

  const item = await prisma.item.create({
    data: {
      sku: `${tag}-SKU`,
      nameId: `${tag} Blus`,
      nameEn: `${tag} Blouse`,
      type: 'FINISHED_GOOD',
      uomId: uom.id,
    },
  });
  itemId = item.id;

  const inv = await prisma.inventoryValue.create({
    data: { itemId: item.id, variantSku: null, qtyOnHand: 10, avgCost: 50_000, totalValue: 500_000 },
  });
  invId = inv.id;

  const kol = await simpanKol({
    isi: {
      name: `${tag} Selebgram`,
      phone: '0812-3456-7890',
      akun: [{ platform: 'INSTAGRAM', handle: '@ujicoba', followers: 25_000 }],
    },
    olehUserId: userId,
  });
  if (!kol.ok) throw new Error('seed KOL gagal');
  kolId = kol.id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: seededId(briefId) } });
  await prisma.auditLog.deleteMany({ where: { entityId: seededId(kolId) } });
  await prisma.kolBriefItem.deleteMany({ where: { briefId: seededId(briefId) } });
  await prisma.kolBriefDeliverable.deleteMany({ where: { briefId: seededId(briefId) } });
  await prisma.kolBrief.deleteMany({ where: { id: seededId(briefId) } });
  await prisma.kolCampaign.deleteMany({ where: { id: seededId(campaignId) } });
  await prisma.kolAccount.deleteMany({ where: { kolId: seededId(kolId) } });
  await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
  await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
  await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
  await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
  await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
});

const DELIVERABLE = [{ platform: 'INSTAGRAM' as const, format: 'REELS' as const, qty: 1 }];

async function briefDenganBarang(qty = 3, tambahan: Partial<Parameters<typeof buatBrief>[0]> = {}) {
  const r = await buatBrief({
    kolId,
    fee: 2_500_000,
    deliverables: DELIVERABLE,
    barang: [{ itemId, qty }],
    olehUserId: userId,
    ...tambahan,
  });
  if (!r.ok) throw new Error(`buatBrief gagal: ${r.alasan}`);
  briefId = r.id;
  return r;
}

const stok = async () =>
  (await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } })).qtyOnHand.toNumber();

const kolaborasi = () => prisma.kolBrief.findUniqueOrThrow({ where: { id: briefId } });

describe('simpanKol', () => {
  it('menurunkan waNormal dari nomor telepon', async () => {
    const k = await prisma.kol.findUniqueOrThrow({ where: { id: kolId } });
    expect(k.waNormal).toBe('6281234567890');
  });
});

describe('buatBrief — kolaborasi baru', () => {
  it('lahir di PROSPEK tanpa menyentuh stok, dengan status bayar dari fee', async () => {
    // Rencana sampel bukan pengiriman. Stok baru bergerak saat paketnya berangkat.
    await briefDenganBarang();
    expect(await stok()).toBe(10);
    const b = await kolaborasi();
    expect(b.tahap).toBe('PROSPEK');
    expect(b.payStatus).toBe('BELUM');
    expect(b.stockIssuedAt).toBeNull();
    expect(b.dealAt).toBeNull();
  });

  it('kolaborasi barter tanpa fee tidak perlu dibayar', async () => {
    await briefDenganBarang(1, { fee: 0 });
    expect((await kolaborasi()).payStatus).toBe('TIDAK_PERLU');
  });

  it('boleh tanpa deliverable — prospek belum menugaskan apa pun', async () => {
    const r = await buatBrief({ kolId, fee: 0, olehUserId: userId });
    expect(r.ok).toBe(true);
    if (r.ok) briefId = r.id;
  });

  it('mewarisi brief campaign bila brief-nya kosong, dan mencatat tanggal deal bila lahir sesudah deal', async () => {
    campaignId = (await prisma.kolCampaign.create({ data: { name: `${tag} Lebaran`, brief: 'Tunjukkan bahan adem' } })).id;
    await briefDenganBarang(1, { campaignId, tahap: 'DEAL' });
    const b = await kolaborasi();
    expect(b.campaignId).toBe(campaignId);
    expect(b.briefText).toBe('Tunjukkan bahan adem');
    expect(b.dealAt).not.toBeNull();
    expect(b.outreachAt).not.toBeNull();
  });

  it('menolak lahir langsung di jalur keluar', async () => {
    const r = await buatBrief({ kolId, fee: 0, tahap: 'BATAL', olehUserId: userId });
    expect(r).toMatchObject({ ok: false, alasan: 'STATUS_TIDAK_VALID' });
  });

  it('memberi nomor berurutan BRIEF/YYYY/NNNN', async () => {
    const a = await briefDenganBarang();
    expect(a.ok && a.docNo).toMatch(/^BRIEF\/\d{4}\/\d{4}$/);
  });
});

describe('pindahTahapKolaborasi', () => {
  it('maju boleh melompat, dan TIDAK PERNAH menggerakkan stok', async () => {
    /*
     * Stok sampel bergerak lewat pengiriman sampel, bukan lewat tahap. Kalau
     * tahap ikut mengurangi, satu paket bisa menguras gudang dua kali.
     */
    await briefDenganBarang(3);
    for (const ke of ['DEAL', 'SAMPEL_DIKIRIM', 'TAYANG'] as const) {
      const r = await pindahTahapKolaborasi({ kolaborasiId: briefId, ke, olehUserId: userId });
      expect(r.ok).toBe(true);
    }
    expect(await stok()).toBe(10);
    expect(await prisma.stockAdjustment.count({ where: { itemId } })).toBe(0);
    const b = await kolaborasi();
    expect(b.tahap).toBe('TAYANG');
    expect(b.dealAt).not.toBeNull();
    expect(b.liveAt).not.toBeNull();
  });

  it('mundur ditolak tanpa alasan dan diterima dengan alasan', async () => {
    await briefDenganBarang();
    await pindahTahapKolaborasi({ kolaborasiId: briefId, ke: 'NEGO', olehUserId: userId });
    expect(await pindahTahapKolaborasi({ kolaborasiId: briefId, ke: 'DIHUBUNGI', olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: 'ALASAN_WAJIB',
    });
    expect(
      await pindahTahapKolaborasi({ kolaborasiId: briefId, ke: 'DIHUBUNGI', alasan: 'salah klik', olehUserId: userId }),
    ).toMatchObject({ ok: true, dari: 'NEGO', ke: 'DIHUBUNGI' });
  });

  it('keluar jalur wajib beralasan dan menyimpan alasannya; buka lagi mengosongkannya', async () => {
    await briefDenganBarang();
    expect(await pindahTahapKolaborasi({ kolaborasiId: briefId, ke: 'GHOSTING', olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: 'ALASAN_WAJIB',
    });
    await pindahTahapKolaborasi({ kolaborasiId: briefId, ke: 'GHOSTING', alasan: 'dua minggu tanpa balasan', olehUserId: userId });
    expect((await kolaborasi()).cancelReason).toBe('dua minggu tanpa balasan');

    // Dari jalur keluar hanya boleh kembali ke PROSPEK/DIHUBUNGI.
    expect(await pindahTahapKolaborasi({ kolaborasiId: briefId, ke: 'DEAL', alasan: 'x', olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: 'STATUS_TIDAK_VALID',
    });
    await pindahTahapKolaborasi({ kolaborasiId: briefId, ke: 'DIHUBUNGI', alasan: 'membalas lagi', olehUserId: userId });
    const b = await kolaborasi();
    expect(b.tahap).toBe('DIHUBUNGI');
    expect(b.cancelReason).toBeNull();
  });

  it('menulis jejak perpindahan beserta alasannya', async () => {
    await briefDenganBarang();
    await pindahTahapKolaborasi({ kolaborasiId: briefId, ke: 'BATAL', alasan: 'KOL mundur', olehUserId: userId });
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: briefId, action: 'KOL_COLLAB_STAGE_CHANGED' },
    });
    expect(jejak.reason).toBe('KOL mundur');
    expect(jejak.changes).toMatchObject({ before: { tahap: 'PROSPEK' }, after: { tahap: 'BATAL' } });
  });
});
