"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
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
type Mode = "idle" | "live" | "preview";
type Captured = { blob: Blob; url: string };

export function VisitPhotoCapture({ visitId, storeId, synced }: { visitId: string; storeId: string; synced: SyncedPhoto[] }) {
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [camError, setCamError] = useState(false);
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  const total = synced.length + pending.length;
  const atCap = total >= MAX_PER_VISIT;

  const refresh = () => listPendingPhotosForVisit(visitId).then(setPending);
  useEffect(() => { void refresh(); }, [visitId]);

  // Object URLs for pending thumbnails — revoked on change/unmount.
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const p of pending) map[p.localId] = URL.createObjectURL(p.blob);
    setBlobUrls(map);
    return () => { Object.values(map).forEach((u) => URL.revokeObjectURL(u)); };
  }, [pending]);

  // Revoke the captured-preview URL whenever it changes or on unmount.
  useEffect(() => {
    return () => { if (captured) URL.revokeObjectURL(captured.url); };
  }, [captured]);

  const stopCam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => () => stopCam(), []);

  // Attach the live stream once the <video> is mounted (mode flipped to "live" →
  // React has committed the element by the time this effect runs). Doing it
  // synchronously races the render and leaves srcObject unset → black feed.
  useEffect(() => {
    if (mode === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [mode]);

  function closeOverlay() {
    stopCam();
    setCaptured(null);
    setCaption("");
    setCamError(false);
    setMode("idle");
  }

  async function openCam() {
    if (atCap) return;
    setCamError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setMode("live");
    } catch {
      setCamError(true);
      fileRef.current?.click(); // fallback to the native camera / file picker
    }
  }

  function shootFromVideo() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setCaptured({ blob, url: URL.createObjectURL(blob) }); // stream stays live for a retake
      setMode("preview");
    }, "image/jpeg", 0.92);
  }

  function retake() {
    setCaptured(null);
    if (streamRef.current) {
      setMode("live");
    } else {
      // File-fallback path: reopen the picker; onChange returns us to preview.
      setMode("idle");
      fileRef.current?.click();
    }
  }

  async function keep() {
    if (!captured) return;
    setBusy(true);
    try {
      const compressed = await compressImage(captured.blob);
      await enqueuePhoto({ localId: newLocalId(), visitId, storeId, blob: compressed, caption: caption.trim() || undefined });
      await refresh();
      void flushPendingPhotos().then((r) => { void refresh(); if (r.synced > 0) router.refresh(); });
      closeOverlay();
    } catch {
      // leave the overlay open so the user can retry "Simpan"
    } finally {
      setBusy(false);
    }
  }

  const overlay = mode !== "idle" && typeof document !== "undefined"
    ? createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col bg-black">
          {mode === "live" && (
            <>
              <video ref={videoRef} autoPlay playsInline muted className="min-h-0 w-full flex-1 object-cover" />
              <div className="flex items-center justify-between px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                <Button variant="secondary" size="icon" className="h-11 w-11 rounded-full" onClick={closeOverlay} aria-label="Tutup">
                  <X className="h-5 w-5" />
                </Button>
                <button
                  type="button"
                  onClick={shootFromVideo}
                  aria-label="Ambil foto"
                  className="h-16 w-16 rounded-full border-4 border-white bg-white/30 transition active:scale-95"
                />
                <span className="h-11 w-11" aria-hidden />
              </div>
            </>
          )}

          {mode === "preview" && (
            <>
              <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
                {captured && <img src={captured.url} alt="" className="max-h-full max-w-full object-contain" />}
              </div>
              <div className="space-y-3 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <Input
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Keterangan (opsional)"
                  disabled={busy}
                  className="border-white/20 bg-white/10 text-white placeholder:text-white/50"
                />
                <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1 py-6 text-base" onClick={retake} disabled={busy}>
                    <RotateCcw className="mr-2 h-5 w-5" /> Ulangi
                  </Button>
                  <Button className="flex-1 py-6 text-base" onClick={() => void keep()} disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Check className="mr-2 h-5 w-5" />} Simpan
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <Card className="flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Foto Kunjungan</span>
        <Badge variant="secondary">{total}/{MAX_PER_VISIT}</Badge>
      </div>

      <Button onClick={() => void openCam()} disabled={busy || atCap}>
        <Camera className="mr-2 h-4 w-4" /> {atCap ? "Batas foto tercapai" : "Ambil Foto"}
      </Button>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) { setCaptured({ blob: f, url: URL.createObjectURL(f) }); setMode("preview"); }
        }}
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
              <img src={blobUrls[p.localId]} alt={p.caption ?? ""} className="h-full w-full object-cover opacity-70" />
              <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] text-white">
                {p.syncState === "failed" ? "gagal" : "menunggu"}
              </span>
              {p.syncState === "failed" && (
                <button
                  type="button"
                  onClick={() => retryPendingPhoto(p.localId).then(() => flushPendingPhotos()).then((r) => { void refresh(); if (r.synced > 0) router.refresh(); })}
                  className="absolute right-0 top-0 bg-black/60 p-0.5"
                  aria-label="Coba lagi"
                ><RefreshCw className="h-3 w-3 text-white" /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {overlay}
    </Card>
  );
}
