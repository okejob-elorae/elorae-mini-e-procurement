import { prisma } from '@elorae/db';
import { returTertahan, type StatusKlaim } from './rules';
import { PILIH_POTONGAN, potonganRetur } from './deductions';
import { daftarPiutang, type BarisPiutang } from './queries';
import { jenisPotonganAktif, type CaraPotongan } from './deduction-types';

const angka = (v: unknown): number => Number(v ?? 0);

export type RincianKlaim = {
  id: string;
  docNo: string;
  storeName: string;
  salesmanName: string | null;
  claimedTransferAt: string;
  method: string;
  nilaiFaktur: number;
  totalPotongan: number;
  nilaiDiterima: number;
  fotoTransfer: string | null;
  fotoRincian: string | null;
  status: StatusKlaim;
  verifikatorNama: string | null;
  /** Dibatalkan oleh pelapornya sendiri dari HP (bukan oleh keuangan). */
  ditarikSales: boolean;
  verifikasiPada: string | null;
  catatanVerifikasi: string | null;
  dibuatOleh: string | null;
  /** Yang belum diakui walau klaimnya sudah terverifikasi. */
  nilaiTertahan: number;
  faktur: { id: string; invoiceNo: string; nilaiDilunasi: number; nilaiFaktur: number }[];
  storeId: string;
  potongan: {
    id: string;
    nama: string;
    nilai: number;
    catatan: string | null;
    noNrt: string | null;
    storeReturnId: string | null;
    /** Tautan menunjuk nota yang sudah tidak ada — ini yang menahan selamanya. */
    tautanMenggantung: boolean;
    /** Kalimat kenapa potongan ini menahan uang, kalau memang menahan. */
    tertahan: number;
  }[];
  /** Nota retur milik toko ini, untuk menautkan ulang potongan yang keliru. */
  returToko: { id: string; noNrt: string; nilaiKlaim: number }[];
};

/** Satu BKM, lengkap dengan kedua fotonya dan tautan potongannya ke nota retur. */
export async function rincianKlaim(id: string): Promise<RincianKlaim | null> {
  const k = await prisma.paymentClaim.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      claimedTransferAt: true,
      method: true,
      invoiceAmount: true,
      deductionTotal: true,
      receivedAmount: true,
      transferPhotoUrl: true,
      breakdownPhotoUrl: true,
      status: true,
      verifiedAt: true,
      verifyNote: true,
      storeId: true,
      salesmanId: true,
      verifiedById: true,
      store: { select: { name: true } },
      salesman: { select: { name: true } },
      verifiedBy: { select: { name: true } },
      createdBy: { select: { name: true } },
      receivableLinks: {
        select: {
          settledAmount: true,
          receivable: { select: { id: true, invoiceNo: true, amount: true } },
        },
      },
      deductions: {
        select: {
          ...PILIH_POTONGAN,
          id: true,
          name: true,
          note: true,
          storeReturn: {
            select: {
              noNrt: true,
              claimedAmount: true,
              status: true,
              warehouseReturn: { select: { physicalAmount: true, status: true } },
              charges: { select: { status: true } },
            },
          },
        },
      },
    },
  });
  if (!k) return null;

  const returToko = await prisma.storeReturn.findMany({
    where: { storeId: k.storeId, status: { not: 'BATAL' } },
    orderBy: { claimDate: 'desc' },
    select: { id: true, noNrt: true, claimedAmount: true },
  });

  return {
    id: k.id,
    docNo: k.docNo,
    storeName: k.store.name,
    salesmanName: k.salesman?.name ?? null,
    claimedTransferAt: k.claimedTransferAt.toISOString(),
    method: k.method,
    nilaiFaktur: angka(k.invoiceAmount),
    totalPotongan: angka(k.deductionTotal),
    nilaiDiterima: angka(k.receivedAmount),
    fotoTransfer: k.transferPhotoUrl,
    fotoRincian: k.breakdownPhotoUrl,
    status: k.status as RincianKlaim['status'],
    verifikatorNama: k.verifiedBy?.name ?? null,
    ditarikSales: k.status === 'DIBATALKAN' && k.verifiedById !== null && k.verifiedById === k.salesmanId,
    verifikasiPada: k.verifiedAt?.toISOString() ?? null,
    catatanVerifikasi: k.verifyNote,
    dibuatOleh: k.createdBy?.name ?? null,
    storeId: k.storeId,
    returToko: returToko.map((r) => ({
      id: r.id,
      noNrt: r.noNrt,
      nilaiKlaim: angka(r.claimedAmount),
    })),
    nilaiTertahan: returTertahan(potonganRetur(k.deductions)),
    faktur: k.receivableLinks.map((l) => ({
      id: l.receivable.id,
      invoiceNo: l.receivable.invoiceNo,
      nilaiDilunasi: angka(l.settledAmount),
      nilaiFaktur: angka(l.receivable.amount),
    })),
    potongan: k.deductions.map((d) => ({
      id: d.id,
      nama: d.name,
      nilai: angka(d.amount),
      catatan: d.note,
      noNrt: d.storeReturn?.noNrt ?? null,
      storeReturnId: d.storeReturnId,
      // Menunjuk sesuatu, tapi yang ditunjuk tidak ada. Inilah baris yang
      // menahan uang selamanya sampai seseorang menautkannya ulang.
      tautanMenggantung: d.storeReturnId !== null && d.storeReturn === null,
      // Dihitung per potongan lewat jalur yang sama dengan totalnya, supaya
      // baris dan totalnya mustahil bercerita berbeda.
      tertahan: returTertahan(potonganRetur([d])),
    })),
  };
}

