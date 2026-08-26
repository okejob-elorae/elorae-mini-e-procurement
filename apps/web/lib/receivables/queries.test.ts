import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seededId } from '@elorae/db';
import { daftarPiutang } from './queries';

/**
 * Kueri piutang, terhadap basis data sungguhan.
 *
 * Ada berkas terpisah dari tes aturan karena yang diuji berbeda: aturannya
 * sudah terbukti benar sebagai fungsi murni, sedangkan yang salah dua kali
 * minggu ini justru KUERI-nya — kartu yang menyebut angka berbeda dari daftar
 * di bawahnya, dan salinan aturan yang tertinggal di satu halaman. Keduanya
 * lolos type-check dan lolos seluruh tes murni.
 *
 * Basis data dipakai bersama dengan data dev, jadi setiap penghapusan lewat
 * `seededId()`. Menulis `deleteMany({ where: { storeId } })` dengan id yang
 * belum terisi akan menghapus SELURUH TABEL.
 */

const tag = `QRY-${Math.random().toString(36).slice(2, 8)}`;
let tokoPutusId = '';
let tokoKonsiId = '';
let piutangPutusId = '';
let piutangKonsiId = '';

beforeEach(async () => {
  tokoPutusId = '';
  tokoKonsiId = '';
  piutangPutusId = '';
  piutangKonsiId = '';

  const putus = await prisma.store.create({
    data: {
      code: `${tag}-P`,
      name: `${tag} Putus`,
      address: 'uji',
      termsType: 'PUTUS',
      isActive: true,
    },
  });
  tokoPutusId = putus.id;

  const konsi = await prisma.store.create({
    data: {
      code: `${tag}-K`,
      name: `${tag} Konsi`,
      address: 'uji',
      termsType: 'KONSI',
      isActive: true,
    },
  });
  tokoKonsiId = konsi.id;

  const p1 = await prisma.receivable.create({
    data: {
      invoiceNo: `${tag}/PUTUS`,
      storeId: tokoPutusId,
      invoiceDate: new Date('2026-08-01T00:00:00Z'),
      dueDate: new Date('2026-09-01T00:00:00Z'),
      amount: 5_000_000,
      // Kolom sengaja diisi ANGKA PALSU. Kalau kuerinya membaca kolom ini
      // alih-alih menghitung ulang, tesnya gagal — dan itu memang maunya.
      outstanding: 999,
      source: 'MANUAL',
    },
  });
  piutangPutusId = p1.id;

  const p2 = await prisma.receivable.create({
    data: {
      invoiceNo: `${tag}/KONSI`,
      storeId: tokoKonsiId,
      invoiceDate: new Date('2026-08-01T00:00:00Z'),
      dueDate: new Date('2026-09-01T00:00:00Z'),
      amount: 7_000_000,
      outstanding: 7_000_000,
      source: 'MANUAL',
    },
  });
  piutangKonsiId = p2.id;
});

afterEach(async () => {
  await prisma.receivable.deleteMany({
    where: { id: { in: [piutangPutusId, piutangKonsiId].filter(Boolean).map(seededId) } },
  });
  await prisma.store.deleteMany({
    where: { id: { in: [tokoPutusId, tokoKonsiId].filter(Boolean).map(seededId) } },
  });
});

describe('daftarPiutang (basis data)', () => {
  it('TIDAK PERNAH menampilkan piutang toko konsinyasi', async () => {
    // Barang di toko konsi masih milik kita sampai terjual. Menagihnya berarti
    // menagih barang yang belum laku, dan angkanya menaikkan total perusahaan.
    const baris = await daftarPiutang();
    expect(baris.some((b) => b.invoiceNo === `${tag}/KONSI`)).toBe(false);
    expect(baris.some((b) => b.invoiceNo === `${tag}/PUTUS`)).toBe(true);
  });

  it('MENGABAIKAN kolom outstanding dan menghitung ulang dari klaim', async () => {
    // Kolomnya diisi 999 saat seed. Kalau kuerinya membacanya, angka inilah
    // yang muncul — dan itu persis cara sebuah tagihan jadi salah diam-diam.
    const baris = await daftarPiutang();
    const p = baris.find((b) => b.invoiceNo === `${tag}/PUTUS`);
    expect(p?.outstanding).toBe(5_000_000);
  });

  it('menandai piutang tanpa apa pun yang menggantung sebagai belum ditagih', async () => {
    const baris = await daftarPiutang();
    expect(baris.find((b) => b.invoiceNo === `${tag}/PUTUS`)?.keadaan).toBe('belum');
  });

  it('membawa storeId supaya pengelompokan tidak bergantung pada nama', async () => {
    // Dua toko boleh bernama sama; mengelompokkan menurut nama menggabungkan
    // tagihan dua toko yang berbeda.
    const baris = await daftarPiutang();
    expect(baris.find((b) => b.invoiceNo === `${tag}/PUTUS`)?.storeId).toBe(tokoPutusId);
  });

  it('menyaring menurut salesman kalau diminta', async () => {
    const baris = await daftarPiutang({ salesmanId: 'tidak-ada-orang-ini' });
    expect(baris.some((b) => b.invoiceNo === `${tag}/PUTUS`)).toBe(false);
  });
});
