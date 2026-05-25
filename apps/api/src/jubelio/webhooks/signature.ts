import { createHash, timingSafeEqual } from "node:crypto";

export function computeJubelioSignature(rawBody: string | Buffer, secret: string): string {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return createHash("sha256").update(body + secret).digest("hex");
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
