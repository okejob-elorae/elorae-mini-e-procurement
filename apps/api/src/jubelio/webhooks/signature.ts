import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Matches Jubelio's documented Node.js example:
 *   const hmac = CryptoJS.HmacSHA256(payload + secretkey, secretkey);
 *   const sign = hmac.toString(CryptoJS.enc.Hex);
 *
 * That is HMAC-SHA256 with key=secret over data=(rawBody + secret).
 * (Jubelio's docs text says "SHA256" but the code example is HMAC — the
 * code is the source of truth; verified 2026-05-28 from a real delivery.)
 */
export function computeJubelioSignature(rawBody: string | Buffer, secret: string): string {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return createHmac("sha256", secret).update(body + secret).digest("hex");
}

export function verifyJubelioSignature(
  rawBody: string | Buffer,
  secret: string,
  received: string | undefined,
): boolean {
  if (!received) return false;
  const expected = computeJubelioSignature(rawBody, secret);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function payloadHash(rawBody: string | Buffer): string {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return createHash("sha256").update(body).digest("hex");
}
