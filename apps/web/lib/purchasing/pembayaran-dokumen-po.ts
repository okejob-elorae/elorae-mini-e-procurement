import { prisma, type Prisma } from "@elorae/db";
import { AWALAN_KUNCI_TANDAI_LUNAS } from "./pembayaran-aturan";

/*
 * Berkas daun: penulis jurnal tombol lama (`supplier-payment-journal.ts`),
 * pembaca buku pembantu hutang, dan penulis pembayaran tagihan vendor
 * (`lib/vendor-billing/payment-writer.ts`) sama-sama butuh jawaban "dokumen ini
 * sudah dibayar lewat Pembayaran pemasok?" — di sini supaya tidak ada yang
 * saling mengimpor melingkar (`pembayaran-tandai-lunas.ts` sudah mengimpor
 * penulis jurnal itu).
 */

type Klien = Prisma.TransactionClient | typeof prisma;

/** Penyaring pembayaran yang dihitung sebagai alokasi dokumen (bukan cermin tombol lama). */
export const SARING_PEMBAYARAN_DOKUMEN: Prisma.SupplierPaymentWhereInput = {
  status: "POSTED",
  OR: [{ idempotencyKey: null }, { NOT: { idempotencyKey: { startsWith: AWALAN_KUNCI_TANDAI_LUNAS } } }],
};

/**
 * Penjaga tombol lama: PO yang SUDAH punya pembayaran dokumen (sebagian/penuh
 * lewat halaman Pembayaran pemasok) tidak boleh ditandai lunas atau dibuka
 * tandanya dengan tombol — tombol itu membayar SELURUH hutang PO dari buku
 * besar, jadi bagian yang sudah dibayar akan terbayar dua kali.
 *
 * Dibaca juga oleh `postSupplierPaymentJournal` sendiri, jadi setiap jalan ke
 * jurnal tombol lama (tombolnya, "Posting jurnal pembayaran" di spanduk PO)
 * melewati penjaga yang sama, dan oleh spanduk itu
 * (`paymentJournalPendingWhilePaid`), yang tidak tampil untuk PO seperti ini.
 */
export async function adaPembayaranDokumenUntukPo(poId: string, tx: Klien = prisma): Promise<boolean> {
  const grn = await tx.gRN.findMany({ where: { poId }, select: { id: true } });
  if (grn.length === 0) return false;
  const ada = await tx.supplierPaymentAllocation.findFirst({
    where: { targetType: "GRN", targetId: { in: grn.map((g) => g.id) }, payment: SARING_PEMBAYARAN_DOKUMEN },
    select: { id: true },
  });
  return ada != null;
}

/**
 * Dari langkah WO yang diberikan, yang jasanya sudah (sebagian) dibayar lewat
 * dokumen pembayaran pemasok (alokasi `WO_STEP`, id langkah).
 */
export async function langkahWoDibayarDokumen(stepIds: string[], tx: Klien = prisma): Promise<Set<string>> {
  if (stepIds.length === 0) return new Set();
  const rows = await tx.supplierPaymentAllocation.findMany({
    where: { targetType: "WO_STEP", targetId: { in: stepIds }, payment: SARING_PEMBAYARAN_DOKUMEN },
    select: { targetId: true },
  });
  return new Set(rows.map((r) => r.targetId).filter((id): id is string => id != null));
}
