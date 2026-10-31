import type { Prisma, PrismaClient } from "@elorae/db";
import { kunciStokPengiriman, kunciStokPersetujuan } from "@/lib/finance/lapangan/aturan";

/*
 * HPP barang retur toko — KHUSUS SERVER.
 *
 * Barang yang kembali dari toko PUTUS dinilai dengan HPP saat barang itu DIJUAL
 * ke toko tersebut, bukan dengan harga rata-rata saat gudang menghitungnya:
 * membalik HPP lebih besar dari yang dulu dibebankan menaikkan laba kotor dari
 * barang yang sama (uji akuntansi 2, bug 6 — kemeja M dijual dengan HPP
 * 81.222,22, kembali rusak sesudah rata-ratanya naik ke 103.528,91).
 *
 * "Saat dijual" = penyesuaian stok keluar (`FIELD_SALES_CONSUME`) pengiriman
 * putus TERAKHIR ke toko itu untuk barang × varian itu, yang terjadi sebelum
 * hitungan gudang. Tanpa penjualan seperti itu → null, dan pemanggil memakai
 * harga rata-rata saat dihitung (perilaku lama).
 */

type Klien = PrismaClient | Prisma.TransactionClient;

/** Berapa pengiriman terakhir yang diperiksa — yang lebih lama dari itu tanpa penyesuaian stok bukan penjualan yang dicari. */
const BATAS_PENGIRIMAN = 20;

/** HPP per pcs penjualan terakhir barang × varian ke toko itu sebelum `sebelum`, atau null. */
export async function hppJualTerakhir(
  client: Klien,
  b: { storeId: string | null | undefined; itemId: string; variantSku: string | null | undefined; sebelum: Date },
): Promise<number | null> {
  if (!b.storeId || !b.itemId) return null;
  const varian = b.variantSku?.trim() ?? "";
  const baris = await client.fieldSalesDeliveryLine.findMany({
    where: {
      itemId: b.itemId,
      variantSku: varian,
      qty: { gt: 0 },
      delivery: { createdAt: { lte: b.sebelum }, order: { storeId: b.storeId, orderType: "PUTUS" } },
    },
    orderBy: [{ delivery: { createdAt: "desc" } }, { id: "desc" }],
    take: BATAS_PENGIRIMAN,
    select: { deliveryId: true, orderLineId: true, delivery: { select: { order: { select: { orderNo: true } } } } },
  });
  if (baris.length === 0) return null;
  const kunci = baris.flatMap((l) => [
    kunciStokPengiriman(l.delivery.order.orderNo, l.deliveryId, l.orderLineId),
    kunciStokPersetujuan(l.delivery.order.orderNo, l.orderLineId),
  ]);
  const stok = await client.stockAdjustment.findMany({
    where: { idempotencyKey: { in: kunci }, createdAt: { lte: b.sebelum } },
    select: { idempotencyKey: true, prevAvgCost: true },
  });
  const perKunci = new Map(stok.map((s) => [s.idempotencyKey!, Number(s.prevAvgCost)]));
  for (const l of baris) {
    const kirim = perKunci.get(kunciStokPengiriman(l.delivery.order.orderNo, l.deliveryId, l.orderLineId));
    if (kirim !== undefined) return kirim;
    const setuju = perKunci.get(kunciStokPersetujuan(l.delivery.order.orderNo, l.orderLineId));
    if (setuju !== undefined) return setuju;
  }
  return null;
}
