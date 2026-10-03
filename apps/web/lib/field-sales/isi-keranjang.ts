import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { ENTITAS_REKOMENDASI, JEJAK_REKOMENDASI } from "@/lib/salesman/rekomendasi-aturan";
import { bacaSumberKeranjang, type SumberKeranjang } from "./isi-keranjang-sumber";

/**
 * Keranjang katalog yang diisi dari dokumen lain — permintaan barang SPG
 * (`StockRequest`) atau rekomendasi salesman yang diterima toko
 * (`StoreRecommendation`). Alamatnya `/pwa/stores/<id>/catalog?isi=<jenis>:<id>`.
 *
 * Keranjangnya hanya DIISI: salesman tetap meninjau dan mengirimnya, dan
 * pesanan melewati penulis pesanan biasa (harga server, minimum, kredit,
 * persetujuan kantor). Dokumen sumber ditautkan ke pesanan sesudah pesanan
 * tercatat — best-effort, tidak pernah membatalkan pesanannya.
 */

export { bacaSumberKeranjang, type SumberKeranjang };

export type BarisIsi = { itemId: string; variantSku: string; qty: number };

/** Baris keranjang dari sumbernya, atau null kalau sumber tidak boleh dipakai pengguna ini di toko ini. */
export async function muatIsiKeranjang(
  sumber: SumberKeranjang,
  ctx: { userId: string; storeId: string },
): Promise<BarisIsi[] | null> {
  if (sumber.jenis === "permintaan") {
    const r = await prisma.stockRequest.findFirst({
      // Permintaan yang sudah dibuatkan pesanan tidak mengisi keranjang lagi:
      // membuka ulang alamat lama tidak boleh menghasilkan pesanan kedua.
      where: { id: sumber.id, storeId: ctx.storeId, status: { in: ["BARU", "DIPROSES"] }, fieldSalesOrderId: null, store: { salesmanId: ctx.userId } },
      select: { lines: { select: { itemId: true, variantSku: true, qty: true } } },
    });
    return r ? r.lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku ?? "", qty: l.qty })) : null;
  }
  const r = await prisma.storeRecommendation.findFirst({
    where: { id: sumber.id, storeId: ctx.storeId, salesmanId: ctx.userId, status: "DITERIMA" },
    select: { lines: { select: { itemId: true, variantSku: true, qty: true } } },
  });
  return r ? r.lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku ?? "", qty: l.qty })) : null;
}

/**
 * Tautkan pesanan yang baru tercatat ke dokumen sumbernya. Penjaga keadaan
 * (`updateMany where status …`) di dalam `runSerializable` — Prisma 7
 * `updateMany` bukan compare-and-swap — dan jejaknya di transaksi yang sama.
 * Tidak pernah melempar.
 */
export async function tautkanSumberPesanan(
  sumber: SumberKeranjang,
  input: { orderId: string; orderNo: string; userId: string; storeId: string },
): Promise<void> {
  try {
    if (sumber.jenis === "permintaan") {
      const peminta = await runSerializable(async (tx) => {
        const sebelum = await tx.stockRequest.findUnique({ where: { id: sumber.id }, select: { status: true } });
        const n = await tx.stockRequest.updateMany({
          where: { id: sumber.id, storeId: input.storeId, status: { in: ["BARU", "DIPROSES"] }, fieldSalesOrderId: null, store: { salesmanId: input.userId } },
          data: {
            status: "DIPROSES",
            fieldSalesOrderId: input.orderId,
            handledById: input.userId,
            handledAt: new Date(),
            handleNote: `Dibuatkan pesanan ${input.orderNo}`,
          },
        });
        if (n.count !== 1) return null;
        // Jejak di dalam transaksi yang sama, seperti setiap perubahan status permintaan lainnya.
        await tx.auditLog.create({
          data: {
            userId: input.userId,
            action: "STOCK_REQUEST_STATUS",
            entityType: "StockRequest",
            entityId: sumber.id,
            changes: {
              before: { status: sebelum?.status ?? null, fieldSalesOrderId: null },
              after: { status: "DIPROSES", fieldSalesOrderId: input.orderId, orderNo: input.orderNo },
            },
          },
        });
        const r = await tx.stockRequest.findUnique({ where: { id: sumber.id }, select: { requestedById: true } });
        return r?.requestedById ?? null;
      });
      if (peminta) {
        await kabariPengguna(peminta, {
          jenis: JENIS_KABAR.PERMINTAAN_STOK_DIPROSES,
          judul: "Permintaan barang diproses",
          isi: `Salesman membuatkan pesanan ${input.orderNo} dari permintaan Anda.`,
          data: { requestId: sumber.id },
        });
      }
      return;
    }
    await runSerializable(async (tx) => {
      const n = await tx.storeRecommendation.updateMany({
        where: { id: sumber.id, storeId: input.storeId, salesmanId: input.userId, status: "DITERIMA", fieldSalesOrderId: null },
        data: { status: "SELESAI", fieldSalesOrderId: input.orderId },
      });
      if (n.count !== 1) return;
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: JEJAK_REKOMENDASI.DIPESAN,
          entityType: ENTITAS_REKOMENDASI,
          entityId: sumber.id,
          changes: {
            before: { status: "DITERIMA", fieldSalesOrderId: null },
            after: { status: "SELESAI", fieldSalesOrderId: input.orderId, orderNo: input.orderNo },
          },
        },
      });
    });
  } catch (err) {
    console.error("tautkanSumberPesanan gagal", err);
  }
}
