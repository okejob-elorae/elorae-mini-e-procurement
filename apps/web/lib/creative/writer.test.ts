import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededId } from '@elorae/db';
import { buatBrief, pindahStatusBrief, simpanKol } from './writer';

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

beforeEach(async () => {
  kolId = '';
  itemId = '';
  uomId = '';
  invId = '';
  userId = '';
  briefId = '';

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
  await prisma.kolAccount.deleteMany({ where: { kolId: seededId(kolId) } });
  await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
  await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
  await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
  await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
  await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
});

const DELIVERABLE = [{ platform: 'INSTAGRAM' as const, format: 'REELS' as const, qty: 1 }];

async function briefDenganBarang(qty = 3) {
  const r = await buatBrief({
    kolId,
    campaign: `${tag} Kampanye`,
    fee: 2_500_000,
    deliverables: DELIVERABLE,
    barang: [{ itemId, qty }],
    olehUserId: userId,
  });
  if (!r.ok) throw new Error(`buatBrief gagal: ${r.alasan}`);
  briefId = r.id;
  return r;
}

const stok = async () =>
  (await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } })).qtyOnHand.toNumber();

describe('buatBrief', () => {
  it('TIDAK menyentuh stok saat brief masih draft', async () => {
    // Draft masih boleh berubah isinya. Stok tidak boleh bergerak karena rencana.
    await briefDenganBarang();
    expect(await stok()).toBe(10);
    const b = await prisma.kolBrief.findUniqueOrThrow({ where: { id: briefId } });
    expect(b.status).toBe('DRAFT');
    expect(b.stockIssuedAt).toBeNull();
  });

  it('menolak brief tanpa deliverable', async () => {
    // Brief tanpa deliverable tidak menugaskan apa pun; ia cuma catatan.
    const r = await buatBrief({
      kolId,
      campaign: `${tag} Kosong`,
      fee: 0,
      deliverables: [],
      olehUserId: userId,
    });
    expect(r).toMatchObject({ ok: false, alasan: 'TANPA_DELIVERABLE' });
  });

  it('memberi nomor berurutan', async () => {
    const a = await briefDenganBarang();
    expect(a.ok && a.docNo).toMatch(/^BRIEF\/\d{4}\/\d{4}$/);
  });
});

describe('pindahStatusBrief — pengeluaran stok', () => {
  it('mengeluarkan stok TEPAT SEKALI saat dikirim', async () => {
    await briefDenganBarang(3);
    const r = await pindahStatusBrief({ briefId, ke: 'DIKIRIM', olehUserId: userId });
    expect(r).toMatchObject({ ok: true, stokKeluar: 3 });
    expect(await stok()).toBe(7);
  });

  it('TIDAK mengeluarkan stok lagi pada tahap-tahap berikutnya', async () => {
    /*
     * Kalau setiap tahap ikut mengurangi, satu brief menguras gudang lima kali
     * untuk satu paket yang sama — dan tidak ada yang menyadarinya sampai opname.
     */
    await briefDenganBarang(3);
    await pindahStatusBrief({ briefId, ke: 'DIKIRIM', olehUserId: userId });
    for (const ke of ['DISETUJUI', 'KONTEN_DITERIMA', 'TAYANG'] as const) {
      const r = await pindahStatusBrief({ briefId, ke, olehUserId: userId });
      expect(r).toMatchObject({ ok: true, stokKeluar: 0 });
    }
    expect(await stok()).toBe(7);
  });

  it('menulis kartu stok yang menyebut ke mana barangnya pergi', async () => {
    // Tanpa ini, gudang cuma melihat stok berkurang tanpa sebab.
    await briefDenganBarang(2);
    await pindahStatusBrief({ briefId, ke: 'DIKIRIM', olehUserId: userId });
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { itemId } });
    expect(adj.source).toBe('KOL_SEEDING');
    expect(adj.qtyChange.toNumber()).toBe(-2);
    expect(adj.reason).toContain('Seeding KOL');
    expect(adj.reason).toContain(tag);
  });

  it('MENOLAK pengiriman saat stoknya kurang, tanpa menyentuh apa pun', async () => {
    // Barang yang tidak ada tidak bisa dikirim, dan gudang minus tidak pernah
    // bisa dijelaskan siapa pun.
    await briefDenganBarang(99);
    const r = await pindahStatusBrief({ briefId, ke: 'DIKIRIM', olehUserId: userId });
    expect(r).toMatchObject({ ok: false, alasan: 'STOK_KURANG' });
    expect(await stok()).toBe(10);
    const b = await prisma.kolBrief.findUniqueOrThrow({ where: { id: briefId } });
    expect(b.status).toBe('DRAFT');
  });
});

describe('pindahStatusBrief — perpindahan', () => {
  it('menolak lompatan yang melewati tahap', async () => {
    await briefDenganBarang();
    const r = await pindahStatusBrief({ briefId, ke: 'TAYANG', olehUserId: userId });
    expect(r).toMatchObject({ ok: false, alasan: 'STATUS_TIDAK_VALID' });
    expect(await stok()).toBe(10);
  });

  it('menolak pembatalan tanpa alasan', async () => {
    await briefDenganBarang();
    const r = await pindahStatusBrief({ briefId, ke: 'BATAL', olehUserId: userId });
    expect(r).toMatchObject({ ok: false, alasan: 'ALASAN_WAJIB' });
  });

  it('TIDAK mengembalikan stok saat brief dibatalkan setelah barangnya berangkat', async () => {
    /*
     * Pembatalan adalah keputusan di atas kertas, bukan kurir yang berbalik
     * arah. Barangnya sudah di tangan KOL; mengembalikan stoknya membuat gudang
     * mengaku punya barang yang tidak ada.
     */
    await briefDenganBarang(3);
    await pindahStatusBrief({ briefId, ke: 'DIKIRIM', olehUserId: userId });
    const r = await pindahStatusBrief({
      briefId,
      ke: 'BATAL',
      alasan: 'KOL mundur setelah paket dikirim',
      olehUserId: userId,
    });
    expect(r.ok).toBe(true);
    expect(await stok()).toBe(7);
  });

  it('mencatat di jejaknya bahwa barangnya sudah berangkat saat dibatalkan', async () => {
    // Supaya pembatalan setelah pengiriman bisa dibaca sebagai kehilangan
    // barang, bukan sekadar brief yang batal.
    await briefDenganBarang(3);
    await pindahStatusBrief({ briefId, ke: 'DIKIRIM', olehUserId: userId });
    await pindahStatusBrief({ briefId, ke: 'BATAL', alasan: 'mundur', olehUserId: userId });
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: briefId, action: 'KOL_BRIEF_CANCELLED' },
    });
    expect((jejak.metadata as { barangSudahBerangkat: boolean }).barangSudahBerangkat).toBe(true);
  });
});
