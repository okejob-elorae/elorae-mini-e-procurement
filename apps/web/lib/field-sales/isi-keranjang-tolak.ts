import { runSerializable } from "@/lib/db/tx-retry";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { ENTITAS_REKOMENDASI } from "@/lib/salesman/rekomendasi-aturan";
import { dibatalkanSalesman } from "./ganti-pesanan";

/**
 * Pasangan `rapikanSumberPesananBatal` untuk pesanan yang DITOLAK KANTOR
 * (status `REJECTED` tanpa `cancelledById`) — keputusan pemilik 2026-10-06
 * (sementara): permintaan barang SPG yang `DIPROSES` lewat pesanan itu kembali
 * `BARU` tanpa tautan, rekomendasi `SELESAI` kembali `DITERIMA` tanpa tautan,
 * dan SPG-nya dikabari, supaya pemegang toko bisa membuatkan pesanan lagi.
 *
 * Tautan yang tertinggal di pesanan lama dalam rantai ubah pesanan
 * (`replacesOrderId`, pemindahan yang tidak sempat jalan) ikut dibuka: pesanan
 * yang ditolak kantor adalah ujung rantainya, jadi tidak ada pesanan hidup lagi.
 *
 * Permintaan/rekomendasi yang sudah diputuskan orang dengan tangan
 * (SELESAI/DITOLAK, DITOLAK SPG) tidak dibuka. Bekerja dari keadaan basis data:
 * aman dipanggil ulang dan tidak berbuat apa-apa untuk pesanan yang masih hidup
 * atau dibatalkan salesman. Penjaga keadaan di dalam `runSerializable`, jejak di
 * transaksi yang sama, kabar SESUDAH commit. Tidak pernah melempar.
 */

/** Nama tindakan jejak (`AuditLog.action`). Jangan ditulis sebagai string bebas di tempat lain. */
export const JEJAK_SUMBER_PESANAN_DITOLAK = {
  PERMINTAAN_PESANAN_DITOLAK: "STOCK_REQUEST_ORDER_REJECTED",
  REKOMENDASI_PESANAN_DITOLAK: "STORE_RECOMMENDATION_ORDER_REJECTED",
} as const;

const ENTITAS_PERMINTAAN = "StockRequest";

/** Penjaga putaran rantai, bukan aturan bisnis. */
const BATAS_RANTAI = 20;

export type HasilBukaSumber = { dibuka: number };

type KabarTertunda = { userId: string; kabar: Kabar };

