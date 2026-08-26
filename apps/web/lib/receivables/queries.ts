import { prisma } from '@elorae/db';
import {
  hitungSisaPiutang,
  keadaanPiutang,
  nilaiDiakui,
  returTertahan,
  selisihHari,
  type KeadaanPiutang,
} from './rules';
import { PILIH_POTONGAN, potonganRetur } from './deductions';

/**
 * Baris piutang siap tampil, lengkap dengan keadaannya dan bahan untuk
 * menyusun kalimat alasan.
 *
 * Kalimat alasannya dirakit di sisi klien dari `alasan`, bukan disimpan sebagai
 * teks jadi — supaya ikut berganti bahasa bersama sisa aplikasi.
 */
export type BarisPiutang = {
  id: string;
  invoiceNo: string;
  storeId: string;
  storeName: string;
  salesmanName: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  outstanding: number;
  source: string;
  keadaan: KeadaanPiutang;
  alasan: {
    noKlaim?: string;
    nilaiTertahan?: number;
    noKontrabon?: string;
    janjiBayar?: string;
    hariTerlambat?: number;
  };
};

/** Ubah Decimal Prisma ke number. Aturan uang sengaja tidak menyentuh Decimal. */
const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Daftar piutang beserta keadaannya.
 *
 * Sisa yang tersimpan di kolom `outstanding` TIDAK dipercaya di sini — dihitung
 * ulang dari klaim yang menyentuhnya, sesuai aturan bahwa sisa tidak pernah
 * diketik dan tidak pernah dikurangi bertahap. Kolomnya tetap ada sebagai
 * cache untuk penyaringan cepat, bukan sebagai kebenaran.
 */
export async function daftarPiutang(opts?: { salesmanId?: string }): Promise<BarisPiutang[]> {
  const rows = await prisma.receivable.findMany({
    where: opts?.salesmanId ? { salesmanId: opts.salesmanId } : undefined,
    orderBy: [{ dueDate: 'asc' }],
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      dueDate: true,
      amount: true,
      outstanding: true,
      source: true,
      storeId: true,
      store: { select: { name: true } },
      salesman: { select: { name: true } },
      claimLinks: {
        select: {
          settledAmount: true,
          paymentClaim: {
            select: {
              docNo: true,
              status: true,
              invoiceAmount: true,
              deductions: { select: PILIH_POTONGAN },
            },
          },
        },
      },
      collectionLinks: {
        select: {
          collectionNote: {
            select: { docNo: true, promisedDate: true, status: true },
          },
        },
      },
    },
  });

  const hariIni = new Date();

  return rows.map((r) => {
    const klaimList = r.claimLinks.map((link) => ({
      status: link.paymentClaim.status as 'DIKIRIM' | 'TERVERIFIKASI' | 'DITOLAK',
      nilaiFaktur: angka(link.paymentClaim.invoiceAmount),
      potonganRetur: potonganRetur(link.paymentClaim.deductions),
      nilaiDilunasiPiutangIni: angka(link.settledAmount),
    }));

    const sisa = hitungSisaPiutang(angka(r.amount), klaimList);

    const klaimMenunggu = r.claimLinks.find((l) => l.paymentClaim.status === 'DIKIRIM');
    const tertahan = r.claimLinks
      .filter((l) => l.paymentClaim.status === 'TERVERIFIKASI')
      .reduce((sum, l) => sum + returTertahan(potonganRetur(l.paymentClaim.deductions)), 0);

    const kontrabonAktif = r.collectionLinks
      .map((l) => l.collectionNote)
      .find((n) => n.status === 'BERJALAN');

    const keadaan = keadaanPiutang({
      sisa,
      klaimMenunggu: klaimMenunggu ? { docNo: klaimMenunggu.paymentClaim.docNo } : null,
      nilaiTertahan: tertahan,
      kontrabon: kontrabonAktif
        ? { docNo: kontrabonAktif.docNo, janjiBayar: kontrabonAktif.promisedDate }
        : null,
      hariIni,
    });

    return {
      id: r.id,
      invoiceNo: r.invoiceNo,
      storeId: r.storeId,
      storeName: r.store.name,
      salesmanName: r.salesman?.name ?? null,
      invoiceDate: r.invoiceDate.toISOString(),
      dueDate: r.dueDate.toISOString(),
      amount: angka(r.amount),
      outstanding: sisa,
      source: r.source,
      keadaan,
      alasan: {
        noKlaim: klaimMenunggu?.paymentClaim.docNo,
        nilaiTertahan: tertahan > 0 ? tertahan : undefined,
        noKontrabon: kontrabonAktif?.docNo,
        janjiBayar: kontrabonAktif?.promisedDate.toISOString(),
        hariTerlambat: kontrabonAktif
          ? Math.max(0, selisihHari(kontrabonAktif.promisedDate, hariIni))
          : undefined,
      },
    };
  });
}

export type RingkasanPiutang = {
  total: number;
  jumlahPiutang: number;
  perKeadaan: Record<KeadaanPiutang, { jumlah: number; nilai: number }>;
};

/** Ringkasan untuk kepala halaman: berapa banyak, dan menumpuk di keadaan mana. */
export function ringkasPiutang(baris: BarisPiutang[]): RingkasanPiutang {
  const kosong = { jumlah: 0, nilai: 0 };
  const perKeadaan: Record<KeadaanPiutang, { jumlah: number; nilai: number }> = {
    lunas: { ...kosong },
    klaim: { ...kosong },
    tertahan: { ...kosong },
    lewat: { ...kosong },
    tt: { ...kosong },
    belum: { ...kosong },
  };
  let total = 0;
  for (const b of baris) {
    perKeadaan[b.keadaan].jumlah += 1;
    perKeadaan[b.keadaan].nilai += b.outstanding;
    total += b.outstanding;
  }
  return { total, jumlahPiutang: baris.length, perKeadaan };
}

export { nilaiDiakui };
