import { pwaDb, type PendingOrder } from "./db";

export function newLocalId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueueOrder(o: Omit<PendingOrder, "capturedAt" | "syncState" | "attempts">): Promise<void> {
  await pwaDb.pendingOrders.put({ ...o, capturedAt: Date.now(), syncState: "pending", attempts: 0 });
}

export async function listPendingOrders(): Promise<PendingOrder[]> {
  return pwaDb.pendingOrders.orderBy("capturedAt").toArray();
}

export async function deletePendingOrder(localId: string): Promise<void> {
  await pwaDb.pendingOrders.delete(localId);
}