export async function bukaSumberPesananDitolak(orderId: string): Promise<HasilBukaSumber> {
  let kabar: KabarTertunda[] = [];
  let hasil: HasilBukaSumber = { dibuka: 0 };
  try {
    hasil = await runSerializable(async (tx): Promise<HasilBukaSumber> => {
      // Diulang saat bentrok — kabar dari percobaan yang batal tidak boleh ikut terkirim.
      kabar = [];
      const pesanan = await tx.fieldSalesOrder.findUnique({
        where: { id: orderId },
        select: { id: true, orderNo: true, status: true, cancelledById: true, rejectedById: true, rejectReason: true, salesmanId: true, replacesOrderId: true },
      });
      if (!pesanan || pesanan.status !== "REJECTED" || dibatalkanSalesman(pesanan)) return { dibuka: 0 };

      // Pesanan ini + pesanan lama yang digantikannya (semuanya sudah dibatalkan saat diganti).
      const ids = [pesanan.id];
      let lamaId = pesanan.replacesOrderId;
      for (let i = 0; i < BATAS_RANTAI && lamaId && !ids.includes(lamaId); i++) {
        ids.push(lamaId);
        const lama = await tx.fieldSalesOrder.findUnique({ where: { id: lamaId }, select: { replacesOrderId: true } });
        lamaId = lama?.replacesOrderId ?? null;
      }
      const oleh = pesanan.rejectedById ?? pesanan.salesmanId;
      const alasan = pesanan.rejectReason;
      let dibuka = 0;

      const permintaan = await tx.stockRequest.findMany({
        where: { fieldSalesOrderId: { in: ids }, status: "DIPROSES" },
        select: { id: true, fieldSalesOrderId: true, handledById: true, handleNote: true, requestedById: true },
      });
      for (const r of permintaan) {
        const n = await tx.stockRequest.updateMany({
          where: { id: r.id, status: "DIPROSES", fieldSalesOrderId: r.fieldSalesOrderId },
          data: { status: "BARU", fieldSalesOrderId: null, handledById: null, handledAt: null, handleNote: null },
        });
        if (n.count !== 1) continue;
        await tx.auditLog.create({
          data: {
            userId: oleh,
            action: JEJAK_SUMBER_PESANAN_DITOLAK.PERMINTAAN_PESANAN_DITOLAK,
            entityType: ENTITAS_PERMINTAAN,
            entityId: r.id,
            changes: {
              before: { status: "DIPROSES", fieldSalesOrderId: r.fieldSalesOrderId, handledById: r.handledById, handleNote: r.handleNote },
              after: { status: "BARU", fieldSalesOrderId: null },
            },
            metadata: { orderId: pesanan.id, orderNo: pesanan.orderNo },
            reason: alasan,
          },
        });
        kabar.push({
          userId: r.requestedById,
          kabar: {
            jenis: JENIS_KABAR.PERMINTAAN_STOK_DIPROSES,
            judul: "Pesanan dari permintaan Anda ditolak kantor",
            isi: `Kantor menolak pesanan ${pesanan.orderNo}. Permintaan Anda dibuka lagi dan menunggu dibuatkan pesanan.`,
            data: { requestId: r.id, status: "BARU" },
          },
        });
        dibuka += 1;
      }

      const rekomendasi = await tx.storeRecommendation.findMany({
        where: { fieldSalesOrderId: { in: ids }, status: "SELESAI" },
        select: { id: true, storeId: true, fieldSalesOrderId: true },
      });
      for (const k of rekomendasi) {
        const n = await tx.storeRecommendation.updateMany({
          where: { id: k.id, status: "SELESAI", fieldSalesOrderId: k.fieldSalesOrderId },
          data: { status: "DITERIMA", fieldSalesOrderId: null },
        });
        if (n.count !== 1) continue;
        await tx.auditLog.create({
          data: {
            userId: oleh,
            action: JEJAK_SUMBER_PESANAN_DITOLAK.REKOMENDASI_PESANAN_DITOLAK,
            entityType: ENTITAS_REKOMENDASI,
            entityId: k.id,
            changes: {
              before: { status: "SELESAI", fieldSalesOrderId: k.fieldSalesOrderId },
              after: { status: "DITERIMA", fieldSalesOrderId: null },
            },
            metadata: { storeId: k.storeId, orderId: pesanan.id, orderNo: pesanan.orderNo },
            reason: alasan,
          },
        });
        // SPG toko = pengguna yang toko tetapnya toko ini (sama dengan penerima rekomendasi).
        const spg = await tx.user.findMany({ where: { assignedStoreId: k.storeId }, select: { id: true } });
        for (const s of spg) {
          kabar.push({
            userId: s.id,
            kabar: {
              jenis: JENIS_KABAR.REKOMENDASI_MASUK,
              judul: "Pesanan rekomendasi ditolak kantor",
              isi: `Kantor menolak pesanan ${pesanan.orderNo} dari rekomendasi yang Anda terima. Barangnya belum dipesan.`,
              data: { recommendationId: k.id },
            },
          });
        }
        dibuka += 1;
      }

      return { dibuka };
    });
  } catch (err) {
    console.error("bukaSumberPesananDitolak gagal", orderId, err);
    return { dibuka: 0 };
  }
  // SESUDAH commit; `kabariPengguna` menelan galatnya sendiri.
  for (const k of kabar) await kabariPengguna(k.userId, k.kabar);
  return hasil;
}
