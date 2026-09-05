import { pwaDb } from "./db";
import { deletePendingCompletion } from "./completion-queue";
import { classifyCompletionResult, type CompletionSyncDecision } from "./completion-classify";
import { completePodAction, reportStuckDeliveryCompletionAction } from "@/app/pwa/deliveries/actions";

const MAX_RETRY_ATTEMPTS = 20;

let running = false;

export async function flushPendingCompletions(): Promise<{ synced: number; failed: number; retried: number }> {
  if (running) return { synced: 0, failed: 0, retried: 0 };
  running = true;
  let synced = 0, failed = 0, retried = 0;
  try {
    const pending = (await pwaDb.pendingCompletions.where("syncState").anyOf(["pending", "syncing"]).toArray())
      .sort((a, b) => a.capturedAt - b.capturedAt);
    for (const c of pending) {
      await pwaDb.pendingCompletions.update(c.shipmentId, { syncState: "syncing" });
      let decision: CompletionSyncDecision;
      let reason = "";
      try {
        const goods = await uploadPhotoBlob(c.shipmentId, c.goodsPhotoBlob, "goods");
        const nota = await uploadPhotoBlob(c.shipmentId, c.notaPhotoBlob, "nota");
        const result = await completePodAction({
          shipmentId: c.shipmentId,
          proofPhotoUrl: goods.url,
          proofPhotoR2Key: goods.key,
          signatureUrl: nota.url,
          signatureR2Key: nota.key,
          signedByName: c.signedByName,
          gps: { lat: c.gpsLat, lng: c.gpsLng },
          lines: c.lines,
          deliveredAt: new Date(c.capturedAt),
          completedOffline: true,
        });
        decision = classifyCompletionResult(result);
        if (!result.ok) reason = result.reason;
      } catch {
        decision = "retry";
      }
      if (decision === "evict") {
        await deletePendingCompletion(c.shipmentId);
        synced += 1;
      } else if (decision === "terminal") {
        await pwaDb.pendingCompletions.update(c.shipmentId, { syncState: "failed", error: reason, attempts: c.attempts + 1 });
        await reportStuckDeliveryCompletionAction(c.shipmentId, reason).catch(() => {});
        failed += 1;
      } else {
        const nextAttempts = c.attempts + 1;
        if (nextAttempts >= MAX_RETRY_ATTEMPTS) {
          const ceilingReason = reason || "RETRY_LIMIT_EXCEEDED";
          await pwaDb.pendingCompletions.update(c.shipmentId, { syncState: "failed", error: ceilingReason, attempts: nextAttempts });
          await reportStuckDeliveryCompletionAction(c.shipmentId, ceilingReason).catch(() => {});
          failed += 1;
        } else {
          await pwaDb.pendingCompletions.update(c.shipmentId, { syncState: "pending", attempts: nextAttempts });
          retried += 1;
        }
      }
    }
  } finally {
    running = false;
  }
  return { synced, failed, retried };
}

async function uploadPhotoBlob(shipmentId: string, blob: Blob, kind: "goods" | "nota"): Promise<{ url: string; key: string }> {
  const formData = new FormData();
  formData.append("file", new File([blob], `${shipmentId}-${kind}`, { type: blob.type || "image/jpeg" }));
  formData.append("shipmentId", shipmentId);
  formData.append("clientId", kind);
  const res = await fetch("/pwa/api/upload/delivery-pod-proof", { method: "POST", body: formData });
  if (!res.ok) throw new Error(`upload failed: ${kind}`);
  return res.json();
}
