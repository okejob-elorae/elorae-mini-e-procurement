"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { toast } from "sonner";
import { barcodesMatch, extractTrackingCandidate, isAcceptableScanCode } from "@/lib/packer/barcode";
import {
  MIN_RECORD_BEFORE_END_MS,
  MISMATCH_DEBOUNCE_MS,
  PACKER_VIDEO_BITS_PER_SECOND,
  PACKER_VIDEO_CONSTRAINTS,
  SCAN_COOLDOWN_MS,
  SCAN_SUCCESS_FLASH_MS,
  SCAN_TICK_HIDDEN_MS,
  SCAN_TICK_RECORDING_MS,
  SCAN_TICK_VISIBLE_MS,
  pickPackerRecorderMimeType,
} from "@/lib/packer/constants";
import { playScanSuccessBeep } from "@/lib/packer/scan-feedback";
import type { PackerPoolItem } from "@/lib/packer/pool";
import { startPackerRecorder } from "@/lib/packer/video-watermark";

type Phase = "ready" | "recording" | "uploading" | "upload_failed";

type PendingUpload = {
  blob: Blob;
  durationSec: number;
  barcode: string;
  salesOrderId: string;
};

export type PackerCameraPanelHandle = {
  handleKeyboardScan: (raw: string) => void;
};

type PackerCameraPanelProps = {
  deviceId: string;
  label: string;
  visible: boolean;
  findInPool: (code: string) => PackerPoolItem | null;
  onRemoveFromPool: (salesOrderId: string) => void;
  onRecordingChange: (deviceId: string, code: string | null) => void;
};

