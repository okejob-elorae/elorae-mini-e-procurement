/* Multipart framing (boundaries, part headers, field values) on top of the file bytes. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * True when the declared `Content-Length` is already past what a legitimate upload can be, so the
 * route can refuse before `request.formData()` buffers the whole body. A missing or malformed
 * header passes: it is an early cheap rejection, and the per-file size checks stay authoritative.
 */
export function exceedsDeclaredLength(
  request: Request,
  maxFileBytes: number,
  maxFiles = 1,
): boolean {
  const header = request.headers.get("content-length");
  if (header === null) return false;
  const declared = Number(header);
  if (!Number.isFinite(declared)) return false;
  return declared > maxFileBytes * maxFiles + MULTIPART_OVERHEAD_BYTES;
}
