import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededId } from '@elorae/db';
import { daftarSiklus, rincianSiklus } from './queries';

/**
 * Kueri siklus konsinyasi, terhadap basis data sungguhan.
 *
 * Yang diuji di sini adalah penurunan TAHAP dari baris nyata. Aturannya sudah
 * terbukti sebagai fungsi murni; yang belum terbukti adalah bahwa kuerinya
 * memberi bahan yang benar kepada aturan itu — dan di situlah jaraknya.
 */

const tag = `KNS-${Math.random().toString(36).slice(2, 8)}`;
let tokoId = '';
let siklusId = '';
let orangId = '';
let bebanId = '';

beforeEach(async () => {
  tokoId = '';
  siklusId = '';
  orangId = '';
  bebanId = '';

  const toko = await prisma.store.create({
    data: { code: `${tag}-S`, name: `${tag} Konsi`, address: 'uji', termsType: 'KONSI', isActive: true },
  });
  tokoId = toko.id;

  const siklus = await prisma.consignmentCycle.create({
    data: { noKonsi: `${tag}/K`, storeId: tokoId, periodYear: 2026, periodMonth: 7 },
  });
  siklusId = siklus.id;
});

afterEach(async () => {
  await prisma.returnCharge.deleteMany({ where: { id: seededId(bebanId) } });
  await prisma.consignmentReportItem.deleteMany({
    where: { report: { cycleId: seededId(siklusId) } },
  });
  await prisma.consignmentReport.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCommission.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklusId) } });
  await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
  await prisma.user.deleteMany({ where: { id: seededId(orangId) } });
});

async function laporan(source: 'SPG' | 'TOKO') {
  await prisma.consignmentReport.create({
    data: {
      cycleId: siklusId,
      source,
      reportedAt: new Date(),
      items: { create: [{ itemName: 'Blus', qty: source === 'SPG' ? 5 : 4 }] },
    },
  });
}

describe('daftarSiklus (basis data)', () => {
  it('siklus baru berada di tahap laporan', async () => {
    const baris = await daftarSiklus();
    expect(baris.find((b) => b.noKonsi === `${tag}/K`)?.tahap).toBe('laporan');
  });

  it('tetap di tahap laporan kalau baru satu laporan yang masuk', async () => {
    // Satu laporan tidak bisa dibandingkan dengan apa pun.
    await laporan('SPG');
    const baris = await daftarSiklus();
    expect(baris.find((b) => b.noKonsi === `${tag}/K`)?.tahap).toBe('laporan');
  });

  it('maju ke cocok setelah dua laporan masuk', async () => {
    await laporan('SPG');
    await laporan('TOKO');
    const baris = await daftarSiklus();
    const b = baris.find((x) => x.noKonsi === `${tag}/K`);
    expect(b?.tahap).toBe('cocok');
    expect(b?.giliran).toBe('admin_konsi');
  });

  it('MELEWATI tahap gaji kalau tokonya tidak punya SPG', async () => {
    // Tanpa ini siklus toko tanpa SPG menggantung selamanya dan tidak pernah
    // sampai ke nota maupun faktur pajak.
    await laporan('SPG');
    await laporan('TOKO');
    await prisma.consignmentCycle.update({
      where: { id: siklusId },
      data: { lockedAt: new Date() },
    });
    const baris = await daftarSiklus();
    expect(baris.find((b) => b.noKonsi === `${tag}/K`)?.tahap).toBe('nota');
  });
});

describe('rincianSiklus (basis data)', () => {
  it('menyandingkan dua laporan menurut nama barang dan menandai selisihnya', async () => {
    await laporan('SPG');
    await laporan('TOKO');
    const d = await rincianSiklus(siklusId);
    const blus = d?.banding.find((x) => x.itemName === 'Blus');
    expect(blus).toMatchObject({ qtySpg: 5, qtyToko: 4, selisih: 1 });
  });

  it('menandai barang yang hanya ada di satu laporan sebagai sepihak', async () => {
    await laporan('SPG');
    const d = await rincianSiklus(siklusId);
    expect(d?.banding[0]).toMatchObject({ qtySpg: 5, qtyToko: null, selisih: null });
  });

  it('mengembalikan null untuk siklus yang tidak ada', async () => {
    expect(await rincianSiklus('tidak-ada')).toBeNull();
  });
});

describe('beban yang ditanggung penerima komisi', () => {
  /**
   * Beban selisih retur yang ditanggung seseorang tidak pernah terlihat saat
   * komisinya dibayar — dua layar yang tidak pernah dibuka bersamaan. Brief
   * bilang "BISA dipotong dari komisi", jadi yang dibangun adalah kabarnya,
   * bukan pemotongan otomatisnya.
   */
  async function siapkanOrangBerbeban(nilai: number, status: 'TERBUKA' | 'LUNAS') {
    const orang = await prisma.user.create({
      data: { email: `${tag}@uji.local`, name: `${tag} SPG`, passwordHash: 'x' },
    });
    orangId = orang.id;
    await prisma.consignmentCommission.create({
      data: { cycleId: siklusId, spgUserId: orang.id, baseSalary: 500_000, commission: 0, total: 500_000 },
    });
    const beban = await prisma.returnCharge.create({
      data: { storeId: tokoId, amount: nilai, bearer: 'SALES', bearerUserId: orang.id, status },
    });
    bebanId = beban.id;
  }

  it('melaporkan beban terbuka orang itu di baris komisinya', async () => {
    await siapkanOrangBerbeban(75_000, 'TERBUKA');
    const r = await rincianSiklus(siklusId);
    expect(r!.komisi[0].bebanTerbuka).toBe(75_000);
  });

  it('TIDAK menghitung beban yang sudah lunas', async () => {
    // Yang sudah dibayar tidak boleh muncul lagi sebagai peringatan.
    await siapkanOrangBerbeban(75_000, 'LUNAS');
    const r = await rincianSiklus(siklusId);
    expect(r!.komisi[0].bebanTerbuka).toBe(0);
  });

  it('TIDAK mengurangi totalnya — keputusannya milik admin', async () => {
    await siapkanOrangBerbeban(75_000, 'TERBUKA');
    const r = await rincianSiklus(siklusId);
    expect(r!.komisi[0].total).toBe(500_000);
  });
});
