/** Prefer 720p for small uploads; browsers may deliver less. */
export const PACKER_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1280, max: 1280 },
  height: { ideal: 720, max: 720 },
  frameRate: { ideal: 30, max: 30 },
};

/** ~4 Mbps @ 720p30 — native camera encode (no canvas re-clock). */
export const PACKER_VIDEO_BITS_PER_SECOND = 4_000_000;

/** Debounce duplicate scans on the same camera. */
export const SCAN_COOLDOWN_MS = 900;
/** Aggressive scan loop on the visible camera tab (ready / idle). */
export const SCAN_TICK_VISIBLE_MS = 16;
/**
 * While recording, almost idle the camera barcode decoder so encode stays smooth.
 * End-scan still works (USB wedge / occasional camera read).
 */
export const SCAN_TICK_RECORDING_MS = 1200;
/** Background scan on hidden camera tabs (keep ready, stay light). */
export const SCAN_TICK_HIDDEN_MS = 800;
/** Green border flash after successful scan. */
export const SCAN_SUCCESS_FLASH_MS = 700;
/** Silent: ignore end scans for 10s after start. */
export const MIN_RECORD_BEFORE_END_MS = 10_000;
export const MISMATCH_DEBOUNCE_MS = 2000;

/** Prefer VP8 over VP9 — VP9 software encode often stutters on mid-tier devices. */
export function pickPackerRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
    return "video/webm;codecs=vp8";
  }
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    return "video/webm;codecs=vp9";
  }
  if (MediaRecorder.isTypeSupported("video/webm")) {
    return "video/webm";
  }
  return undefined;
}
