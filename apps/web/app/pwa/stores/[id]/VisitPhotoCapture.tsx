"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { compressImage } from "@/lib/pwa/photo/compress";
import { enqueuePhoto, listPendingPhotosForVisit, retryPendingPhoto, newLocalId } from "@/lib/pwa/offline/photo-queue";
import { flushPendingPhotos } from "@/lib/pwa/offline/photo-sync";
import type { PendingPhoto } from "@/lib/pwa/offline/db";

const MAX_PER_VISIT = 20;

type SyncedPhoto = { id: string; url: string; caption: string | null; capturedAtIso: string };

export function VisitPhotoCapture({ visitId, storeId, synced }: { visitId: string; storeId: string; synced: SyncedPhoto[] }) {
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState("");
  const [camOpen, setCamOpen] = useState(false);
  const [camError, setCamError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const total = synced.length + pending.length;
  const atCap = total >= MAX_PER_VISIT;

  const refresh = () => listPendingPhotosForVisit(visitId).then(setPending);
  useEffect(() => { void refresh(); }, [visitId]);

  const stopCam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOpen(false);
  };
  useEffect(() => () => stopCam(), []);

  async function openCam() {
    setCamError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setCamOpen(true);
      queueMicrotask(() => { if (videoRef.current) videoRef.current.srcObject = stream; });
    } catch {
      setCamError(true);
      fileRef.current?.click(); // fallback to native camera/file picker
    }
  }

  async function enqueue(blobIn: Blob) {
    setBusy(true);
    try {
      const compressed = await compressImage(blobIn);
      await enqueuePhoto({ localId: newLocalId(), visitId, storeId, blob: compressed, caption: caption.trim() || undefined });
      setCaption("");
      await refresh();
      void flushPendingPhotos().then(refresh);
    } catch {
      // keep the shot context; surface via a toast in the parent if desired
    } finally {
      setBusy(false);
    }
  }

  async function shootFromVideo() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
    stopCam();
    if (blob) await enqueue(blob);
  }

  return (
    <Card className="flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Foto Kunjungan</span>
        <Badge variant="secondary">{total}/{MAX_PER_VISIT}</Badge>
      </div>

      <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Keterangan (opsional)" disabled={busy || atCap} />

      {camOpen ? (
        <div className="space-y-2">
          <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-md bg-black" />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void shootFromVideo()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />} Ambil
            </Button>
            <Button variant="secondary" onClick={stopCam}><X className="h-4 w-4" /></Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => void openCam()} disabled={busy || atCap}>
          <Camera className="mr-2 h-4 w-4" /> {atCap ? "Batas foto tercapai" : "Ambil Foto"}
        </Button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void enqueue(f); e.target.value = ""; }}
      />
      {camError && <p className="text-xs text-muted-foreground">Kamera tidak tersedia — pakai kamera perangkat.</p>}

      {total > 0 && (
        <div className="flex flex-wrap gap-2">
          {synced.map((p) => (
            <div key={p.id} className="relative h-16 w-16 overflow-hidden rounded-md border bg-muted">
              <img src={p.url} alt={p.caption ?? ""} className="h-full w-full object-cover" loading="lazy" />
            </div>
          ))}
          {pending.map((p) => (
            <div key={p.localId} className="relative h-16 w-16 overflow-hidden rounded-md border bg-muted">
              <img src={URL.createObjectURL(p.blob)} alt={p.caption ?? ""} className="h-full w-full object-cover opacity-70" />
              <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] text-white">
                {p.syncState === "failed" ? "gagal" : "menunggu"}
              </span>
              {p.syncState === "failed" && (
                <button
                  type="button"
                  onClick={() => retryPendingPhoto(p.localId).then(() => flushPendingPhotos()).then(refresh)}
                  className="absolute right-0 top-0 bg-black/60 p-0.5"
                  aria-label="Coba lagi"
                ><RefreshCw className="h-3 w-3 text-white" /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