export const PackerCameraPanel = forwardRef<PackerCameraPanelHandle, PackerCameraPanelProps>(
  function PackerCameraPanel(
    {
      deviceId,
      label,
      visible,
      findInPool,
      onRemoveFromPool,
      onRecordingChange,
    },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const stopOverlayRef = useRef<(() => void) | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startedAtRef = useRef(0);
    const recordingCodeRef = useRef("");
    const recordingOrderIdRef = useRef("");
    const phaseRef = useRef<Phase>("ready");
    const lastScanAtRef = useRef(0);
    const lastMismatchAtRef = useRef(0);
    const stopInProgressRef = useRef(false);
    const detectTimerRef = useRef<number | null>(null);
    const pendingUploadRef = useRef<PendingUpload | null>(null);
    const durationTimerRef = useRef<number | null>(null);
    const onRecordingChangeRef = useRef(onRecordingChange);
    const scanFlashTimerRef = useRef<number | null>(null);

    useEffect(() => {
      onRecordingChangeRef.current = onRecordingChange;
    }, [onRecordingChange]);

    const [phase, setPhase] = useState<Phase>("ready");
    const [error, setError] = useState("");
    const [cameraError, setCameraError] = useState("");
    const [durationSec, setDurationSec] = useState(0);
    const [scanning, setScanning] = useState(false);
    const [scanFlash, setScanFlash] = useState(false);
    const [pendingBarcode, setPendingBarcode] = useState("");
    const scanningUiRef = useRef(false);
    const visibleRef = useRef(visible);

    useEffect(() => {
      visibleRef.current = visible;
    }, [visible]);

    const signalScanSuccess = useCallback(() => {
      setScanFlash(true);
      playScanSuccessBeep();
      if (scanFlashTimerRef.current != null) {
        window.clearTimeout(scanFlashTimerRef.current);
      }
      scanFlashTimerRef.current = window.setTimeout(() => {
        setScanFlash(false);
        scanFlashTimerRef.current = null;
      }, SCAN_SUCCESS_FLASH_MS);
    }, []);

    const setPhaseBoth = (next: Phase) => {
      phaseRef.current = next;
      setPhase(next);
    };

    const syncRecording = useCallback((code: string | null) => {
      recordingCodeRef.current = code ?? "";
      onRecordingChangeRef.current(deviceId, code);
    }, [deviceId]);

    const stopDurationTick = () => {
      if (durationTimerRef.current != null) {
        window.clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    };

    const startDurationTick = () => {
      if (durationTimerRef.current != null) window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = window.setInterval(() => {
        setDurationSec((Date.now() - startedAtRef.current) / 1000);
      }, 200);
    };

    const startRecording = useCallback(
      (code: string, salesOrderId: string) => {
        const stream = streamRef.current;
        if (!stream) {
          setError("Kamera belum siap");
          return;
        }
        chunksRef.current = [];
        const mime = pickPackerRecorderMimeType();

        try {
          stopOverlayRef.current?.();
          const { recorder, stop } = startPackerRecorder(stream, {
            mimeType: mime,
            videoBitsPerSecond: PACKER_VIDEO_BITS_PER_SECOND,
          });
          stopOverlayRef.current = stop;
          recorderRef.current = recorder;
          recorder.ondataavailable = (ev) => {
            if (ev.data.size > 0) chunksRef.current.push(ev.data);
          };
          // Single cluster on stop — steadier framerate than 1s timeslices.
          recorder.start();
        } catch {
          setError("Gagal mulai rekaman");
          toast.error("Gagal mulai rekaman");
          return;
        }

        recordingOrderIdRef.current = salesOrderId;
        syncRecording(code);
        startedAtRef.current = Date.now();
        setDurationSec(0);
        setError("");
        setPhaseBoth("recording");
        startDurationTick();
        toast.message(`${label}: rekam ${code}`);
      },
      [label, syncRecording],
    );

    const clearPendingUpload = useCallback(() => {
      pendingUploadRef.current = null;
      setPendingBarcode("");
      recordingOrderIdRef.current = "";
      syncRecording(null);
      setDurationSec(0);
    }, [syncRecording]);

    const submitBlob = useCallback(
      async (blob: Blob, duration: number, barcode: string, salesOrderId: string) => {
        pendingUploadRef.current = { blob, durationSec: duration, barcode, salesOrderId };
        setPendingBarcode(barcode);
        setPhaseBoth("uploading");
        setError("");
        try {
          const fd = new FormData();
          fd.append("file", blob, `packing-${Date.now()}.webm`);
          fd.append("durationSec", String(duration));
          fd.append("barcode", barcode);
          fd.append("salesOrderId", salesOrderId);
          const res = await fetch("/api/packer/upload", { method: "POST", body: fd });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(body.error || `Gagal kirim (${res.status})`);
          }
          toast.success(`${label}: rekaman terkirim`);
          onRemoveFromPool(salesOrderId);
          clearPendingUpload();
          setPhaseBoth("ready");
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Gagal kirim video";
          setError(msg);
          toast.error(msg);
          setPhaseBoth("upload_failed");
        } finally {
          stopInProgressRef.current = false;
        }
      },
      [label, onRemoveFromPool, clearPendingUpload],
    );

    const resendPending = useCallback(() => {
      const pending = pendingUploadRef.current;
      if (!pending || phaseRef.current === "uploading") return;
      void submitBlob(
        pending.blob,
        pending.durationSec,
        pending.barcode,
        pending.salesOrderId,
      );
    }, [submitBlob]);

    const discardPending = useCallback(() => {
      clearPendingUpload();
      setError("");
      setPhaseBoth("ready");
      toast.message("Rekaman dibuang");
    }, [clearPendingUpload]);

    const restartRecording = useCallback(() => {
      if (phaseRef.current !== "recording") return;
      stopDurationTick();
      stopInProgressRef.current = false;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
      stopOverlayRef.current?.();
      stopOverlayRef.current = null;
      recorderRef.current = null;
      chunksRef.current = [];
      recordingOrderIdRef.current = "";
      syncRecording(null);
      setDurationSec(0);
      setError("");
      setPhaseBoth("ready");
    }, [syncRecording]);

    const stopAndSubmit = useCallback(() => {
      if (stopInProgressRef.current) return;
      const recorder = recorderRef.current;
      const barcode = recordingCodeRef.current;
      const salesOrderId = recordingOrderIdRef.current;
      if (!recorder || recorder.state === "inactive") {
        setError("Rekaman sudah berhenti.");
        syncRecording(null);
        setPhaseBoth("ready");
        stopInProgressRef.current = false;
        return;
      }
      if (!salesOrderId) {
        setError("Order tidak ditemukan untuk upload.");
        toast.error("Order tidak ditemukan");
        stopInProgressRef.current = false;
        return;
      }
      stopInProgressRef.current = true;
      stopDurationTick();
      const duration = (Date.now() - startedAtRef.current) / 1000;
      const mimeType = recorder.mimeType || "video/webm";
      recorder.onstop = () => {
        stopOverlayRef.current?.();
        stopOverlayRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        recorderRef.current = null;
        if (blob.size === 0) {
          stopInProgressRef.current = false;
          setError("Rekaman kosong.");
          toast.error("Rekaman kosong");
          syncRecording(null);
          setPhaseBoth("ready");
          return;
        }
        void submitBlob(blob, duration, barcode, salesOrderId);
      };
      recorder.stop();
    }, [submitBlob, syncRecording]);

    const onBarcode = useCallback(
      (raw: string) => {
        const code = extractTrackingCandidate(raw);
        if (!code || !isAcceptableScanCode(code)) return;

        const current = phaseRef.current;
        if (current === "uploading" || current === "upload_failed") return;

        const now = Date.now();
        if (now - lastScanAtRef.current < SCAN_COOLDOWN_MS) return;
        lastScanAtRef.current = now;

        if (current === "recording") {
          if (now - startedAtRef.current < MIN_RECORD_BEFORE_END_MS) return;

          if (!barcodesMatch(recordingCodeRef.current, code)) {
            if (now - lastMismatchAtRef.current < MISMATCH_DEBOUNCE_MS) return;
            lastMismatchAtRef.current = now;
            setError(
              `Resi tidak sama. Rekam: "${recordingCodeRef.current}" · Scan: "${code}"`,
            );
            toast.error("Resi tidak sama");
            return;
          }

          setError("");
          signalScanSuccess();
          stopAndSubmit();
          return;
        }

        // ready — only start if barcode matches a pool trackingNumber
        const matched = findInPool(code);
        if (!matched) {
          if (now - lastMismatchAtRef.current < MISMATCH_DEBOUNCE_MS) return;
          lastMismatchAtRef.current = now;
          setError(`Resi "${code}" tidak ada di pool order`);
          toast.error("Resi tidak ada di pool");
          return;
        }

        setError("");
        signalScanSuccess();
        startRecording(matched.trackingNumber, matched.id);
      },
      [findInPool, startRecording, stopAndSubmit, signalScanSuccess],
    );

    useImperativeHandle(ref, () => ({
      handleKeyboardScan: onBarcode,
    }));

    useEffect(() => {
      let cancelled = false;

      async function bootCamera() {
        setCameraError("");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              ...PACKER_VIDEO_CONSTRAINTS,
              deviceId: { exact: deviceId },
            },
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
        } catch {
          setCameraError(`Kamera "${label}" tidak bisa diakses.`);
        }
      }

      void bootCamera();
      return () => {
        cancelled = true;
        stopDurationTick();
        if (detectTimerRef.current != null) window.clearTimeout(detectTimerRef.current);
        if (scanFlashTimerRef.current != null) window.clearTimeout(scanFlashTimerRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        stopOverlayRef.current?.();
        stopOverlayRef.current = null;
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      };
    }, [deviceId, label]);

    useEffect(() => {
      return () => {
        onRecordingChangeRef.current(deviceId, null);
      };
    }, [deviceId]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      let alive = true;
      let scanner: { scan: () => Promise<string | null>; stop: () => void | Promise<void> } | null =
        null;

      const setScanningUi = (next: boolean) => {
        if (scanningUiRef.current === next) return;
        scanningUiRef.current = next;
        setScanning(next);
      };

      void import("@/lib/packer/scan-frame")
        .then(({ createVideoBarcodeScanner }) => createVideoBarcodeScanner(video))
        .then((created) => {
          if (!alive) {
            void created.stop();
            return;
          }
          scanner = created;

          const tick = async () => {
            if (!alive || !scanner) return;
            const phase = phaseRef.current;
            // Start (ready) + end (recording) both use barcode. While recording,
            // tick is throttled (SCAN_TICK_RECORDING_MS) so encode stays smooth.
            const canScan = phase === "ready" || phase === "recording";
            if (canScan && visibleRef.current) {
              setScanningUi(true);
              try {
                const value = await scanner.scan();
                if (value) onBarcode(value);
              } catch {
                // no code in frame
              }
            } else {
              setScanningUi(false);
            }
            if (alive) {
              const delay = !visibleRef.current
                ? SCAN_TICK_HIDDEN_MS
                : phase === "recording"
                  ? SCAN_TICK_RECORDING_MS
                  : SCAN_TICK_VISIBLE_MS;
              detectTimerRef.current = window.setTimeout(tick, delay);
            }
          };
          detectTimerRef.current = window.setTimeout(tick, 100);
        })
        .catch(() => {
          setCameraError("Scanner gagal dimuat.");
        });

      return () => {
        alive = false;
        if (detectTimerRef.current != null) window.clearTimeout(detectTimerRef.current);
        void scanner?.stop();
      };
    }, [onBarcode]);

    const statusLabel =
      phase === "recording"
        ? `Rekam — scan sama untuk selesai`
        : phase === "uploading"
          ? "Mengirim…"
          : phase === "upload_failed"
            ? "Upload gagal"
            : scanning
              ? "Mencari…"
              : "Siap scan";

    return (
      <div
        className={`absolute inset-0 bg-black ${
          visible ? "z-10" : "z-0 invisible pointer-events-none"
        }`}
        aria-hidden={!visible}
      >
        <video ref={videoRef} muted playsInline autoPlay className="h-full w-full object-cover" />

        {phase !== "uploading" && phase !== "upload_failed" && (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`h-[38%] w-[88%] max-w-3xl rounded-xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] transition-colors duration-200 ${
                  scanFlash
                    ? "border-green-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.35),0_0_28px_rgba(74,222,128,0.75)]"
                    : "border-white/70"
                }`}
              />
            </div>
            {phase === "ready" && (
              <p className="pointer-events-none absolute bottom-4 left-1/2 w-[min(92%,24rem)] -translate-x-1/2 text-center text-xs text-white/85">
                Scan resi yang ada di pool → rekam · Scan lagi (sama) → selesai
              </p>
            )}
            {phase === "recording" && (
              <p className="pointer-events-none absolute bottom-4 left-1/2 w-[min(92%,24rem)] -translate-x-1/2 text-center text-xs text-white/85">
                Scan resi yang sama untuk selesai
              </p>
            )}
          </>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-3">
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              phase === "recording"
                ? "bg-red-600"
                : phase === "uploading"
                  ? "bg-amber-400 text-black"
                  : phase === "upload_failed"
                    ? "bg-red-700"
                    : "bg-black/60"
            }`}
          >
            {statusLabel}
          </span>
          {phase === "recording" && (
            <span className="font-mono text-lg tabular-nums drop-shadow">
              {String(Math.floor(durationSec / 60)).padStart(2, "0")}:
              {String(Math.floor(durationSec % 60)).padStart(2, "0")}
            </span>
          )}
        </div>

        {phase === "recording" && (
          <div className="pointer-events-auto absolute right-3 top-12">
            <button
              type="button"
              onClick={restartRecording}
              className="rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white underline-offset-2 hover:underline"
            >
              Mulai ulang
            </button>
          </div>
        )}

        {phase === "upload_failed" && (
          <div className="absolute bottom-4 left-1/2 flex w-[min(92%,20rem)] -translate-x-1/2 flex-col gap-2">
            <div className="rounded-lg bg-red-600/95 px-3 py-2 text-center text-xs">
              {error || "Gagal kirim"}
              {pendingBarcode ? (
                <div className="mt-1 font-mono text-[10px]">{pendingBarcode}</div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={resendPending}
                className="flex-1 rounded-lg bg-white py-2 text-xs font-semibold text-black"
              >
                Kirim ulang
              </button>
              <button
                type="button"
                onClick={discardPending}
                className="flex-1 rounded-lg bg-white/20 py-2 text-xs font-semibold text-white"
              >
                Buang
              </button>
            </div>
          </div>
        )}

        {(error || cameraError) && phase !== "upload_failed" && (
          <div className="absolute bottom-16 left-1/2 w-[min(92%,24rem)] -translate-x-1/2 rounded-lg bg-red-600/90 px-3 py-2 text-center text-xs">
            {cameraError || error}
          </div>
        )}
      </div>
    );
  },
);
