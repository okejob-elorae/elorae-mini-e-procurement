"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  findPoolItemByTracking,
  type PackerPoolItem,
} from "@/lib/packer/pool";
import { PackerSignOutButton } from "./PackerSignOutButton";
import { PackerPoolList } from "./PackerPoolList";
import {
  PackerCameraPanel,
  type PackerCameraPanelHandle,
} from "./PackerCameraPanel";

type CameraDevice = {
  deviceId: string;
  label: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function listVideoInputs(retries = 6): Promise<MediaDeviceInfo[]> {
  let last: MediaDeviceInfo[] = [];
  for (let i = 0; i < retries; i++) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter(
      (d) => d.kind === "videoinput" && Boolean(d.deviceId),
    );
    last = videos;
    const labeled = videos.filter((d) => d.label.trim().length > 0);
    if (labeled.length > 0) return videos;
    if (videos.length > 0 && i >= 2) return videos;
    await sleep(180 + i * 120);
  }
  return last;
}

export function PackerDashboard() {
  const [pool, setPool] = useState<PackerPoolItem[]>([]);
  const [poolLoading, setPoolLoading] = useState(true);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [activeCameraId, setActiveCameraId] = useState("");
  const [bootError, setBootError] = useState("");
  const [booting, setBooting] = useState(true);
  const [recordingByCamera, setRecordingByCamera] = useState<
    Record<string, string | null>
  >({});

  const panelRefs = useRef<Record<string, PackerCameraPanelHandle | null>>({});
  const keyboardBufRef = useRef("");
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  const bootGenRef = useRef(0);
  const poolRef = useRef<PackerPoolItem[]>([]);

  useEffect(() => {
    poolRef.current = pool;
  }, [pool]);

  const findInPool = useCallback((code: string) => {
    return findPoolItemByTracking(poolRef.current, code);
  }, []);

  const handleRemoveFromPool = useCallback((salesOrderId: string) => {
    setPool((prev) => prev.filter((item) => item.id !== salesOrderId));
  }, []);

  const handleRecordingChange = useCallback(
    (deviceId: string, code: string | null) => {
      setRecordingByCamera((prev) => {
        if (prev[deviceId] === code) return prev;
        return { ...prev, [deviceId]: code };
      });
    },
    [],
  );

  const recordingCode =
    Object.values(recordingByCamera).find((c) => c != null && c !== "") ?? null;

  const focusScannerInput = () => {
    hiddenInputRef.current?.focus();
  };

  const refreshPool = useCallback(async () => {
    setPoolLoading(true);
    try {
      const res = await fetch("/api/packer/pool");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Gagal muat pool (${res.status})`);
      }
      setPool((body.items ?? []) as PackerPoolItem[]);
    } catch (e) {
      console.error(e);
    } finally {
      setPoolLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPool();
  }, [refreshPool]);

  const applyCameraList = useCallback((videoInputs: MediaDeviceInfo[]) => {
    const mapped = videoInputs.map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label?.trim() || `Kamera ${i + 1}`,
    }));
    setCameras(mapped);
    setActiveCameraId((prev) => {
      if (prev && mapped.some((c) => c.deviceId === prev)) return prev;
      return mapped[0]?.deviceId ?? "";
    });
    focusScannerInput();
  }, []);

  const bootCameras = useCallback(async () => {
    const gen = ++bootGenRef.current;
    setBooting(true);
    setBootError("");
    let probe: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setBootError("Browser tidak mendukung multi-kamera.");
        return;
      }

      probe = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      const videoInputs = await listVideoInputs();
      if (gen !== bootGenRef.current) return;

      if (videoInputs.length === 0) {
        setBootError("Tidak ada kamera terdeteksi.");
        setCameras([]);
        return;
      }

      applyCameraList(videoInputs);
    } catch {
      if (gen === bootGenRef.current) {
        setBootError("Izinkan akses kamera untuk melanjutkan.");
      }
    } finally {
      probe?.getTracks().forEach((t) => t.stop());
      if (gen === bootGenRef.current) setBooting(false);
    }
  }, [applyCameraList]);

  useEffect(() => {
    void bootCameras();

    const onDeviceChange = () => {
      void bootCameras();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      bootGenRef.current += 1;
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        onDeviceChange,
      );
    };
  }, [bootCameras]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter") {
        const buf = keyboardBufRef.current;
        keyboardBufRef.current = "";
        if (!buf) return;
        const handler = panelRefs.current[activeCameraId];
        handler?.handleKeyboardScan(buf);
        return;
      }
      if (ev.key.length === 1) {
        keyboardBufRef.current += ev.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeCameraId]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-white">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Record Packer</h1>
          <p className="text-xs text-zinc-400">
            {booting
              ? "Mendeteksi kamera…"
              : `${cameras.length} kamera · pool dari order ber-resi`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void bootCameras()}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            Muat kamera
          </button>
          <PackerSignOutButton />
        </div>
      </header>

      {bootError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-red-400">{bootError}</p>
          <button
            type="button"
            onClick={() => void bootCameras()}
            className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black"
          >
            Coba lagi
          </button>
        </div>
      ) : booting && cameras.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-400">
          Memuat daftar kamera…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <PackerPoolList
            items={pool}
            recordingCode={recordingCode}
            loading={poolLoading}
            onRefresh={() => void refreshPool()}
          />

          <main className="flex min-w-0 flex-1 flex-col">
            {cameras.length > 1 && (
              <div
                className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-800 px-2 py-2"
                role="tablist"
              >
                {cameras.map((cam) => {
                  const active = cam.deviceId === activeCameraId;
                  const rec = recordingByCamera[cam.deviceId];
                  return (
                    <button
                      key={cam.deviceId}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveCameraId(cam.deviceId)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
                        active
                          ? "bg-white text-black"
                          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      {cam.label}
                      {rec ? " ●" : ""}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="relative min-h-0 flex-1">
              {cameras.map((cam) => (
                <PackerCameraPanel
                  key={cam.deviceId}
                  ref={(node) => {
                    panelRefs.current[cam.deviceId] = node;
                  }}
                  deviceId={cam.deviceId}
                  label={cam.label}
                  visible={cam.deviceId === activeCameraId}
                  findInPool={findInPool}
                  onRemoveFromPool={handleRemoveFromPool}
                  onRecordingChange={handleRecordingChange}
                />
              ))}
            </div>
          </main>
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
