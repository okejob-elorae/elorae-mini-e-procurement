import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededId, seededIds } from '@elorae/db';
import { rincianKontrabon } from './collection-queries';
import { daftarPiutang } from './queries';

/**
 * Rincian kontrabon & daftar piutang, terhadap basis data sungguhan.
 *
 * - Kartu "Pelunasan atas kontrabon ini" dulu kosong walau faktur di TT itu
 *   sudah dilaporkan bayar lewat BKM — kartunya hanya membaca BKM yang menunjuk
 *   TT-nya langsung.
 * - Daftar piutang dulu memberi faktur lewat jatuh tempo tanpa kontrabon label
 *   "tidak ada tunggakan".
 *
 * Penghapusan lewat `seededId()`: basis data dipakai bersama data dev.
 */

const tag = `KBK-${Math.random().toString(36).slice(2, 8)}`;
let tokoId = '';
let piutangId = '';
let piutangTempoId = '';
let ttId = '';
let klaimIds: string[] = [];

beforeEach(async () => {
  tokoId = '';
  piutangId = '';
  piutangTempoId = '';
  ttId = '';
  klaimIds = [];

  const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@elorae.com' } });
  const toko = await prisma.store.create({
    data: { code: `${tag}-S`, name: `${tag} Toko`, address: 'uji', termsType: 'PUTUS', isActive: true },
  });
  tokoId = toko.id;

  const p = await prisma.receivable.create({
    data: {
      invoiceNo: `${tag}/INV`,
      storeId: tokoId,
      invoiceDate: new Date('2026-08-01T00:00:00+07:00'),
      dueDate: new Date('2099-09-01T00:00:00+07:00'),
      amount: 9_400_000,
      outstanding: 9_400_000,
      source: 'MANUAL',
    },
  });
  piutangId = p.id;

  // Jatuh tempo 20 Sep 2026, tanpa kontrabon, tanpa klaim.
  const lewat = await prisma.receivable.create({
    data: {
      invoiceNo: `${tag}/TEMPO`,
      storeId: tokoId,
      invoiceDate: new Date('2026-08-20T00:00:00+07:00'),
      dueDate: new Date('2026-09-20T00:00:00+07:00'),
      amount: 1_250_000,
      outstanding: 1_250_000,
      source: 'IMPORT',
    },
  });
  piutangTempoId = lewat.id;

  const tt = await prisma.collectionNote.create({
    data: {
      docNo: `${tag}/TT`,
      storeId: tokoId,
      salesmanId: admin.id,
      handoverDate: new Date('2026-08-05T00:00:00+07:00'),
      promisedDate: new Date('2099-08-20T00:00:00+07:00'),
      amount: 9_400_000,
      receivableLinks: { create: [{ receivableId: piutangId, amount: 9_400_000 }] },
    },
  });
  ttId = tt.id;

  const klaim = (docNo: string, status: 'DIKIRIM' | 'DIBATALKAN', collectionNoteId: string | null) =>
    prisma.paymentClaim.create({
      data: {
        docNo,
        storeId: tokoId,
        salesmanId: admin.id,
        createdById: admin.id,
        collectionNoteId,
        claimedTransferAt: new Date('2026-08-20T00:00:00+07:00'),
        invoiceAmount: 8_530_000,
        receivedAmount: 8_530_000,
        transferPhotoUrl: '/api/foto/uji',
        status,
        receivableLinks: { create: [{ receivableId: piutangId, settledAmount: 8_530_000 }] },
      },
    });
  klaimIds = [
    (await klaim(`${tag}/BKM-TT`, 'DIKIRIM', ttId)).id,
    (await klaim(`${tag}/BKM-LEPAS`, 'DIKIRIM', null)).id,
    (await klaim(`${tag}/BKM-BATAL`, 'DIBATALKAN', null)).id,
  ];
});

afterEach(async () => {
  await prisma.paymentClaimReceivable.deleteMany({ where: { paymentClaimId: { in: seededIds(klaimIds) } } });
  await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds) } } });
  await prisma.collectionNoteReceivable.deleteMany({ where: { collectionNoteId: seededId(ttId) } });
  await prisma.collectionNote.deleteMany({ where: { id: seededId(ttId) } });
  await prisma.receivable.deleteMany({ where: { id: { in: seededIds([piutangId, piutangTempoId]) } } });
  await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
});

describe('rincianKontrabon (basis data)', () => {
  it('menampilkan BKM yang melunasi faktur di TT walau tidak menunjuk TT-nya, dengan tanda', async () => {
    const r = await rincianKontrabon(ttId);
    const peta = new Map(r!.klaim.map((k) => [k.docNo, k.tertautTt]));
    expect(peta.get(`${tag}/BKM-TT`)).toBe(true);
    expect(peta.get(`${tag}/BKM-LEPAS`)).toBe(false);
    // Yang dibatalkan adalah salah catat, bukan pelunasan.
    expect(peta.has(`${tag}/BKM-BATAL`)).toBe(false);
    expect(r!.klaim.filter((k) => k.docNo === `${tag}/BKM-TT`)).toHaveLength(1);
  });
});

describe('daftarPiutang (basis data)', () => {
  it('menandai faktur lewat jatuh tempo tanpa kontrabon dan menyebut semua BKM yang menunggu', async () => {
    const baris = await daftarPiutang({ storeId: tokoId });
    const tempo = baris.find((b) => b.id === piutangTempoId);
    expect(tempo?.keadaan).toBe('belum');
    expect(tempo?.keadaanTampil).toBe('jatuh_tempo');
    expect(tempo?.alasan.hariLewatJatuhTempo).toBeGreaterThanOrEqual(16);

    const diklaim = baris.find((b) => b.id === piutangId);
    expect(diklaim?.keadaanTampil).toBe('klaim');
    expect(diklaim?.alasan.klaimMenunggu?.sort()).toEqual([`${tag}/BKM-LEPAS`, `${tag}/BKM-TT`]);
    expect(diklaim?.alasan.pelaporKlaim).toBeTruthy();
  });
});
