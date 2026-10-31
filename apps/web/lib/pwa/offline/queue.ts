import { pwaDb, type PendingOrder } from "./db";

export { newLocalId } from "../id-lokal";

/**
 * Pesanan di antrean HP, termasuk jendela pre-order-nya (`PendingOrder.preorderWindowId`).
 * Baris lama tanpa kolom itu dibaca sebagai pesanan stok siap biasa. Nama lama
 * dipertahankan sebagai alias supaya pemanggilnya tidak perlu diubah.
 */
export type PendingOrderInden = PendingOrder;

export async function enqueueOrder(o: Omit<PendingOrderInden, "capturedAt" | "syncState" | "attempts">): Promise<void> {
  const baris: PendingOrderInden = { ...o, capturedAt: Date.now(), syncState: "pending", attempts: 0 };
  await pwaDb.pendingOrders.put(baris);
}

export async function listPendingOrders(): Promise<PendingOrder[]> {
  return pwaDb.pendingOrders.orderBy("capturedAt").toArray();
}

export async function deletePendingOrder(localId: string): Promise<void> {
  await pwaDb.pendingOrders.delete(localId);
}

export async function retryPendingOrder(localId: string): Promise<void> {
  await pwaDb.pendingOrders.update(localId, { syncState: "pending", error: undefined });
}
