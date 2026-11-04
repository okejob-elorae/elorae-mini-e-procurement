import { randomUUID } from "node:crypto";
import { runSerializable } from "@/lib/db/tx-retry";
import { recordFieldSalesDeliveryInTx } from "./writer";

/**
 * UNTUK TES SAJA. Mencatat satu nota tagihan di transaksinya sendiri — pengganti
 * `recordFieldSalesDelivery` yang dihapus bersama "Catat pengiriman" (P44/P44a). Di aplikasi,
 * nota hanya terbit saat pengiriman DIBUAT (`createDeliveryShipment`), di dalam transaksinya.
 * Tes yang hanya butuh "ada nota di pesanan ini" memakai pembantu ini supaya tidak perlu
 * membuat pengiriman. Jangan dipanggil kode aplikasi.
 */
export async function catatNotaUji(input: {
  orderId: string;
  deliveredById: string;
  lines: Array<{ orderLineId: string; qty: number }>;
  invoiceDate: Date;
  dueDate: Date;
  note?: string;
  idempotencyKey?: string;
  deliveredAt?: Date;
}): Promise<{ deliveryId: string; docNo: string }> {
  const hasil = await runSerializable((tx) =>
    recordFieldSalesDeliveryInTx(tx, {
      orderId: input.orderId,
      deliveredById: input.deliveredById,
      lines: input.lines,
      note: input.note,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      idempotencyKey: input.idempotencyKey ?? `uji-${randomUUID()}`,
      deliveredAt: input.deliveredAt ?? new Date(),
    }),
  );
  return { deliveryId: hasil.deliveryId, docNo: hasil.docNo };
}
