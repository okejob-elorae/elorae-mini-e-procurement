import { prisma, Prisma } from "@elorae/db";

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

// MySQL deadlock (1213) / lock-wait-timeout (1205) + Prisma write-conflict/serialization (P2034).
export function isRetryableTxError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2034") return true; // transaction write conflict / deadlock (serialization)
    /* A P2028 message carries elapsed milliseconds ("... 31205 ms ..."), which the "1205"/"1213" substring checks would read as a MySQL error code. */
    if (e.code === "P2028") return false;
    const msg = `${e.message} ${JSON.stringify(e.meta ?? {})}`.toLowerCase();
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
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2028") return false;
  return !/unable to start a transaction/i.test(e.message);
}

// Serializable transaction with automatic retry on deadlock/serialization failures.
export function runSerializable<T>(cb: (tx: Prisma.TransactionClient) => Promise<T>, options?: SerializableOptions): Promise<T> {
  return withRetry(() => prisma.$transaction(cb, { ...SERIALIZABLE, ...options }));
}
