import { prisma, Prisma } from "@elorae/db";

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

/*
 * Shape detection, not `instanceof`: the prod web build bundles the Prisma runtime more than once,
 * so a known-request error from the shared client can fail an `instanceof` against this chunk's
 * class. A Prisma known-request error is an object with a string `code`.
 */
function asCodedError(e: unknown): { code: string; message: string; meta?: unknown } | null {
  if (typeof e !== "object" || e === null) return null;
  const err = e as { code?: unknown; message?: unknown; meta?: unknown };
  if (typeof err.code !== "string") return null;
  return { code: err.code, message: typeof err.message === "string" ? err.message : "", meta: err.meta };
}

// MySQL deadlock (1213) / lock-wait-timeout (1205) + Prisma write-conflict/serialization (P2034).
export function isRetryableTxError(e: unknown): boolean {
  const err = asCodedError(e);
  if (err) {
    if (err.code === "P2034") return true; // transaction write conflict / deadlock (serialization)
    /* A P2028 message carries elapsed milliseconds ("... 31205 ms ..."), which the "1205"/"1213" substring checks would read as a MySQL error code. */
    if (err.code === "P2028") return false;
    const msg = `${err.message} ${JSON.stringify(err.meta ?? {})}`.toLowerCase();
    return msg.includes("deadlock") || msg.includes("1213") || msg.includes("lock wait timeout") || msg.includes("1205") || msg.includes("try restarting transaction");
  }
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryableTxError(e) || attempt === maxAttempts) throw e;
    }
  }
  throw lastErr; // unreachable, satisfies types
}

export type SerializableOptions = { timeout?: number; maxWait?: number };

/*
 * Prisma raises P2028 for two different failures: the transaction ran past its timeout and was rolled back
 * ("Transaction already closed: A commit cannot be executed on an expired transaction ..."), or it could not
 * even start within `maxWait` ("Unable to start a transaction in the given time", pool starvation).
 * Only the first is an expiry; the second never ran anything.
 */
export function isTransactionExpired(e: unknown): boolean {
  const err = asCodedError(e);
  if (!err || err.code !== "P2028") return false;
  return !/unable to start a transaction/i.test(err.message);
}

// Serializable transaction with automatic retry on deadlock/serialization failures.
export function runSerializable<T>(cb: (tx: Prisma.TransactionClient) => Promise<T>, options?: SerializableOptions): Promise<T> {
  return withRetry(() => prisma.$transaction(cb, { ...SERIALIZABLE, ...options }));
}
