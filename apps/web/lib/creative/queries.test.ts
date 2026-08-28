import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededId } from '@elorae/db';
import { buatBrief, pindahStatusBrief, simpanKol, simpanKonten } from './writer';
import { daftarBrief, daftarKol, daftarKonten, ringkasKreatif } from './queries';

/**
 * Kueri creative marketing, terhadap basis data sungguhan.
 *
 * Aturannya sudah terbukti sebagai fungsi murni, dan penulisnya sudah terbukti
 * mematuhinya. Yang belum terbukti adalah bahwa PEMBACANYA menerapkan aturan
 * yang sama — dan di situlah jaraknya: sebuah layar yang menjumlahkan fee yang
 * belum tayang akan terlihat wajar sampai ada yang membandingkannya dengan
 * rekening.
 */

const tag = `KRQ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let kolId = '';
let briefId = '';
let kontenId = '';
let itemId = '';
let uomId = '';
let invId = '';
let userId = '';

beforeEach(async () => {
  kolId = '';
  briefId = '';
  kontenId = '';
  itemId = '';
  uomId = '';
  invId = '';
  userId = '';

  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;

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
      niche: 'fashion',
      akun: [
        { platform: 'INSTAGRAM', handle: '@uji', followers: 128_000 },
        { platform: 'TIKTOK', handle: 'uji', followers: 41_000 },
      ],
    },
    olehUserId: userId,
  });
  if (!kol.ok) throw new Error('seed KOL gagal');
  kolId = kol.id;

  const brief = await buatBrief({
    kolId,
    campaign: `${tag} Launching`,
    fee: 3_000_000,
    deliverables: [
      { platform: 'INSTAGRAM', format: 'REELS', qty: 2 },
      { platform: 'TIKTOK', format: 'VIDEO', qty: 1 },
    ],
    barang: [{ itemId, qty: 2 }],
    olehUserId: userId,
  });
  if (!brief.ok) throw new Error('seed brief gagal');
  briefId = brief.id;

  const konten = await simpanKonten({
    isi: {
      title: `${tag} Reels hari 1`,
      platform: 'INSTAGRAM',
      format: 'REELS',
      status: 'DIJADWALKAN',
      // Sengaja di masa lalu: baris ini juga menguji penandaan keterlambatan.
      scheduledAt: new Date('2026-01-05T00:00:00Z'),
      briefId,
    },
    olehUserId: userId,
  });
  if (!konten.ok) throw new Error('seed konten gagal');
  kontenId = konten.id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: seededId(kontenId) } });
  await prisma.auditLog.deleteMany({ where: { entityId: seededId(briefId) } });
  await prisma.auditLog.deleteMany({ where: { entityId: seededId(kolId) } });
  await prisma.contentPlan.deleteMany({ where: { id: seededId(kontenId) } });
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

const briefSaya = async () => (await daftarBrief()).find((b) => b.id === briefId)!;

describe('daftarKol', () => {
  it('MENGHITUNG tier dari pengikut terbanyak, bukan menjumlahkan platform', async () => {
    // 128rb + 41rb = 169rb akan salah membaca orang yang sama sebagai dua orang.
    const k = (await daftarKol()).find((x) => x.id === kolId)!;
    expect(k.tier).toBe('makro');
    expect(k.akun).toHaveLength(2);
  });

  it('menghitung berapa brief yang pernah ditugaskan padanya', async () => {
    const k = (await daftarKol()).find((x) => x.id === kolId)!;
    expect(k.jumlahBrief).toBe(1);
  });

  it('menyaring menurut kata pencarian, termasuk handle akunnya', async () => {
    const hasil = await daftarKol({ cari: tag });
    expect(hasil.map((k) => k.id)).toContain(kolId);
  });
});

describe('daftarBrief — Aturan 1 diterapkan di KUERI', () => {
  it('melaporkan beban NOL selama kontennya belum tayang', async () => {
    /*
     * Diterapkan di kueri, bukan di layar: setiap pembaca daftar ini mendapat
     * angka yang sama tanpa harus mengingat aturannya. Kalau tiap layar
     * menghitung sendiri, cukup satu yang lupa untuk melaporkan pengeluaran
     * yang belum terjadi.
     */
    const b = await briefSaya();
    expect(b.fee).toBe(3_000_000);
    expect(b.bebanDiakui).toBe(0);
  });

  it('mengakui bebannya begitu brief tayang', async () => {
    for (const ke of ['DIKIRIM', 'DISETUJUI', 'KONTEN_DITERIMA', 'TAYANG'] as const) {
      await pindahStatusBrief({ briefId, ke, olehUserId: userId });
    }
    expect((await briefSaya()).bebanDiakui).toBe(3_000_000);
  });

  it('menjumlahkan deliverable, bukan menghitung barisnya', async () => {
    // Dua reels + satu video = tiga konten, bukan dua baris.
    expect((await briefSaya()).jumlahDeliverable).toBe(3);
  });

  it('melaporkan barang belum berangkat selama masih draft', async () => {
    const b = await briefSaya();
    expect(b.jumlahBarang).toBe(2);
    expect(b.barangSudahBerangkat).toBe(false);
  });

  it('melaporkan barang sudah berangkat setelah dikirim', async () => {
    await pindahStatusBrief({ briefId, ke: 'DIKIRIM', olehUserId: userId });
    expect((await briefSaya()).barangSudahBerangkat).toBe(true);
  });
});

describe('daftarKonten', () => {
  it('menandai konten yang lewat jadwal dan belum tayang', async () => {
    const k = (await daftarKonten()).find((x) => x.id === kontenId)!;
    expect(k.terlambat).toBe(true);
    expect(k.briefDocNo).toMatch(/^BRIEF\//);
  });

  it('BERHENTI menandai terlambat begitu kontennya tayang', async () => {
    // Tanggalnya tetap lewat, tapi pekerjaannya selesai.
    await simpanKonten({
      id: kontenId,
      isi: { title: `${tag} Reels hari 1`, platform: 'INSTAGRAM', format: 'REELS', status: 'TAYANG' },
      olehUserId: userId,
    });
    const k = (await daftarKonten()).find((x) => x.id === kontenId)!;
    expect(k.terlambat).toBe(false);
  });
});

describe('ringkasKreatif', () => {
  it('MEMISAHKAN beban yang diakui dari fee yang baru dijanjikan', async () => {
    /*
     * Kalau keduanya dijumlahkan jadi satu "total anggaran", marketing terbaca
     * sudah menghabiskan uang yang belum keluar — persis kesalahan yang
     * Aturan 1 ada untuk mencegah.
     */
    const awal = await ringkasKreatif();
    expect(awal.feeBelumDiakui).toBeGreaterThanOrEqual(3_000_000);

    for (const ke of ['DIKIRIM', 'DISETUJUI', 'KONTEN_DITERIMA', 'TAYANG'] as const) {
      await pindahStatusBrief({ briefId, ke, olehUserId: userId });
    }
    const akhir = await ringkasKreatif();
    // Angkanya BERPINDAH sisi, bukan bertambah di kedua sisi.
    expect(akhir.bebanDiakui - awal.bebanDiakui).toBe(3_000_000);
    expect(awal.feeBelumDiakui - akhir.feeBelumDiakui).toBe(3_000_000);
  });

  it('tidak menghitung fee brief yang dibatalkan sebagai janji apa pun', async () => {
    const awal = await ringkasKreatif();
    await pindahStatusBrief({ briefId, ke: 'BATAL', alasan: 'KOL mundur', olehUserId: userId });
    const akhir = await ringkasKreatif();
    expect(awal.feeBelumDiakui - akhir.feeBelumDiakui).toBe(3_000_000);
    expect(akhir.bebanDiakui).toBe(awal.bebanDiakui);
  });
});
