"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, Pause, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PackerOrderDetail, PackerOrderOption } from "@/lib/packer/queries";

type Step = "pick" | "record" | "review";

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function RecordWizardClient({
  mode,
  initialOrderId,
  orderOptions,
  initialDetail,
}: {
  mode: "new" | "edit";
  initialOrderId: string | null;
  orderOptions: Array<
    Omit<PackerOrderOption, "transactionDate"> & { transactionDate: string }
  >;
  initialDetail: (Omit<PackerOrderDetail, "transactionDate"> & {
    transactionDate: string;
  }) | null;
}) {
  const [step, setStep] = useState<Step>(
    mode === "edit" && initialDetail ? "record" : "pick",
  );
  const [selectedId, setSelectedId] = useState<string>(
    initialOrderId ?? "",
  );
  const [detail, setDetail] = useState(initialDetail);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mediaRef = useMemo(
    () => ({
      stream: null as MediaStream | null,
      recorder: null as MediaRecorder | null,
      chunks: [] as Blob[],
      timer: null as number | null,
      startedAt: 0,
      accumulated: 0,
      videoEl: null as HTMLVideoElement | null,
    }),
    [],
  );

  useEffect(() => {
    if (step === "record") {
      void ensureCamera();
    }
    return () => {
      stopTimer();
      mediaRef.stream?.getTracks().forEach((t) => t.stop());
      mediaRef.stream = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/step camera lifecycle only
  }, [step]);

  async function loadDetail(id: string) {
    setLoadingDetail(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/packer/orders/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Gagal memuat detail order");
      }
      const data = await res.json();
      setDetail(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat detail");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function ensureCamera() {
    setCameraError("");
    try {
      if (mediaRef.stream) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true,
      });
      mediaRef.stream = stream;
      if (mediaRef.videoEl) {
        mediaRef.videoEl.srcObject = stream;
        await mediaRef.videoEl.play().catch(() => undefined);
      }
    } catch {
      setCameraError(
        "Tidak bisa mengakses kamera. Izinkan kamera di browser lalu coba lagi.",
      );
    }
  }

  function stopTimer() {
    if (mediaRef.timer != null) {
      window.clearInterval(mediaRef.timer);
      mediaRef.timer = null;
    }
  }

  function startTimer() {
    stopTimer();
    mediaRef.timer = window.setInterval(() => {
      const live = (Date.now() - mediaRef.startedAt) / 1000;
      setDurationSec(mediaRef.accumulated + live);
    }, 200);
  }

  async function startRecording() {
    await ensureCamera();
    if (!mediaRef.stream) return;

    mediaRef.chunks = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : undefined;
    const recorder = new MediaRecorder(
      mediaRef.stream,
      mime ? { mimeType: mime } : undefined,
    );
    mediaRef.recorder = recorder;
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) mediaRef.chunks.push(ev.data);
    };
    recorder.onstop = () => {
      const b = new Blob(mediaRef.chunks, {
        type: recorder.mimeType || "video/webm",
      });
      setBlob(b);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(b));
      setRecording(false);
      setPaused(false);
      stopTimer();
    };
    recorder.start(1000);
    mediaRef.accumulated = 0;
    mediaRef.startedAt = Date.now();
    setDurationSec(0);
    setRecording(true);
    setPaused(false);
    setBlob(null);
    startTimer();
  }

  function pauseRecording() {
    const rec = mediaRef.recorder;
    if (!rec || rec.state !== "recording") return;
    rec.pause();
    mediaRef.accumulated += (Date.now() - mediaRef.startedAt) / 1000;
    stopTimer();
    setPaused(true);
  }

  function resumeRecording() {
    const rec = mediaRef.recorder;
    if (!rec || rec.state !== "paused") return;
    rec.resume();
    mediaRef.startedAt = Date.now();
    setPaused(false);
    startTimer();
  }

  function finishRecording() {
    const rec = mediaRef.recorder;
    if (!rec) return;
    if (rec.state === "inactive") return;
    if (rec.state === "recording") {
      mediaRef.accumulated += (Date.now() - mediaRef.startedAt) / 1000;
    }
    setDurationSec(mediaRef.accumulated);
    rec.stop();
    mediaRef.stream?.getTracks().forEach((t) => t.stop());
    mediaRef.stream = null;
  }

  async function submitVideo() {
    if (!blob || !detail) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const fd = new FormData();
      fd.append("file", blob, `packing-${detail.id}.webm`);
      fd.append("salesOrderId", detail.id);
      fd.append("durationSec", String(durationSec));
      fd.append("replace", mode === "edit" ? "true" : "false");
      const res = await fetch("/api/packer/upload", {
        method: "POST",
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Gagal kirim (${res.status})`);
      }
      toast.success(
        mode === "edit"
          ? "Video berhasil diganti"
          : "Berhasil kirim video",
      );
      window.location.href = "/packer";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal kirim video";
      setSubmitError(msg);
      toast.error(msg);
      setSubmitting(false);
    }
  }

  function onClickKirim() {
    if (mode === "edit") {
      setConfirmOpen(true);
      return;
    }
    void submitVideo();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/packer" className="text-sm text-slate-500 hover:underline">
          ← Kembali ke list
        </Link>
        <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
          {mode === "edit" ? "Edit video" : "Rekam baru"} · langkah{" "}
          {step === "pick" ? "1/3" : step === "record" ? "2/3" : "3/3"}
        </span>
      </div>

      {step === "pick" && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold">Pilih orderan</h2>
          <p className="text-sm text-slate-500">
            Hanya order yang belum punya video packing.
          </p>
          <select
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
            value={selectedId}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedId(id);
              if (id) void loadDetail(id);
              else setDetail(null);
            }}
          >
            <option value="">— Pilih order —</option>
            {orderOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.salesorderNo}
                {o.customerName ? ` · ${o.customerName}` : ""}
              </option>
            ))}
          </select>

          {loadingDetail && (
            <p className="text-sm text-slate-500">Memuat detail…</p>
          )}

          {detail && (
            <div className="rounded-xl bg-slate-50 p-4 text-sm space-y-1">
              <div>
                <span className="text-slate-500">Order</span>{" "}
                <span className="font-medium">{detail.salesorderNo}</span>
              </div>
              {detail.customerName && (
                <div>
                  <span className="text-slate-500">Buyer</span>{" "}
                  {detail.customerName}
                </div>
              )}
              <div>
                <span className="text-slate-500">Tanggal</span>{" "}
                {formatDate(detail.transactionDate)}
              </div>
              <div>
                <span className="text-slate-500">Channel</span> {detail.channel}{" "}
                · {detail.status}
              </div>
              <div>
                <span className="text-slate-500">Item</span> {detail.itemCount} ·
                Total {detail.grandTotal}
              </div>
              {detail.trackingNumber && (
                <div>
                  <span className="text-slate-500">Resi</span>{" "}
                  {detail.trackingNumber}
                </div>
              )}
            </div>
          )}

          <Button
            className="w-full"
            disabled={!detail}
            onClick={() => {
              setStep("record");
              void ensureCamera();
            }}
          >
            Next
          </Button>
        </section>
      )}

      {step === "record" && detail && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold">Rekam video packing</h2>
          <p className="text-sm text-slate-500">
            Order {detail.salesorderNo}
            {detail.customerName ? ` · ${detail.customerName}` : ""}
          </p>

          <div className="overflow-hidden rounded-xl bg-black aspect-video">
            {!previewUrl ? (
              <video
                ref={(el) => {
                  mediaRef.videoEl = el;
                  if (el && mediaRef.stream) {
                    el.srcObject = mediaRef.stream;
                    void el.play().catch(() => undefined);
                  }
                }}
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            ) : (
              <video
                src={previewUrl}
                controls
                playsInline
                className="h-full w-full object-contain"
              />
            )}
          </div>

          <div className="text-center font-mono text-2xl tabular-nums">
            {formatDuration(durationSec)}
          </div>

          {cameraError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {cameraError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3">
            {!recording && !blob && (
              <Button onClick={() => void startRecording()} className="gap-2">
                <Video className="h-4 w-4" />
                Rekam
              </Button>
            )}
            {recording && !paused && (
              <Button variant="outline" onClick={pauseRecording} className="gap-2">
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            )}
            {recording && paused && (
              <Button onClick={resumeRecording} className="gap-2">
                Lanjut
              </Button>
            )}
            {recording && (
              <Button
                onClick={finishRecording}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              >
                <Check className="h-4 w-4" />
                Selesai
              </Button>
            )}
            {blob && !recording && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setBlob(null);
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                    setDurationSec(0);
                    void ensureCamera();
                  }}
                >
                  Rekam ulang
                </Button>
                <Button onClick={() => setStep("review")}>Next</Button>
              </>
            )}
          </div>
          {mode === "new" && (
            <Button variant="ghost" className="w-full" onClick={() => setStep("pick")}>
              Ganti order
            </Button>
          )}
        </section>
      )}

      {step === "review" && detail && blob && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold">Review & kirim</h2>

          <div className="rounded-xl bg-slate-50 p-4 text-sm space-y-2">
            <div className="font-medium">{detail.salesorderNo}</div>
            {detail.customerName && <div>Buyer: {detail.customerName}</div>}
            <div>Durasi video: {formatDuration(durationSec)}</div>
            <div>Ukuran: {(blob.size / (1024 * 1024)).toFixed(2)} MB</div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700">
              Detail produk
            </h3>
            <ul className="divide-y rounded-xl border border-slate-200 bg-white text-sm">
              {detail.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="font-medium">{item.productName}</span>
                    <span className="block text-xs text-slate-500">
                      {item.jubelioItemCode}
                    </span>
                  </span>
                  <span className="tabular-nums text-slate-600">×{item.qty}</span>
                </li>
              ))}
            </ul>
          </div>

          {previewUrl && (
            <video
              src={previewUrl}
              controls
              playsInline
              className="w-full rounded-xl bg-black"
            />
          )}

          {submitError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {submitError}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={submitting}
              onClick={() => setStep("record")}
            >
              Kembali
            </Button>
            <Button
              className="flex-1"
              disabled={submitting}
              onClick={onClickKirim}
            >
              {submitting ? "Mengirim…" : "Kirim rekaman"}
            </Button>
          </div>
        </section>
      )}

      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50">
          <div className="rounded-2xl bg-white px-8 py-6 text-center shadow-xl">
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
            <p className="font-medium">Mengunggah video…</p>
            <p className="text-sm text-slate-500">Jangan tutup halaman ini</p>
          </div>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ganti video lama?</AlertDialogTitle>
            <AlertDialogDescription>
              Yakin ingin save video ini untuk mengubah video lama pada order{" "}
              {detail?.salesorderNo}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void submitVideo();
              }}
            >
              Ya, ganti video
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
