import { prisma } from "@elorae/db";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { dariMutasi, type JenisKiriman } from "./kiriman";
import { adaSelisih, teksSelisih, type SelisihTerima } from "./selisih-terima";

/**
 * Hasil terima kiriman yang tidak pas (kurang atau rusak) → salesman yang
 * mengirim. Tanpa ini salesman baru tahu saat toko menolak membayar.
 *
 * - PUTUS_DELIVERY : salesman pesanan pengiriman itu.
 * - KONSI_ORDER    : salesman pesanan konsi itu.
 * - KONSI_SHIPMENT : pemegang toko (`Store.salesmanId`), bila ada.
 * - Mutasi antar toko TIDAK lewat sini — pembuat mutasi sudah dikabari
 *   (`MUTASI_DITERIMA`) dan selisihnya diputuskan kantor.
 *
 * Isi kabar hanya potong, tidak pernah rupiah: harga konsinyasi tidak boleh
 * sampai ke HP salesman.
 *
 * Dipanggil penulis SESUDAH transaksinya, sekali per tanda terima yang BARU
 * dibuat — kiriman ulang dengan kunci yang sama tidak sampai ke sini.
 */

export function susunKabarSelisih(k: {
  sourceType: JenisKiriman;
  sourceId: string;
  storeId: string;
  docNo: string;
  namaToko: string;
  /** Pesanan yang ditautkan kabar; null untuk titipan konsinyasi (ke halaman toko). */
  orderId: string | null;
  selisih: SelisihTerima;
}): Kabar {
  const teks = teksSelisih(k.selisih);
  return {
    jenis: JENIS_KABAR.KIRIMAN_DITERIMA_SELISIH,
    judul: `Kiriman ${k.docNo}: ${teks}`,
    isi: `${k.namaToko}: tiba ${k.selisih.diterima} dari ${k.selisih.dikirim} pcs — ${teks}.`,
    data: {
      ...(k.orderId ? { orderId: k.orderId } : {}),
      storeId: k.storeId,
      sourceType: k.sourceType,
      sourceId: k.sourceId,
    },
  };
}

/** Siapa yang mengirim kiriman ini (lihat daftar di atas), dan pesanannya bila ada. */
export async function pengirimKiriman(
  sourceType: JenisKiriman,
  sourceId: string,
  storeId: string,
): Promise<{ userId: string | null; orderId: string | null }> {
  if (sourceType === "PUTUS_DELIVERY") {
    const d = await prisma.fieldSalesDelivery.findFirst({
      where: { id: sourceId, order: { storeId } },
      select: { order: { select: { id: true, salesmanId: true } } },
    });
    return { userId: d?.order.salesmanId ?? null, orderId: d?.order.id ?? null };
  }
  if (sourceType === "KONSI_ORDER") {
    const o = await prisma.fieldSalesOrder.findFirst({ where: { id: sourceId, storeId }, select: { id: true, salesmanId: true } });
    return { userId: o?.salesmanId ?? null, orderId: o?.id ?? null };
  }
  if (sourceType === "KONSI_SHIPMENT") {
    const s = await prisma.store.findUnique({ where: { id: storeId }, select: { salesmanId: true } });
    return { userId: s?.salesmanId ?? null, orderId: null };
  }
  return { userId: null, orderId: null };
}

/**
 * Kirim kabarnya. Tidak pernah melempar: kabar yang gagal tidak boleh
 * membuat SPG mengira penerimaannya gagal — tanda terimanya sudah tercatat.
 * Mengembalikan penerimanya (null = tidak ada yang dikabari) untuk tes.
 */
export async function kabarkanSelisihTerima(input: {
  sourceType: JenisKiriman;
  sourceId: string;
  storeId: string;
  docNo: string;
  selisih: SelisihTerima;
  /** SPG yang menerima — tidak pernah mengabari dirinya sendiri. */
  penerimaId?: string | null;
}): Promise<{ penerima: string | null }> {
  if (dariMutasi(input.sourceType) || !adaSelisih(input.selisih)) return { penerima: null };
  try {
    const [pengirim, toko] = await Promise.all([
      pengirimKiriman(input.sourceType, input.sourceId, input.storeId),
      prisma.store.findUnique({ where: { id: input.storeId }, select: { name: true } }),
    ]);
    if (!pengirim.userId || pengirim.userId === input.penerimaId) return { penerima: null };
    await kabariPengguna(
      pengirim.userId,
      susunKabarSelisih({ ...input, namaToko: toko?.name ?? "Toko", orderId: pengirim.orderId }),
    );
    return { penerima: pengirim.userId };
  } catch (err) {
    console.error("kabarkanSelisihTerima gagal", input.sourceType, input.sourceId, err);
    return { penerima: null };
  }
}
