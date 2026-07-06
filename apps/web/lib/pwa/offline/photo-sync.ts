import { pwaDb } from "./db";
import { deletePendingPhoto } from "./photo-queue";
import { classifyPhotoUpload } from "./photo-classify";

let running = false;

export async function flushPendingPhotos(): Promise<{ synced: number; failed: number; retried: number }> {
  if (running) return { synced: 0, failed: 0, retried: 0 };
  running = true;
  let synced = 0, failed = 0, retried = 0;
  try {
    const pending = (await pwaDb.pendingPhotos.where("syncState").anyOf(["pending", "syncing"]).toArray())
      .sort((a, b) => a.capturedAt - b.capturedAt);
    for (const p of pending) {
      await pwaDb.pendingPhotos.update(p.localId, { syncState: "syncing" });
      let decision: ReturnType<typeof classifyPhotoUpload>;
      let reason = "";
      try {
        const form = new FormData();
        form.set("file", new File([p.blob], `${p.localId}.jpg`, { type: "image/jpeg" }));
        form.set("visitId", p.visitId);
        form.set("clientId", p.localId);
        form.set("capturedAt", String(p.capturedAt));
        if (p.caption) form.set("caption", p.caption);
        const res = await fetch("/pwa/api/upload/visit-photo", { method: "POST", body: form });
        decision = classifyPhotoUpload(res.status);
        if (!res.ok) reason = `HTTP ${res.status}`;
      } catch {
        decision = classifyPhotoUpload("thrown");
      }
      if (decision === "evict") { await deletePendingPhoto(p.localId); synced += 1; }
      else if (decision === "terminal") { await pwaDb.pendingPhotos.update(p.localId, { syncState: "failed", error: reason, attempts: p.attempts + 1 }); failed += 1; }
      else { await pwaDb.pendingPhotos.update(p.localId, { syncState: "pending", attempts: p.attempts + 1 }); retried += 1; }
    }
  } finally {
    running = false;
  }
  return { synced, failed, retried };
}
