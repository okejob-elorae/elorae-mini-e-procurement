import { prisma } from "@elorae/db";
import { capNotificationText } from "@/lib/notifications/text";
import { formatIDR } from "@/lib/sales-orders/format";

/**
 * Kabar `PESANAN_DIKIRIM` ke salesman pemilik pesanan PUTUS bahwa sebagian/seluruh pesanannya sudah
 * dikirim, dengan nomor dan nilai notanya — kabar yang sama yang dulu dikirim "Catat pengiriman".
 * Tombol itu dihapus (P44a); notanya kini terbit saat pengiriman DIBUAT, tetapi barangnya baru
 * dikirim saat pengiriman BERANGKAT dari gudang ("Kirim", PACKED → IN_TRANSIT), jadi kabarnya ikut
 * saat itu. Kalimatnya tidak berubah: "sudah dikirim" kalau pesanannya sudah terkirim seluruhnya
 * (DELIVERED), "dikirim sebagian" kalau belum.
 *
 * Sekali per pengiriman tanpa penanda: perpindahan ke IN_TRANSIT adalah tukar-bandingkan dari PACKED
 * (`shipDeliveryShipment`), jadi hanya satu panggilan yang berhasil sampai ke sini. Konsinyasi tidak
 * dikabari (tidak berubah — kabar ini selalu hanya untuk nota putus). Pelaku yang salesman itu sendiri
 * tidak dikabari. Dipanggil SESUDAH transaksinya selesai dan tidak pernah melempar: pengirimannya sudah
 * tercatat, dan kabar yang gagal tidak boleh membuatnya tampak gagal.
 */
export async function kabarkanPesananDikirim(input: { shipmentId: string; pelakuId: string }): Promise<void> {
  try {
    const s = await prisma.deliveryShipment.findUnique({
      where: { id: input.shipmentId },
      select: {
        status: true,
        delivery: { select: { id: true, docNo: true, total: true, voidedAt: true } },
        order: {
          select: { id: true, orderNo: true, orderType: true, salesmanId: true, deliveryStatus: true, store: { select: { name: true } } },
        },
      },
    });
    if (!s || s.status !== "IN_TRANSIT" || s.order.orderType !== "PUTUS") return;
    const nota = s.delivery;
    if (!nota || nota.voidedAt) return;
    if (s.order.salesmanId === input.pelakuId) return;
    const lengkap = s.order.deliveryStatus === "DELIVERED";
    const { JENIS_KABAR, kabariPengguna } = await import("@/lib/notifications/kabar-pengguna");
    await kabariPengguna(s.order.salesmanId, {
      jenis: JENIS_KABAR.PESANAN_DIKIRIM,
      judul: capNotificationText(lengkap ? `Pesanan ${s.order.orderNo} sudah dikirim` : `Pesanan ${s.order.orderNo} dikirim sebagian`),
      // NotificationQueue.body is VARCHAR(191): a long store name must not stop the row from being written.
      isi: capNotificationText(`${s.order.store.name} · nota ${nota.docNo} · ${formatIDR(nota.total.toString())}`),
      data: { orderId: s.order.id, deliveryId: nota.id },
    });
  } catch (err) {
    console.error("[kabar] pesanan dikirim gagal", input.shipmentId, err);
  }
}
