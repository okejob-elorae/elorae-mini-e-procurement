import { prisma } from "@elorae/db";
import type { BarisPiutang } from "@/lib/receivables/queries";
import type { AturanKredit, KeadaanTagihan } from "@/lib/salesman/kredit";
import { bacaAturanKreditDb, keadaanTagihanToko } from "@/lib/salesman/tagihan-toko";

/**
 * Bahan penilaian kredit satu toko: aturan pemilik, batas per toko, dan
 * keadaan tagihannya sekarang. Dipakai penulis pesanan (saat pesanan dibuat),
 * halaman katalog HP (peringatan sebelum Kirim) dan halaman persetujuan —
 * ketiganya harus membaca hal yang sama supaya tidak berbeda pendapat.
 */
export type KreditToko = {
  aturan: AturanKredit;
  batas: { creditLimit: number | null; maxOpenInvoices: number | null };
  /** null = tagihan GAGAL dibaca. Bukan sama dengan "tidak punya tagihan". */
  keadaan: KeadaanTagihan | null;
  /** Faktur yang belum lunas; kosong kalau gagal dibaca. */
  baris: BarisPiutang[];
};

/** null untuk toko konsinyasi (tidak punya piutang) dan toko yang tidak ada. */
export async function muatKreditToko(storeId: string): Promise<KreditToko | null> {
  const toko = await prisma.store.findUnique({
    where: { id: storeId },
    select: { termsType: true, creditLimit: true, maxOpenInvoices: true },
  });
  if (!toko || toko.termsType === "KONSI") return null;
  const aturan = await bacaAturanKreditDb();
  const batas = {
    creditLimit: toko.creditLimit === null ? null : Number(toko.creditLimit),
    maxOpenInvoices: toko.maxOpenInvoices,
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
