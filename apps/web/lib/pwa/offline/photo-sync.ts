import { pwaDb } from "./db";
import { deletePendingPhoto, type FotoAntrean } from "./photo-queue";
import { classifyPhotoUpload, PHOTO_CAP_REACHED_ERROR } from "./photo-classify";
import { keadaanCheckinTertahan } from "./luring-tergantung";
import { KUNJUNGAN_DITOLAK } from "./luring-klasifikasi";
import { tambahFotoTerkirim } from "./foto-kunjungan";

let running = false;

/** Id kunjungan yang dilaporkan server untuk foto yang baru terunggah, bila ada. */
async function visitIdDariJawaban(res: Response): Promise<string | null> {
  try {
    const d = (await res.json()) as { visitId?: unknown };
    return typeof d.visitId === "string" ? d.visitId : null;
  } catch {
    return null;
  }
}

export async function flushPendingPhotos(): Promise<{ synced: number; failed: number; retried: number }> {
  if (running) return { synced: 0, failed: 0, retried: 0 };
  running = true;
  let synced = 0, failed = 0, retried = 0;
  try {
    const pending = ((await pwaDb.pendingPhotos.where("syncState").anyOf(["pending", "syncing"]).toArray()) as FotoAntrean[])
      .sort((a, b) => a.capturedAt - b.capturedAt);
    for (const p of pending) {
      // Foto di kunjungan yang check-in-nya juga tanpa sinyal: tunggu sampai
      // check-in itu sampai; kalau check-in-nya ditolak, berhenti dengan alasannya.
      const ikatan = p.visitId ? "kirim" : await keadaanCheckinTertahan(p.visitClientId);
      if (ikatan === "tunggu") {
        await pwaDb.pendingPhotos.update(p.localId, { syncState: "pending" });
        continue;
      }
      if (ikatan === "ditolak") {
        await pwaDb.pendingPhotos.update(p.localId, { syncState: "failed", error: KUNJUNGAN_DITOLAK, attempts: p.attempts + 1 });
        failed += 1;
        continue;
      }
      await pwaDb.pendingPhotos.update(p.localId, { syncState: "syncing" });
      let decision: ReturnType<typeof classifyPhotoUpload>;
      let reason = "";
      let visitIdTerkirim: string | null = p.visitId || null;
      try {
        const form = new FormData();
        form.set("file", new File([p.blob], `${p.localId}.jpg`, { type: "image/jpeg" }));
        if (p.visitId) form.set("visitId", p.visitId);
        if (p.visitClientId) form.set("visitClientId", p.visitClientId);
        form.set("clientId", p.localId);
        form.set("capturedAt", String(p.capturedAt));
        if (p.caption) form.set("caption", p.caption);
        const res = await fetch("/pwa/api/upload/visit-photo", { method: "POST", body: form, redirect: "manual" });
        decision = classifyPhotoUpload(res.status);
        if (res.status === 409) reason = PHOTO_CAP_REACHED_ERROR;
        else if (!res.ok) reason = `HTTP ${res.status}`;
        else visitIdTerkirim = (await visitIdDariJawaban(res)) ?? visitIdTerkirim;
      } catch {
        decision = classifyPhotoUpload("thrown");
      }
      if (decision === "evict") {
        await deletePendingPhoto(p.localId);
        // Diingat untuk aturan "wajib foto" saat check-out tanpa sinyal.
        if (visitIdTerkirim) tambahFotoTerkirim(visitIdTerkirim);
        synced += 1;
      }
      else if (decision === "terminal") { await pwaDb.pendingPhotos.update(p.localId, { syncState: "failed", error: reason, attempts: p.attempts + 1 }); failed += 1; }
      else { await pwaDb.pendingPhotos.update(p.localId, { syncState: "pending", attempts: p.attempts + 1 }); retried += 1; }
    }
  } finally {
    running = false;
  }
  return { synced, failed, retried };
}
