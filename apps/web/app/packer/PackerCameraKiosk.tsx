"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { barcodesMatch, normalizeBarcode } from "@/lib/packer/barcode";
import { PackerSignOutButton } from "./PackerSignOutButton";

type Phase = "ready" | "recording" | "uploading" | "upload_failed";

type PendingUpload = {
  blob: Blob;
  durationSec: number;
  barcode: string;
};

/** Debounce duplicate start scans (camera may read the same label repeatedly). */
const READY_SCAN_COOLDOWN_MS = 1500;
/** Ignore end scans right after start — label often still in frame. */
const MIN_RECORD_BEFORE_END_MS = 1500;
/** Debounce mismatch toasts while recording. */
const MISMATCH_DEBOUNCE_MS = 2000;
/** 720p cap so packing clips stay small enough to upload on warehouse uplink. */
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
};
const VIDEO_BITS_PER_SECOND = 1_200_000;

export function PackerCameraKiosk() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const startBarcodeRef = useRef("");
  const phaseRef = useRef<Phase>("ready");
  const lastReadyScanAtRef = useRef(0);
  const lastMismatchAtRef = useRef(0);
  const stopInProgressRef = useRef(false);
  const detectTimerRef = useRef<number | null>(null);
  const keyboardBufRef = useRef("");
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadRef = useRef<PendingUpload | null>(null);

  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [durationSec, setDurationSec] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [pendingBarcode, setPendingBarcode] = useState("");
  const durationTimerRef = useRef<number | null>(null);

  const setPhaseBoth = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const focusScannerInput = () => {
    hiddenInputRef.current?.focus();
  };

  const startDurationTick = () => {
    if (durationTimerRef.current != null) window.clearInterval(durationTimerRef.current);
    durationTimerRef.current = window.setInterval(() => {
      setDurationSec((Date.now() - startedAtRef.current) / 1000);
    }, 200);
  };

  const stopDurationTick = () => {
    if (durationTimerRef.current != null) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  };

  const startRecording = useCallback((barcode: string) => {
    const stream = streamRef.current;
    if (!stream) {
      setError("Kamera belum siap");
      return;
    }
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : undefined;
    const recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });
    recorderRef.current = recorder;
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.start(1000);
    startBarcodeRef.current = barcode;
    startedAtRef.current = Date.now();
    setDurationSec(0);
    setError("");
    setPhaseBoth("recording");
    startDurationTick();
  }, []);

  const clearPendingUpload = useCallback(() => {
    pendingUploadRef.current = null;
    setPendingBarcode("");
    startBarcodeRef.current = "";
    setDurationSec(0);
  }, []);

  const submitBlob = useCallback(async (blob: Blob, duration: number, barcode: string) => {
    pendingUploadRef.current = { blob, durationSec: duration, barcode };
    setPendingBarcode(barcode);
    setPhaseBoth("uploading");
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", blob, `packing-${Date.now()}.webm`);
      fd.append("durationSec", String(duration));
      fd.append("barcode", barcode);
      const res = await fetch("/api/packer/upload", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Gagal kirim (${res.status})`);
      }
      toast.success("Rekaman terkirim");
      clearPendingUpload();
      setPhaseBoth("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal kirim video";
      setError(msg);
      toast.error(msg);
      setPhaseBoth("upload_failed");
    } finally {
      stopInProgressRef.current = false;
      focusScannerInput();
    }
  }, [clearPendingUpload]);

  const resendPending = useCallback(() => {
    const pending = pendingUploadRef.current;
    if (!pending || phaseRef.current === "uploading") return;
    void submitBlob(pending.blob, pending.durationSec, pending.barcode);
  }, [submitBlob]);

  const discardPending = useCallback(() => {
    clearPendingUpload();
    setError("");
    setPhaseBoth("ready");
    focusScannerInput();
    toast.message("Rekaman dibuang");
  }, [clearPendingUpload]);

  const stopAndSubmit = useCallback(() => {
    if (stopInProgressRef.current) return;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setError("Rekaman sudah berhenti. Scan barcode lagi untuk mulai.");
      setPhaseBoth("ready");
      startBarcodeRef.current = "";
      stopInProgressRef.current = false;
      return;
    }
    stopInProgressRef.current = true;
    stopDurationTick();
    const duration = (Date.now() - startedAtRef.current) / 1000;
    const barcode = startBarcodeRef.current;
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "video/webm",
      });
      recorderRef.current = null;
      if (blob.size === 0) {
        stopInProgressRef.current = false;
        setError("Rekaman kosong. Scan barcode lagi untuk mulai.");
        toast.error("Rekaman kosong");
        setPhaseBoth("ready");
        startBarcodeRef.current = "";
        focusScannerInput();
        return;
      }
      void submitBlob(blob, duration, barcode);
    };
    recorder.stop();
  }, [submitBlob]);

  const onBarcode = useCallback(
    (raw: string) => {
      const code = normalizeBarcode(raw);
      if (!code) return;

      const current = phaseRef.current;
      if (current === "uploading" || current === "upload_failed") return;

      const now = Date.now();

      if (current === "ready") {
        if (now - lastReadyScanAtRef.current < READY_SCAN_COOLDOWN_MS) return;
        lastReadyScanAtRef.current = now;
        setError("");
        startRecording(code);
        return;
      }

      if (current === "recording") {
        if (now - startedAtRef.current < MIN_RECORD_BEFORE_END_MS) return;

        if (!barcodesMatch(startBarcodeRef.current, code)) {
          if (now - lastMismatchAtRef.current < MISMATCH_DEBOUNCE_MS) return;
          lastMismatchAtRef.current = now;
          setError(
            `Barcode tidak sama. Awal: "${startBarcodeRef.current}" · Scan: "${code}"`,
          );
          toast.error("Barcode tidak sama");
          return;
        }

        setError("");
        stopAndSubmit();
      }
    },
    [startRecording, stopAndSubmit],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootCamera() {
      setCameraError("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: VIDEO_CONSTRAINTS,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        focusScannerInput();
      } catch {
        setCameraError("Tidak bisa mengakses kamera. Izinkan kamera di browser.");
      }
    }

    void bootCamera();
    return () => {
      cancelled = true;
      stopDurationTick();
      if (detectTimerRef.current != null) window.clearTimeout(detectTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let alive = true;
    let scanner: { scan: () => Promise<string | null>; stop: () => void } | null = null;

    void import("@/lib/packer/scan-frame")
      .then(({ createVideoBarcodeScanner }) => createVideoBarcodeScanner(video))
      .then((created) => {
        if (!alive) {
          created.stop();
          return;
        }
        scanner = created;

        const tick = async () => {
          if (!alive || !scanner) return;
          if (phaseRef.current === "ready" || phaseRef.current === "recording") {
            setScanning(true);
            try {
              const value = await scanner.scan();
              if (value) onBarcode(value);
            } catch {
              // no code in frame
            } finally {
              setScanning(false);
            }
          }
          if (alive) {
            detectTimerRef.current = window.setTimeout(tick, 120);
          }
        };
        detectTimerRef.current = window.setTimeout(tick, 800);
      })
      .catch(() => {
        setCameraError("Scanner barcode gagal dimuat. Refresh halaman atau gunakan scanner USB.");
      });

    return () => {
      alive = false;
      if (detectTimerRef.current != null) window.clearTimeout(detectTimerRef.current);
      scanner?.stop();
    };
  }, [onBarcode]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter") {
        const buf = keyboardBufRef.current;
        keyboardBufRef.current = "";
        if (buf) onBarcode(buf);
        return;
      }
      if (ev.key.length === 1) {
        keyboardBufRef.current += ev.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBarcode]);

  const statusLabel =
    phase === "recording"
      ? "Rekaman berjalan — scan barcode yang sama untuk selesai"
      : phase === "uploading"
        ? "Mengirim rekaman…"
        : phase === "upload_failed"
          ? "Upload gagal — kirim ulang atau buang"
          : "Siap — arahkan barcode ke kotak";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="h-full w-full object-cover"
      />

      {phase === "ready" && (
        <>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[38%] w-[86%] max-w-4xl rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          <p className="pointer-events-none absolute bottom-28 left-1/2 w-[min(90vw,28rem)] -translate-x-1/2 text-center text-sm text-white/90 drop-shadow">
            Luruskan barcode Code128 di dalam kotak. Naikkan brightness HP, hindari silau.
            {scanning ? " Mencari…" : ""} Scanner USB juga didukung.
          </p>
        </>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div
          className={`pointer-events-none rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${
            phase === "recording"
              ? "bg-red-600"
              : phase === "uploading"
                ? "bg-amber-500 text-black"
                : phase === "upload_failed"
                  ? "bg-red-700"
                  : "bg-black/60"
          }`}
        >
          {statusLabel}
        </div>
        <div className="pointer-events-auto rounded-full bg-black/50 px-3 py-2">
          <PackerSignOutButton />
        </div>
      </div>

      {phase === "recording" && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 font-mono text-3xl tabular-nums drop-shadow">
          {String(Math.floor(durationSec / 60)).padStart(2, "0")}:
          {String(Math.floor(durationSec % 60)).padStart(2, "0")}
        </div>
      )}

      {phase === "upload_failed" && (
        <div className="absolute bottom-8 left-1/2 flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col items-center gap-3">
          <div className="w-full rounded-xl bg-red-600/95 px-4 py-3 text-center text-sm">
            {error || "Gagal kirim video"}
            {pendingBarcode ? (
              <div className="mt-1 font-mono text-xs text-white/90">Barcode: {pendingBarcode}</div>
            ) : null}
          </div>
          <div className="flex w-full gap-3">
            <button
              type="button"
              onClick={resendPending}
              className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black"
            >
              Kirim ulang
            </button>
            <button
              type="button"
              onClick={discardPending}
              className="flex-1 rounded-xl bg-white/20 px-4 py-3 text-sm font-semibold text-white"
            >
              Buang
            </button>
          </div>
        </div>
      )}

      {(error || cameraError) && phase !== "upload_failed" && (
        <div className="absolute bottom-24 left-1/2 w-[min(90vw,32rem)] -translate-x-1/2 rounded-xl bg-red-600/90 px-4 py-3 text-center text-sm">
          {cameraError || error}
        </div>
      )}

      <input
        ref={hiddenInputRef}
        autoFocus
        aria-label="Barcode scanner"
        className="absolute h-px w-px opacity-0"
        onBlur={focusScannerInput}
      />
    </div>
  );
}
