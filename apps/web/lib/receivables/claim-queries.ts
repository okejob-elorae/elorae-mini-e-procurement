import { prisma } from '@elorae/db';
import { returTertahan } from './rules';
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
  status: 'DIKIRIM' | 'TERVERIFIKASI' | 'DITOLAK';
  verifikatorNama: string | null;
  verifikasiPada: string | null;
  catatanVerifikasi: string | null;
  dibuatOleh: string | null;
  /** Yang belum diakui walau klaimnya sudah terverifikasi. */
  nilaiTertahan: number;
  faktur: { id: string; invoiceNo: string; nilaiDilunasi: number; nilaiFaktur: number }[];
  potongan: {
    nama: string;
    nilai: number;
    catatan: string | null;
    noNrt: string | null;
    storeReturnId: string | null;
    /** Kalimat kenapa potongan ini menahan uang, kalau memang menahan. */
    tertahan: number;
  }[];
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
    verifikasiPada: k.verifiedAt?.toISOString() ?? null,
    catatanVerifikasi: k.verifyNote,
    dibuatOleh: k.createdBy?.name ?? null,
    nilaiTertahan: returTertahan(potonganRetur(k.deductions)),
    faktur: k.receivableLinks.map((l) => ({
      id: l.receivable.id,
      invoiceNo: l.receivable.invoiceNo,
      nilaiDilunasi: angka(l.settledAmount),
      nilaiFaktur: angka(l.receivable.amount),
    })),
    potongan: k.deductions.map((d) => ({
      nama: d.name,
      nilai: angka(d.amount),
      catatan: d.note,
      noNrt: d.storeReturn?.noNrt ?? null,
      storeReturnId: d.storeReturnId,
      // Dihitung per potongan lewat jalur yang sama dengan totalnya, supaya
      // baris dan totalnya mustahil bercerita berbeda.
      tertahan: returTertahan(potonganRetur([d])),
    })),
  };
}

export type BahanKlaimBaru = {
  toko: { id: string; name: string }[];
  piutangPerToko: Record<string, BarisPiutang[]>;
  returPerToko: Record<string, { id: string; noNrt: string; nilaiKlaim: number }[]>;
  jenisPotongan: { id: string; nama: string; cara: CaraPotongan; wajibCatatan: boolean }[];
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
export async function bahanKlaimBaru(): Promise<BahanKlaimBaru> {
  const [semua, retur, jenis] = await Promise.all([
    daftarPiutang(),
    prisma.storeReturn.findMany({
      where: { status: { not: 'BATAL' } },
      orderBy: { claimDate: 'desc' },
      select: { id: true, noNrt: true, storeId: true, claimedAmount: true },
    }),
    jenisPotonganAktif(),
  ]);

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
    toko: [...namaToko.entries()].map(([id, name]) => ({ id, name })),
    piutangPerToko,
    returPerToko,
    jenisPotongan: jenis,
  };
}
