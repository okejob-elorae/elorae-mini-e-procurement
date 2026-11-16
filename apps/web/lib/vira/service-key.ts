import { createHash, timingSafeEqual } from "node:crypto";
import { getViraEnv } from "./config";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** True only if VIRA_SERVICE_KEY is set (>= 32 chars) AND headerValue matches it.
 *  Compares SHA-256 digests of both values with crypto.timingSafeEqual.
 *  Fails closed: env unset → false. */
export function checkServiceKey(headerValue: string | null | undefined): boolean {
  // Unlike the CRON_SECRET pattern, an unset key rejects every call instead of letting it through.
  const serviceKey = getViraEnv().serviceKey;
  if (!serviceKey || typeof headerValue !== "string" || headerValue.length === 0) return false;
  return timingSafeEqual(sha256(headerValue), sha256(serviceKey));
}
