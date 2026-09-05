import { pwaDb, type PendingCompletion } from "./db";

export async function enqueueCompletion(
  c: Omit<PendingCompletion, "syncState" | "attempts">,
): Promise<void> {
  await pwaDb.pendingCompletions.put({ ...c, syncState: "pending", attempts: 0 });
}

export async function listPendingCompletions(): Promise<PendingCompletion[]> {
  return (await pwaDb.pendingCompletions.toArray()).sort((a, b) => a.capturedAt - b.capturedAt);
}

export async function getPendingCompletion(shipmentId: string): Promise<PendingCompletion | undefined> {
  return pwaDb.pendingCompletions.get(shipmentId);
}

export async function deletePendingCompletion(shipmentId: string): Promise<void> {
  await pwaDb.pendingCompletions.delete(shipmentId);
}

export async function retryPendingCompletion(shipmentId: string): Promise<void> {
  await pwaDb.pendingCompletions.update(shipmentId, { syncState: "pending", error: undefined });
}
