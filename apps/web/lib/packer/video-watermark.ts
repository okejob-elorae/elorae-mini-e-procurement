/**
 * Packer live recorder — camera MediaStream only.
 * No canvas / watermark path: those re-clocked frames and made downloads choppy.
 */

export type PackerRecorder = {
  recorder: MediaRecorder;
  stop: () => void;
};

/** Record the live camera track directly for smooth start→end playback. */
export function startPackerRecorder(
  cameraStream: MediaStream,
  opts: { mimeType?: string; videoBitsPerSecond: number },
): PackerRecorder {
  if (!cameraStream.getVideoTracks()[0]) {
    throw new Error("Kamera tidak punya video track");
  }

  const recorder = new MediaRecorder(cameraStream, {
    ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
    videoBitsPerSecond: opts.videoBitsPerSecond,
  });

  return {
    recorder,
    stop: () => {},
  };
}
