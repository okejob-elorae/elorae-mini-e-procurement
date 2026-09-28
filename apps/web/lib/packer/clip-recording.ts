/**
 * Import-free on purpose: client components render the result, so pulling in
 * the `@elorae/db` barrel here would drag Prisma into the browser bundle.
 */

export type PackingClipTimes = {
  recordedAt: Date | string;
  replacedAt: Date | string | null;
  recordedByName: string | null;
  updatedByName: string | null;
};

export type ClipRecording = {
  at: Date;
  byName: string | null;
  isRerecord: boolean;
};

/**
 * A re-record overwrites the clip in place and stamps `replacedAt`, leaving
 * `recordedAt` on the FIRST recording — so the clip that plays was taken at
 * `replacedAt`, by `updatedBy`, whenever it has been replaced.
 */
export function currentClipRecording(times: PackingClipTimes): ClipRecording {
  if (times.replacedAt !== null) {
    return { at: new Date(times.replacedAt), byName: times.updatedByName, isRerecord: true };
  }
  return { at: new Date(times.recordedAt), byName: times.recordedByName, isRerecord: false };
}

export const PACKING_VIDEO_RECORDING_SELECT = {
  videoUrl: true,
  recordedAt: true,
  replacedAt: true,
  recordedBy: { select: { name: true, email: true } },
  updatedBy: { select: { name: true, email: true } },
} as const;

type RecorderRow = { name: string | null; email: string } | null;

export type PackingVideoRecordingRow = {
  recordedAt: Date;
  replacedAt: Date | null;
  recordedBy: RecorderRow;
  updatedBy: RecorderRow;
};

function recorderName(user: RecorderRow): string | null {
  return user ? user.name ?? user.email : null;
}

export function packingVideoRecordingOf(row: PackingVideoRecordingRow): ClipRecording {
  return currentClipRecording({
    recordedAt: row.recordedAt,
    replacedAt: row.replacedAt,
    recordedByName: recorderName(row.recordedBy),
    updatedByName: recorderName(row.updatedBy),
  });
}
