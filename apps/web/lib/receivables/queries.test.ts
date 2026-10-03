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
let tugasIds: string[] = [];

beforeEach(async () => {
  tugasIds = [];
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
  await prisma.collectionTask.deleteMany({ where: { id: { in: tugasIds.map(seededId) } } });
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

describe('daftarPiutang — lingkup', () => {
  it('hanya mengambil piutang yang diminta', async () => {
    // Tanpa lingkup, layar yang menampilkan SATU dokumen memuat seluruh tabel.
    const baris = await daftarPiutang({ receivableIds: [piutangPutusId] });
    expect(baris).toHaveLength(1);
    expect(baris[0].invoiceNo).toBe(`${tag}/PUTUS`);
  });

  it('mengembalikan kosong untuk daftar id kosong, bukan seluruh tabel', async () => {
    // Prisma MENGABAIKAN filter `undefined`. Kalau lingkupnya pernah berubah
    // jadi undefined saat daftarnya kosong, kueri melebar ke semua baris —
    // kelas kesalahan yang sama dengan teardown yang menghapus satu tabel.
    const baris = await daftarPiutang({ receivableIds: [] });
    expect(baris).toHaveLength(0);
  });

  it('menyaring menurut toko', async () => {
    const baris = await daftarPiutang({ storeId: tokoPutusId });
    expect(baris.every((b) => b.storeId === tokoPutusId)).toBe(true);
  });

  it('hanyaTerbuka tidak pernah membuang yang benar-benar masih terbuka', async () => {
    // Saringan kasar lewat kolom cache. Arah yang berbahaya adalah membuang
    // yang masih terbuka; itu tidak mungkin karena penulisnya selalu menulis
    // kolom ini saat sisanya berubah.
    const terbuka = await daftarPiutang({ hanyaTerbuka: true });
    expect(terbuka.some((b) => b.invoiceNo === `${tag}/PUTUS`)).toBe(true);
  });
});

describe('daftarPiutang — penagih (pemegang toko sekarang)', () => {
  /*
   * Keputusan pemilik: toko yang dirotasi, piutang lamanya ditagih sales yang
   * SEKARANG memegang toko — sales baru membantu menagih faktur sales lama.
   * Kolom `salesmanId` faktur tidak berubah; ia tetap mencatat penjualnya.
   */
  it('pemegang toko sekarang menagih faktur yang dijual sales lama', async () => {
    await prisma.receivable.update({ where: { id: seededId(piutangPutusId) }, data: { salesmanId: `${tag}-lama` } });
    await prisma.store.update({ where: { id: seededId(tokoPutusId) }, data: { salesmanId: `${tag}-baru` } });

    const baru = await daftarPiutang({ penagihId: `${tag}-baru` });
    expect(baru.some((b) => b.invoiceNo === `${tag}/PUTUS`)).toBe(true);

    const lama = await daftarPiutang({ penagihId: `${tag}-lama` });
    expect(lama.some((b) => b.invoiceNo === `${tag}/PUTUS`)).toBe(false);
  });

  it('penjual asli menagih selama toko belum punya pemegang', async () => {
    await prisma.receivable.update({ where: { id: seededId(piutangPutusId) }, data: { salesmanId: `${tag}-lama` } });

    const lama = await daftarPiutang({ penagihId: `${tag}-lama` });
    expect(lama.some((b) => b.invoiceNo === `${tag}/PUTUS`)).toBe(true);

    const orangLain = await daftarPiutang({ penagihId: `${tag}-baru` });
    expect(orangLain.some((b) => b.invoiceNo === `${tag}/PUTUS`)).toBe(false);
  });
  /*
   * Kantor bisa menugaskan penagihan ke orang yang BUKAN pemegang toko. Tanpa
   * ini ia melihat tugasnya tetapi tidak bisa membuka fakturnya, jadi tidak bisa
   * melaporkan pembayarannya — tugas yang tidak mungkin diselesaikan.
   */
  async function buatTugas(assigneeId: string, status: string) {
    const t = await prisma.collectionTask.create({
      data: {
        assigneeId,
        storeId: seededId(tokoPutusId),
        receivableIds: [seededId(piutangPutusId)],
        status,
        createdById: `${tag}-kantor`,
      },
    });
    tugasIds.push(t.id);
  }

  it('orang yang ditugasi tugas tagih TERBUKA ikut menagih faktur di tugas itu', async () => {
    await prisma.store.update({ where: { id: seededId(tokoPutusId) }, data: { salesmanId: `${tag}-pemegang` } });
    await buatTugas(`${tag}-penugasan`, 'TERBUKA');

    const ditugasi = await daftarPiutang({ penagihId: `${tag}-penugasan` });
    expect(ditugasi.map((b) => b.invoiceNo)).toEqual([`${tag}/PUTUS`]);

    // Pemegang toko tetap menagihnya juga — penugasan menambah, tidak memindahkan.
    const pemegang = await daftarPiutang({ penagihId: `${tag}-pemegang` });
    expect(pemegang.some((b) => b.invoiceNo === `${tag}/PUTUS`)).toBe(true);
  });

  it('tugas yang sudah selesai atau dibatalkan tidak lagi membuka fakturnya', async () => {
    await prisma.store.update({ where: { id: seededId(tokoPutusId) }, data: { salesmanId: `${tag}-pemegang` } });
    await buatTugas(`${tag}-penugasan`, 'SELESAI');
    await buatTugas(`${tag}-penugasan`, 'DIBATALKAN');

    const ditugasi = await daftarPiutang({ penagihId: `${tag}-penugasan` });
    expect(ditugasi.some((b) => b.invoiceNo === `${tag}/PUTUS`)).toBe(false);
  });

  it('tugas tagih tidak pernah membuka faktur toko konsinyasi', async () => {
    const t = await prisma.collectionTask.create({
      data: {
        assigneeId: `${tag}-penugasan`,
        storeId: seededId(tokoKonsiId),
        receivableIds: [seededId(piutangKonsiId)],
        status: 'TERBUKA',
        createdById: `${tag}-kantor`,
      },
    });
    tugasIds.push(t.id);
    const ditugasi = await daftarPiutang({ penagihId: `${tag}-penugasan` });
    expect(ditugasi).toEqual([]);
  });
});
