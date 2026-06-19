import { randomBytes } from "node:crypto";
import { getRedis } from "./client";

const DEFAULT_TTL_MS = 10_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000;
const ACQUIRE_RETRY_DELAY_MS = 50;

// Lua script for compare-and-delete: only delete the key if its value matches
// our token. Prevents accidentally releasing someone else's lock if our TTL
// expired and another process re-acquired.
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export class SalesReturnLockBusyError extends Error {
  constructor(salesReturnId: string) {
    super(`SalesReturn ${salesReturnId} is being modified by another admin`);
    this.name = "SalesReturnLockBusyError";
  }
}

export async function withSalesReturnLock<T>(
  salesReturnId: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; acquireTimeoutMs?: number } = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const acquireTimeoutMs = opts.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const redis = getRedis();
  const key = `salesreturn-lock:${salesReturnId}`;
  const token = randomBytes(16).toString("hex");

  const acquireDeadline = Date.now() + acquireTimeoutMs;
  let acquired = false;
  while (Date.now() < acquireDeadline) {
    const result = await redis.set(key, token, "PX", ttlMs, "NX");
    if (result === "OK") {
      acquired = true;
      break;
    }
    await new Promise((r) => setTimeout(r, ACQUIRE_RETRY_DELAY_MS));
  }

  if (!acquired) throw new SalesReturnLockBusyError(salesReturnId);

  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, key, token);
  }
}
