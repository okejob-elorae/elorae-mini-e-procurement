import { prisma, type Prisma } from "@elorae/db";

/**
 * Status BKM yang TIDAK menjadikan kunjungan bertransaksi: ditarik/dibatalkan,
 * atau ditolak keuangan (uangnya tidak pernah diakui — keputusan pemilik
 * 2026-10-06, sementara). Satu tempat supaya mudah diubah.
 */
export const STATUS_BKM_BUKAN_TRANSAKSI = ["DIBATALKAN", "DITOLAK"] as const;

/** `AuditLog.action` saat hasil kunjungan `TRANSAKSI` dicabut karena dokumennya hilang. */
export const AKSI_HASIL_KUNJUNGAN_DIBETULKAN = "STORE_VISIT_OUTCOME_CORRECTED";
/** `AuditLog.entityType` kunjungan toko. */
export const ENTITAS_KUNJUNGAN = "StoreVisit";

type Klien = Pick<Prisma.TransactionClient, "fieldSalesOrder" | "paymentClaim" | "storeReturn" | "vanSale" | "collectionNote">;

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
 *   atau ditolak (BKM `DIBATALKAN`/`DITOLAK`, NRT `BATAL`, tukar faktur `BATAL`).
 *   Penjualan kanvas tidak punya pembatalan.
 *
 * `klien`: transaksi pemanggil (pembetulan hasil kunjungan saat pesanan
 * dibatalkan membaca keadaan SESUDAH pembatalannya, di transaksi yang sama).
 */
export async function adaTransaksiKunjungan(
  k: { visitId: string; userId: string; storeId: string; sejak: Date },
  klien: Klien = prisma,
): Promise<boolean> {
  const sejak = { gte: k.sejak };
  const jumlah = await Promise.all([
    klien.fieldSalesOrder.count({ where: { visitId: k.visitId, status: { not: "REJECTED" } } }),
    klien.paymentClaim.count({
      where: {
        storeId: k.storeId,
        createdAt: sejak,
        status: { notIn: [...STATUS_BKM_BUKAN_TRANSAKSI] },
        OR: [{ createdById: k.userId }, { salesmanId: k.userId }],
      },
    }),
    klien.storeReturn.count({ where: { storeId: k.storeId, salesmanId: k.userId, createdAt: sejak, status: { not: "BATAL" } } }),
    klien.vanSale.count({ where: { storeId: k.storeId, salesmanId: k.userId, createdAt: sejak } }),
    klien.collectionNote.count({ where: { storeId: k.storeId, salesmanId: k.userId, createdAt: sejak, status: { not: "BATAL" } } }),
  ]);
  return jumlah.some((n) => n > 0);
}

/**
 * Kunjungan yang SUDAH ditutup dengan hasil `TRANSAKSI` kehilangan dokumennya
 * (salesman membatalkan pesanannya sesudah check-out): hasilnya dicabut
 * (`outcome`/`outcomeNote` null) bila tidak ada transaksi lain menurut
 * `adaTransaksiKunjungan`, dan jejaknya ditulis di transaksi pemanggil.
 *
 * Harus dipanggil di dalam `runSerializable` SESUDAH dokumennya dibatalkan.
 * Kunjungan yang masih terbuka tidak disentuh — check-out-nya sendiri yang
 * menilai. Hasil selain `TRANSAKSI` (alasan, `TRANSAKSI_TERTUNDA`) dibiarkan.
 * Mengembalikan true bila hasilnya dicabut.
 */
export async function betulkanHasilKunjunganDiTx(
  tx: Prisma.TransactionClient,
  input: { visitId: string; olehId: string; alasan: string; sebab: Record<string, string> },
): Promise<boolean> {
  const v = await tx.storeVisit.findUnique({
    where: { id: input.visitId },
    select: { id: true, userId: true, storeId: true, checkinAt: true, checkoutAt: true, outcome: true, outcomeNote: true },
  });
  if (!v || !v.checkoutAt || v.outcome !== "TRANSAKSI") return false;
  const masih = await adaTransaksiKunjungan({ visitId: v.id, userId: v.userId, storeId: v.storeId, sejak: v.checkinAt }, tx);
  if (masih) return false;
  // Penjaga keadaan; aman karena pemanggil berada di runSerializable.
  const r = await tx.storeVisit.updateMany({
    where: { id: v.id, outcome: "TRANSAKSI" },
    data: { outcome: null, outcomeNote: null },
  });
  if (r.count !== 1) return false;
  await tx.auditLog.create({
    data: {
      userId: input.olehId,
      action: AKSI_HASIL_KUNJUNGAN_DIBETULKAN,
      entityType: ENTITAS_KUNJUNGAN,
      entityId: v.id,
      changes: {
        before: { outcome: v.outcome, outcomeNote: v.outcomeNote },
        after: { outcome: null, outcomeNote: null },
      },
      metadata: { storeId: v.storeId, ...input.sebab },
      reason: input.alasan,
    },
  });
  return true;
}
