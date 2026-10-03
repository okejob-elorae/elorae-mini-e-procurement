import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededId, seededIds } from '@elorae/db';
import { giroMenunggu, ingatkanGiroJatuhTempo, KATEGORI_GIRO_JATUH_TEMPO } from './giro-queries';
import { putuskanKlaim } from './writer';
import { daftarPiutang } from './queries';

/**
 * Giro terhadap basis data sungguhan.
 *
 * Dua hal yang tidak bisa dibuktikan tiruan: bahwa piutangnya BENAR-BENAR
 * belum berkurang sampai giro cair (Aturan 1 lewat kolom giro), dan bahwa
 * pengingat pagi menyaring giro yang tepat. Basis datanya dipakai bersama data
 * dev, jadi setiap kueri dilingkupi klaim yang diseed di sini dan setiap
 * penghapusan lewat `seededId()`.
 */

const tag = `GIRO-${Math.random().toString(36).slice(2, 8)}`;
/** Jauh di depan, supaya pengingat dev yang sungguhan tidak pernah jatuh di hari yang sama. */
const SEKARANG = new Date('2031-03-10T02:00:00Z'); // 09.00 WIB
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);

let tokoId = '';
let userId = '';
let piutangId = '';
let klaimLewatId = '';
let klaimHariIniId = '';
let klaimNantiId = '';
let klaimDitolakId = '';
let catatanIds: string[] = [];

async function buatGiro(akhiran: string, efektif: string, nilai: number, status: 'DIKIRIM' | 'DITOLAK' = 'DIKIRIM') {
  const k = await prisma.paymentClaim.create({
    data: {
      docNo: `${tag}/${akhiran}`,
      storeId: tokoId,
      salesmanId: userId,
      createdById: userId,
      claimedTransferAt: wib('2031-03-01'),
      method: 'giro',
      invoiceAmount: nilai,
      deductionTotal: 0,
      receivedAmount: nilai,
      transferPhotoUrl: '/api/foto/uji',
      status,
      giroNo: `BG-${akhiran}`,
      giroBank: 'BCA',
      giroIssueDate: wib('2031-03-01'),
      giroEffectiveDate: wib(efektif),
      giroStatus: 'MENUNGGU',
      ...(akhiran === 'LEWAT'
        ? { receivableLinks: { create: [{ receivableId: piutangId, settledAmount: nilai }] } }
        : {}),
    },
  });
  return k.id;
}

beforeEach(async () => {
  tokoId = '';
  userId = '';
  piutangId = '';
  klaimLewatId = '';
  klaimHariIniId = '';
  klaimNantiId = '';
  klaimDitolakId = '';
  catatanIds = [];

  const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@elorae.com' } });
  userId = admin.id;

  const toko = await prisma.store.create({
    data: { code: `${tag}-S`, name: `${tag} Toko`, address: 'uji', termsType: 'PUTUS', isActive: true },
  });
  tokoId = toko.id;

  const piutang = await prisma.receivable.create({
    data: {
      invoiceNo: `${tag}/INV`,
      storeId: tokoId,
      invoiceDate: wib('2031-02-01'),
      dueDate: wib('2031-03-01'),
      amount: 1_000_000,
      outstanding: 1_000_000,
      source: 'MANUAL',
    },
  });
  piutangId = piutang.id;

  klaimLewatId = await buatGiro('LEWAT', '2031-03-05', 1_000_000);
  klaimHariIniId = await buatGiro('HARIINI', '2031-03-10', 2_500_000);
  klaimNantiId = await buatGiro('NANTI', '2031-03-20', 700_000);
  // Klaimnya ditolak lewat jalur biasa — tidak ada lagi yang menunggu bilyet ini.
  klaimDitolakId = await buatGiro('DITOLAK', '2031-03-06', 9_000_000, 'DITOLAK');
});

afterEach(async () => {
  const klaim = [klaimLewatId, klaimHariIniId, klaimNantiId, klaimDitolakId].filter(Boolean).map(seededId);
  await prisma.adminNotification.deleteMany({ where: { id: { in: catatanIds.map(seededId) } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(klaim) } } });
  await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaim) } } });
  if (piutangId) await prisma.receivable.delete({ where: { id: seededId(piutangId) } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
});

const semuaKlaim = () => [klaimLewatId, klaimHariIniId, klaimNantiId, klaimDitolakId];

describe('giroMenunggu (basis data)', () => {
  it('hanya giro yang klaimnya masih menunggu, urut tanggal efektif', async () => {
    const baris = await giroMenunggu({ sekarang: SEKARANG, claimIds: semuaKlaim() });
    expect(baris.map((b) => b.giroNo)).toEqual(['BG-LEWAT', 'BG-HARIINI', 'BG-NANTI']);
    expect(baris.map((b) => b.kelompok)).toEqual(['LEWAT', 'HARI_INI', 'NANTI']);
  });
});

describe('ingatkanGiroJatuhTempo (basis data)', () => {
  it('satu catatan untuk yang lewat dan yang efektif hari ini, sekali sehari', async () => {
    const h = await ingatkanGiroJatuhTempo({ sekarang: SEKARANG, claimIds: semuaKlaim() });
    expect(h).toMatchObject({ dibuat: true, jumlah: 2, nilai: 3_500_000 });
    if (!h.dibuat) throw new Error('pengingat tidak dibuat');
    catatanIds.push(h.id);

    const catatan = await prisma.adminNotification.findUniqueOrThrow({ where: { id: seededId(h.id) } });
    expect(catatan.category).toBe(KATEGORI_GIRO_JATUH_TEMPO);
    // Ada yang sudah lewat tanggal efektif — itu peringatan, bukan kabar biasa.
    expect(catatan.severity).toBe('WARNING');

    // Proses web yang dimulai ulang di jam jadwalnya tidak menulis pengingat kembar.
    const lagi = await ingatkanGiroJatuhTempo({ sekarang: SEKARANG, claimIds: semuaKlaim() });
    if (lagi.dibuat) catatanIds.push(lagi.id);
    expect(lagi).toEqual({ dibuat: false, alasan: 'SUDAH_HARI_INI' });
  });

  it('diam kalau tidak ada yang mendesak', async () => {
    const h = await ingatkanGiroJatuhTempo({ sekarang: SEKARANG, claimIds: [klaimNantiId] });
    expect(h).toEqual({ dibuat: false, alasan: 'TIDAK_ADA' });
  });
});

describe('giro cair lewat pintu verifikasi (basis data)', () => {
  it('piutang TIDAK berkurang selama giro menunggu, dan berkurang begitu cair', async () => {
    const tolak = await putuskanKlaim({ paymentClaimId: klaimLewatId, keputusan: 'TERVERIFIKASI', olehUserId: userId });
    expect(tolak).toEqual({ ok: false, alasan: 'GIRO_BELUM_CAIR' });
    let [p] = await daftarPiutang({ receivableIds: [piutangId] });
    expect(p.outstanding).toBe(1_000_000);

    const cair = await putuskanKlaim({
      paymentClaimId: klaimLewatId,
      keputusan: 'TERVERIFIKASI',
      olehUserId: userId,
      giro: 'CAIR',
    });
    expect(cair.ok).toBe(true);
    [p] = await daftarPiutang({ receivableIds: [piutangId] });
    expect(p.outstanding).toBe(0);

    const klaim = await prisma.paymentClaim.findUniqueOrThrow({ where: { id: seededId(klaimLewatId) } });
    expect(klaim.giroStatus).toBe('CAIR');
    expect(klaim.giroSettledAt).not.toBeNull();
    expect(klaim.status).toBe('TERVERIFIKASI');
  });
});
