import { pwaDb, type PendingPhoto } from "./db";
export { newLocalId } from "./queue";

export async function enqueuePhoto(o: Omit<PendingPhoto, "capturedAt" | "syncState" | "attempts"> & { capturedAt?: number }): Promise<void> {
  await pwaDb.pendingPhotos.put({
    ...o,
    capturedAt: o.capturedAt ?? Date.now(),
    syncState: "pending",
    attempts: 0,
  });
}

export async function listPendingPhotosForVisit(visitId: string): Promise<PendingPhoto[]> {
  return (await pwaDb.pendingPhotos.where("visitId").equals(visitId).toArray()).sort((a, b) => a.capturedAt - b.capturedAt);
}

export async function deletePendingPhoto(localId: string): Promise<void> {
  await pwaDb.pendingPhotos.delete(localId);
}

export async function retryPendingPhoto(localId: string): Promise<void> {
  await pwaDb.pendingPhotos.update(localId, { syncState: "pending", error: undefined });
}
