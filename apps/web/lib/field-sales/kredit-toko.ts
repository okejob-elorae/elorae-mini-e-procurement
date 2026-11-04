import { prisma } from "@elorae/db";
import type { BarisPiutang } from "@/lib/receivables/queries";
import type { AturanKredit, BatasToko, KeadaanTagihan } from "@/lib/salesman/kredit";
import { bacaAturanKreditDb, keadaanTagihanToko } from "@/lib/salesman/tagihan-toko";

/**
 * Bahan penilaian kredit satu toko: aturan pemilik, batas per toko, dan
 * keadaan tagihannya sekarang. Dipakai penulis pesanan (saat pesanan dibuat),
 * halaman katalog HP (peringatan sebelum Kirim) dan halaman persetujuan —
 * ketiganya harus membaca hal yang sama supaya tidak berbeda pendapat.
 */
export type KreditToko = {
  aturan: AturanKredit;
  /** Batas milik toko apa adanya — arti kolom kosong diputuskan `batasKreditBerlaku`, bukan pemanggil. */
  batas: BatasToko;
  /**
   * Dibangun dari SATU angka kredit, `computeStoreCreditExposure` (Q10) — sama
   * dengan gerbang persetujuan. null = tagihan GAGAL dibaca. Bukan sama dengan
   * "tidak punya tagihan".
   */
  keadaan: KeadaanTagihan | null;
  /** Faktur yang belum lunas; kosong kalau gagal dibaca. */
  baris: BarisPiutang[];
};

/**
 * null untuk toko yang tidak ada, dan untuk toko KONSINYASI: mode kredit dan
 * batas faktur terbuka hanya berlaku untuk pesanan PUTUS. Transfer konsinyasi
 * digerbangkan dasar kredit tim atas eksposurnya saja, dan hanya dengan angka
 * milik tokonya sendiri — batas kosong tidak dibatasi (P21).
 */
export async function muatKreditToko(storeId: string): Promise<KreditToko | null> {
  const toko = await prisma.store.findUnique({
    where: { id: storeId },
    select: { termsType: true, creditLimit: true, maxOpenInvoices: true, noCreditLimit: true },
  });
  if (!toko || toko.termsType === "KONSI") return null;
  const aturan = await bacaAturanKreditDb();
  const batas: BatasToko = {
    creditLimit: toko.creditLimit === null ? null : Number(toko.creditLimit),
    maxOpenInvoices: toko.maxOpenInvoices,
    noCreditLimit: toko.noCreditLimit,
    termsType: "PUTUS",
  };
  try {
    const { keadaan, baris } = await keadaanTagihanToko(storeId, aturan.hariToleransi);
    return { aturan, batas, keadaan, baris };
  } catch (err) {
    // Tabel piutang yang tak terbaca tidak boleh menjatuhkan pengambilan pesanan;
    // pemanggil memperlakukan `keadaan: null` sebagai "periksa manual".
    console.error("muatKreditToko: tagihan toko gagal dibaca", storeId, err);
    return { aturan, batas, keadaan: null, baris: [] };
  }
}