export type BahanKlaimBaru = {
  toko: { id: string; name: string; pkp: boolean }[];
  piutangPerToko: Record<string, BarisPiutang[]>;
  returPerToko: Record<string, { id: string; noNrt: string; nilaiKlaim: number }[]>;
  jenisPotongan: {
    id: string;
    nama: string;
    cara: CaraPotongan;
    wajibCatatan: boolean;
    hanyaPkp: boolean;
  }[];
};

/**
 * Bahan untuk membuat BKM: toko mana saja yang punya piutang terbuka, faktur
 * apa saja, dan nota retur mana yang bisa dipilih sebagai potongan.
 *
 * Nota retur yang ditawarkan sengaja TIDAK disaring menurut keadaannya. Toko
 * memotong pembayarannya berdasarkan nota yang ada di tangannya, dan gudang
 * sering belum menghitung apa pun saat itu — menyaring yang belum dihitung akan
 * menghilangkan justru kasus yang paling sering terjadi.
 */
export async function bahanKlaimBaru(opsi?: {
  /**
   * Layar HP: hanya piutang yang ditagih sales ini (pemegang toko sekarang,
   * atau penjualnya selama toko belum punya pemegang). Layar kantor tidak
   * mengisinya dan melihat semuanya.
   */
  penagihId?: string;
}): Promise<BahanKlaimBaru> {
  const [semua, retur, jenis] = await Promise.all([
    // BKM hanya melunasi faktur yang masih terbuka.
    daftarPiutang({ hanyaTerbuka: true, penagihId: opsi?.penagihId }),
    prisma.storeReturn.findMany({
      where: { status: { not: 'BATAL' } },
      orderBy: { claimDate: 'desc' },
      select: { id: true, noNrt: true, storeId: true, claimedAmount: true },
    }),
    jenisPotonganAktif(),
  ]);

  // Status PKP tiap toko, untuk mengunci jenis potongan khusus PKP di formulir.
  const pkp = new Set(
    (await prisma.store.findMany({ where: { isPkp: true }, select: { id: true } })).map((t) => t.id),
  );

  const terbuka = semua.filter((p) => p.outstanding > 0);
  const piutangPerToko: Record<string, BarisPiutang[]> = {};
  const namaToko = new Map<string, string>();
  for (const p of terbuka) {
    (piutangPerToko[p.storeId] ??= []).push(p);
    namaToko.set(p.storeId, p.storeName);
  }

  const returPerToko: Record<string, { id: string; noNrt: string; nilaiKlaim: number }[]> = {};
  for (const r of retur) {
    (returPerToko[r.storeId] ??= []).push({
      id: r.id,
      noNrt: r.noNrt,
      nilaiKlaim: angka(r.claimedAmount),
    });
  }

  return {
    toko: [...namaToko.entries()].map(([id, name]) => ({ id, name, pkp: pkp.has(id) })),
    piutangPerToko,
    returPerToko,
    jenisPotongan: jenis,
  };
}

/** Isi awal formulir BKM yang menyalin laporan lama — lihat `bahanSalinKlaim`. */
export type AwalKlaim = {
  /** BKM yang disalin — dikirim sebagai `menggantikanId` supaya keduanya tertaut. */
  dariId: string;
  dariDocNo: string;
  tglTransfer: string;
  cara: 'transfer' | 'tunai' | 'giro';
  giro: { nomor: string; bank: string; terbit: string; efektif: string } | null;
  fotoTransfer: { url: string; nama: string } | null;
  fotoRincian: { url: string; nama: string } | null;
};

const tanggalWibTeks = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d) : '';

/**
 * Bahan "Laporkan ulang": BKM yang ditolak atau dibatalkan, disalin ke formulir
 * baru. Yang ikut hanya yang tidak bergantung pada toko — tanggal, cara bayar,
 * rincian giro, foto. Toko, faktur, dan potongan dipilih ulang: justru itu yang
 * biasanya salah.
 *
 * `salesmanId` (layar HP): hanya laporan miliknya sendiri. Laporan yang masih
 * hidup tidak bisa disalin — menyalinnya berarti melaporkan uang yang sama dua kali.
 */
export async function bahanSalinKlaim(id: string, opsi?: { salesmanId?: string }): Promise<AwalKlaim | null> {
  const k = await prisma.paymentClaim.findUnique({
    where: { id },
    select: {
      docNo: true,
      salesmanId: true,
      status: true,
      method: true,
      claimedTransferAt: true,
      giroNo: true,
      giroBank: true,
      giroIssueDate: true,
      giroEffectiveDate: true,
      transferPhotoUrl: true,
      breakdownPhotoUrl: true,
    },
  });
  if (!k) return null;
  if (opsi?.salesmanId && k.salesmanId !== opsi.salesmanId) return null;
  if (k.status !== 'DITOLAK' && k.status !== 'DIBATALKAN') return null;
  // Sudah punya pengganti: menyalinnya lagi berarti melaporkan uang yang sama dua kali.
  if (await prisma.paymentClaim.findUnique({ where: { replacesClaimId: id }, select: { id: true } })) return null;
  const cara = k.method === 'tunai' || k.method === 'giro' ? k.method : 'transfer';
  const foto = (url: string | null, nama: string) => (url ? { url, nama } : null);
  return {
    dariId: id,
    dariDocNo: k.docNo,
    tglTransfer: tanggalWibTeks(k.claimedTransferAt),
    cara,
    giro:
      cara === 'giro'
        ? {
            nomor: k.giroNo ?? '',
            bank: k.giroBank ?? '',
            terbit: tanggalWibTeks(k.giroIssueDate),
            efektif: tanggalWibTeks(k.giroEffectiveDate),
          }
        : null,
    fotoTransfer: foto(k.transferPhotoUrl, `${k.docNo}-bukti.jpg`),
    fotoRincian: foto(k.breakdownPhotoUrl, `${k.docNo}-rincian.jpg`),
  };
}
