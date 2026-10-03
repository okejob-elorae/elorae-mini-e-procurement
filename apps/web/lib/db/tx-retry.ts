import { prisma, Prisma } from "@elorae/db";

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

/**
 * Konflik serialisasi Postgres yang baru ketahuan saat COMMIT keluar dari
 * adaptor pg sebagai `DriverAdapterError` (`cause.kind =
 * "TransactionWriteConflict"`, atau kode asli 40001/40P01) — TIDAK dibungkus
 * P2034. Sebelum 2026-10-03 galat ini lolos dari `runSerializable`, jadi penjaga
 * berpola "baca agregat lalu sisipkan" melempar ke pengguna alih-alih mengulang
 * (ditemukan tes balapan gudang barang rusak: gagal 3 dari 4).
 */
function konflikAdaptor(e: unknown): boolean {
  if (!(e instanceof Error) || e.name !== "DriverAdapterError") return false;
  const sebab = (e as { cause?: unknown }).cause;
  if (typeof sebab !== "object" || sebab === null) return false;
  const c = sebab as { kind?: unknown; originalCode?: unknown; code?: unknown };
  return c.kind === "TransactionWriteConflict" || c.originalCode === "40001" || c.originalCode === "40P01" || c.code === "40001" || c.code === "40P01";
}

// MySQL deadlock (1213) / lock-wait-timeout (1205) + Prisma write-conflict/serialization (P2034)
// + konflik serialisasi Postgres dari adaptor (lihat `konflikAdaptor`).
export function isRetryableTxError(e: unknown): boolean {
  if (konflikAdaptor(e)) return true;
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

// Serializable transaction with automatic retry on deadlock/serialization failures.
export function runSerializable<T>(cb: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withRetry(() => prisma.$transaction(cb, SERIALIZABLE));
}
