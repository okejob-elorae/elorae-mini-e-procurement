/** 720p cap so packing clips stay small enough to upload on warehouse uplink. */
export const PACKER_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
};

export const PACKER_VIDEO_BITS_PER_SECOND = 1_200_000;

/** Debounce duplicate scans on the same camera. */
export const SCAN_COOLDOWN_MS = 900;
/** Aggressive scan loop on the visible camera tab. */
export const SCAN_TICK_VISIBLE_MS = 16;
/** Background scan on hidden camera tabs (keep ready, stay light). */
export const SCAN_TICK_HIDDEN_MS = 800;
/** Green border flash after successful scan. */
export const SCAN_SUCCESS_FLASH_MS = 700;
/** Silent: ignore end scans for 10s after start. */
export const MIN_RECORD_BEFORE_END_MS = 10_000;
export const MISMATCH_DEBOUNCE_MS = 2000;
