import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededId } from '@elorae/db';
import { muatDasbor } from './dashboard-queries';

/**
 * Beranda piutang, terhadap basis data sungguhan.
 *
 * Berkas ini ada karena satu kesalahan nyata: kartu "Tertahan retur" menulis
 * Rp 0 sementara daftar tepat di bawahnya, pada layar yang sama, menulis
 * Rp 870.000. Kartunya menjumlah dari nota retur, padahal yang menahan uang
 * adalah POTONGAN pada klaim — dan sebuah potongan bisa menunjuk nota yang
 * tidak ada lagi, yang tetap ditahan penuh tapi tak punya baris untuk dihitung.
 *
 * Tesnya menyusun ulang keadaan itu persis.
 */

const tag = `DSB-${Math.random().toString(36).slice(2, 8)}`;
let tokoId = '';
let userId = '';
let piutangId = '';
let klaimId = '';

beforeEach(async () => {
  tokoId = '';
  userId = '';
  piutangId = '';
  klaimId = '';

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
      invoiceDate: new Date('2026-08-01T00:00:00Z'),
      dueDate: new Date('2026-09-01T00:00:00Z'),
      amount: 5_000_000,
      outstanding: 5_000_000,
      source: 'MANUAL',
    },
  });
  piutangId = piutang.id;

  /*
   * Klaim TERVERIFIKASI penuh, dengan satu potongan yang menunjuk nota retur
   * yang tidak ada. Tanpa foreign key, bentuk ini benar-benar ada di basis
   * data — dan aturannya menahannya penuh.
   */
  const klaim = await prisma.paymentClaim.create({
    data: {
      docNo: `${tag}/BKM`,
      storeId: tokoId,
      salesmanId: userId,
      createdById: userId,
      claimedTransferAt: new Date('2026-08-20T00:00:00Z'),
      method: 'transfer',
      invoiceAmount: 5_000_000,
      deductionTotal: 800_000,
      receivedAmount: 4_200_000,
      transferPhotoUrl: '/api/foto/uji',
      status: 'TERVERIFIKASI',
      verifiedById: userId,
      verifiedAt: new Date(),
      receivableLinks: { create: [{ receivableId: piutangId, settledAmount: 5_000_000 }] },
      deductions: {
        create: [
          { name: 'Retur barang', amount: 800_000, storeReturnId: `${tag}-NOTA-HILANG` },
        ],
      },
    },
  });
  klaimId = klaim.id;
});

afterEach(async () => {
  await prisma.paymentClaimDeduction.deleteMany({ where: { paymentClaimId: seededId(klaimId) } });
  await prisma.paymentClaimReceivable.deleteMany({ where: { paymentClaimId: seededId(klaimId) } });
  await prisma.paymentClaim.deleteMany({ where: { id: seededId(klaimId) } });
  await prisma.receivable.deleteMany({ where: { id: seededId(piutangId) } });
  await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
});

describe('muatDasbor (basis data)', () => {
  it('MENGHITUNG nilai tertahan dari potongan yang notanya sudah tidak ada', async () => {
    // Inilah kesalahan yang sesungguhnya. Menjumlah dari nota retur membuat
    // kartu ini menulis nol sementara halaman piutang menulis 800.000 untuk
    // faktur yang sama.
    const d = await muatDasbor();
    expect(d.tertahanRetur).toBeGreaterThanOrEqual(800_000);
  });

  it('menyebut angka yang SAMA dengan daftar tindakan di bawahnya', async () => {
    // Satu layar tidak boleh menyebut dua angka untuk hal yang sama.
    const d = await muatDasbor();
    const baris = d.tindakan.find((t) => t.judul === `${tag}/INV`);
    expect(baris?.jenis).toBe('tertahan');
    expect(baris?.nilai).toBe(800_000);
  });

  it('memasukkan piutangnya ke keadaan tertahan, bukan lunas', async () => {
    // Klaimnya terverifikasi PENUH. Tanpa aturan retur, faktur ini akan
    // terbaca lunas dan hilang dari tagihan — 800.000 lenyap.
    const d = await muatDasbor();
    const tertahan = d.perKeadaan.find((k) => k.keadaan === 'tertahan');
    expect(tertahan?.jumlah).toBeGreaterThanOrEqual(1);
  });

  it('kartu Tertahan retur menyebut angka yang sama dengan daftar ?keadaan=tertahan yang ditautnya', async () => {
    const d = await muatDasbor();
    const tertahan = d.perKeadaan.find((k) => k.keadaan === 'tertahan');
    expect(d.fakturTertahan).toBe(tertahan?.jumlah);
    expect(d.fakturTertahan).toBeGreaterThanOrEqual(1);
    // Jumlah retur yang perlu dikerjakan adalah ukuran tersendiri, dirinci per langkah.
    const l = d.returPerLangkah;
    expect(l.cek + l.jodoh + l.keputusan).toBe(d.returPerluDikerjakan);
  });

  it('tidak lagi memuat ukuran penyimpanan foto', async () => {
    const d = await muatDasbor();
    expect('foto' in d).toBe(false);
  });

  it('mengurutkan daftar tindakan dari yang paling berisiko', async () => {
    const d = await muatDasbor();
    const risiko = d.tindakan.map((t) => t.risiko);
    expect([...risiko].sort((a, b) => b - a)).toEqual(risiko);
  });
});
