import { prisma, Prisma } from "@elorae/db";

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

// MySQL deadlock (1213) / lock-wait-timeout (1205) + Prisma write-conflict/serialization (P2034).
export function isRetryableTxError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2034") return true; // transaction write conflict / deadlock (serialization)
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

// Prisma's interactive-transaction expiry (the default is 5s): the transaction was rolled back because it ran past its timeout.
export function isTransactionExpired(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028";
}

// Serializable transaction with automatic retry on deadlock/serialization failures.
export function runSerializable<T>(cb: (tx: Prisma.TransactionClient) => Promise<T>, options?: SerializableOptions): Promise<T> {
  return withRetry(() => prisma.$transaction(cb, { ...SERIALIZABLE, ...options }));
}
