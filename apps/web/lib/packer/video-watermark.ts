/** Burn RESI + PACKING DATE into the recorded packing video (top-left). */

export type WatermarkLabels = {
  resi: string;
  packingDate: string;
};

const MONTHS_MMM = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Format: DD-MMM-YYYY hh:mm (e.g. 11-Sep-2026 10:16) */
export function formatPackingDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${MONTHS_MMM[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type WatermarkedRecorder = {
  recorder: MediaRecorder;
  /** Stop the draw loop (call when recorder stops / restart). */
  stopOverlay: () => void;
};

/**
 * Record from a canvas that composites the live camera + watermark text.
 * Preview `<video>` stays unchanged; only the uploaded file gets the overlay.
 */
export function startWatermarkedRecorder(
  video: HTMLVideoElement,
  cameraStream: MediaStream,
  labels: WatermarkLabels,
  opts: { mimeType?: string; videoBitsPerSecond: number },
): WatermarkedRecorder {
  const track = cameraStream.getVideoTracks()[0];
  const settings = track?.getSettings() ?? {};
  // Prefer the live frame size so we don't upscale a soft camera feed.
  const width = Math.min(
    1920,
    Math.max(640, video.videoWidth || settings.width || 1280),
  );
  const height = Math.min(
    1080,
    Math.max(360, video.videoHeight || settings.height || 720),
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("Canvas 2D tidak tersedia");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const line1 = `RESI : ${labels.resi}`;
  const line2 = `PACKING DATE : ${labels.packingDate}`;
  const fontPx = Math.max(18, Math.round(height * 0.035));
  const padX = Math.round(width * 0.018);
  const padY = Math.round(height * 0.02);
  const lineGap = Math.round(fontPx * 1.35);

  let raf = 0;
  let alive = true;

  const draw = () => {
    if (!alive) return;
    ctx.drawImage(video, 0, 0, width, height);

    ctx.font = `bold ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    const textW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
    const boxW = textW + padX * 2;
    const boxH = lineGap * 2 + padY * 1.4;

    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(padX * 0.6, padY * 0.6, boxW, boxH);

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    ctx.fillText(line1, padX, padY);
    ctx.fillText(line2, padX, padY + lineGap);

    raf = requestAnimationFrame(draw);
  };
  draw();

  const outStream = canvas.captureStream(30);
  const recorder = new MediaRecorder(outStream, {
    ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
    videoBitsPerSecond: opts.videoBitsPerSecond,
  });

  return {
    recorder,
    stopOverlay: () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      outStream.getTracks().forEach((t) => t.stop());
    },
  };
}
