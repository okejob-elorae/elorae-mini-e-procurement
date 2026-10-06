import { prisma } from "@elorae/db";

/**
 * Apakah kunjungan ini sudah menghasilkan transaksi yang tercatat di server —
 * dasar `TRANSAKSI` otomatis saat check-out (`putuskanHasilCheckout`) dan
 * pertanyaan "perlu alasan?" sebelum check-out. Dokumen yang sudah dibatalkan
 * tidak dihitung: membuat lalu membatalkan tidak boleh menggantikan alasan.
 *
 * - Pesanan yang terikat kunjungannya dan MASIH hidup. `REJECTED` tidak
 *   dihitung, baik dibatalkan salesman (`cancelledById`) maupun ditolak kantor.
 *   Pesanan yang DIUBAH tetap dihitung lewat penggantinya: penulis pesanan
 *   membawa `visitId` pesanan lama ke pengganti (`replacesOrderId`), jadi
 *   pengganti yang hidup terhitung di sini, dan pengganti yang dibatalkan juga
 *   tidak.
 * - Klaim bayar (BKM), retur toko (NRT), penjualan kanvas, dan tukar faktur
 *   oleh orang ini di toko ini sejak check-in, kecuali yang ditarik/dibatalkan
 *   (BKM `DIBATALKAN`, NRT `BATAL`, tukar faktur `BATAL`). Penjualan kanvas
 *   tidak punya pembatalan.
 */
export async function adaTransaksiKunjungan(k: { visitId: string; userId: string; storeId: string; sejak: Date }): Promise<boolean> {
  const sejak = { gte: k.sejak };
  const jumlah = await Promise.all([
    prisma.fieldSalesOrder.count({ where: { visitId: k.visitId, status: { not: "REJECTED" } } }),
    prisma.paymentClaim.count({
      where: {
        storeId: k.storeId,
        createdAt: sejak,
        status: { not: "DIBATALKAN" },
        OR: [{ createdById: k.userId }, { salesmanId: k.userId }],
      },
    }),
    prisma.storeReturn.count({ where: { storeId: k.storeId, salesmanId: k.userId, createdAt: sejak, status: { not: "BATAL" } } }),
    prisma.vanSale.count({ where: { storeId: k.storeId, salesmanId: k.userId, createdAt: sejak } }),
    prisma.collectionNote.count({ where: { storeId: k.storeId, salesmanId: k.userId, createdAt: sejak, status: { not: "BATAL" } } }),
  ]);
  return jumlah.some((n) => n > 0);
}
