export type R2KeyPrefix =
  | "collection-proofs"
  | "delivery-pod-proofs"
  | "visit-photos"
  | "settlement-proofs"
  | "delivery-proofs"
  | "packing-videos"
  | "field-returns"
  | "items";

const SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const EXT_PATTERN = /^[a-z0-9]{2,5}$/;

export class InvalidR2KeyError extends Error {
  readonly fragment: "segment" | "ext" | "segments";
  readonly value: unknown;

  constructor(fragment: "segment" | "ext" | "segments", value: unknown) {
    super(`invalid R2 key ${fragment}: ${JSON.stringify(value)}`);
    this.name = "InvalidR2KeyError";
    this.fragment = fragment;
    this.value = value;
  }
}

export function isSafeR2KeySegment(s: unknown): s is string {
  return typeof s === "string" && SEGMENT_PATTERN.test(s);
}

export function isSafeR2KeyExt(s: unknown): s is string {
  return typeof s === "string" && EXT_PATTERN.test(s);
}

/**
 * Every R2 key that contains a caller-supplied fragment is built here. A route that
 * interpolates a request value into a key by hand reopens path shaping (escaping its own
 * prefix, colliding with another record's objects). Routes should still reject a bad
 * fragment with a 400 via `isSafeR2KeySegment` before doing work; the throw is the backstop.
 */
export function buildR2Key(prefix: R2KeyPrefix, segments: string[], ext: string): string {
  if (segments.length === 0) throw new InvalidR2KeyError("segments", segments);
  for (const segment of segments) {
    if (!isSafeR2KeySegment(segment)) throw new InvalidR2KeyError("segment", segment);
  }
  if (!isSafeR2KeyExt(ext)) throw new InvalidR2KeyError("ext", ext);
  return `${prefix}/${segments.join("/")}.${ext}`;
}
