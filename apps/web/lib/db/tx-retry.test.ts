import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@elorae/db";
import { withRetry, isRetryableTxError, isTransactionExpired } from "./tx-retry";

function deadlockError(code = "P2010"): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Deadlock found when trying to get lock; try restarting transaction", {
    code,
    clientVersion: "test",
  });
}

function unrelatedKnownRequestError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("isRetryableTxError", () => {
  it("returns true for P2034 (write conflict / serialization)", () => {
    const e = new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", {
      code: "P2034",
      clientVersion: "test",
    });
    expect(isRetryableTxError(e)).toBe(true);
  });

  it("returns true for a known-request-error whose message contains deadlock", () => {
    expect(isRetryableTxError(deadlockError())).toBe(true);
  });

  it("returns false for a plain Error", () => {
    expect(isRetryableTxError(new Error("boom"))).toBe(false);
  });

  it("returns false for an unrelated Prisma code with no deadlock text", () => {
    expect(isRetryableTxError(unrelatedKnownRequestError())).toBe(false);
  });
});

function p2028(message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, { code: "P2028", clientVersion: "test" });
}

const EXPIRED_MESSAGE =
  "Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction was 30000 ms, however 31205 ms passed since the start of the transaction.";
const UNABLE_TO_START_MESSAGE =
  "Transaction API error: Unable to start a transaction in the given time.";

describe("isRetryableTxError on P2028", () => {
  it("never retries a P2028 whose elapsed ms contains 1205", () => {
    expect(isRetryableTxError(p2028(EXPIRED_MESSAGE))).toBe(false);
  });

  it("never retries a P2028 whose elapsed ms contains 1213", () => {
    expect(isRetryableTxError(p2028("expired transaction, 51213 ms passed since the start"))).toBe(false);
  });
});

describe("isTransactionExpired", () => {
  it("is true for the expired-transaction P2028", () => {
    expect(isTransactionExpired(p2028(EXPIRED_MESSAGE))).toBe(true);
  });

  it("is false for the unable-to-start P2028", () => {
    expect(isTransactionExpired(p2028(UNABLE_TO_START_MESSAGE))).toBe(false);
  });

  it("is false for another Prisma code and for a plain Error", () => {
    expect(isTransactionExpired(unrelatedKnownRequestError())).toBe(false);
    expect(isTransactionExpired(new Error("boom"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("resolves on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once on a retryable error then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(deadlockError()).mockResolvedValueOnce("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-retryable error immediately without retrying", async () => {
    const err = new Error("not retryable");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-retryable Prisma known-request-error immediately", async () => {
    const err = unrelatedKnownRequestError();
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rethrows after maxAttempts calls when always retryable", async () => {
    const fn = vi.fn().mockRejectedValue(deadlockError());
    await expect(withRetry(fn, 4)).rejects.toThrow(/deadlock/i);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("respects a custom maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(deadlockError());
    await expect(withRetry(fn, 2)).rejects.toThrow(/deadlock/i);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("shape detection without the Prisma class", () => {
  it("retries a plain object with code P2034", () => {
    expect(isRetryableTxError({ code: "P2034", message: "write conflict" })).toBe(true);
  });

  it("retries a plain object whose message names a deadlock", () => {
    expect(isRetryableTxError({ code: "P2010", message: "Deadlock found; try restarting transaction" })).toBe(true);
  });

  it("never retries a plain P2028 whose elapsed ms contains 1205", () => {
    expect(isRetryableTxError({ code: "P2028", message: EXPIRED_MESSAGE })).toBe(false);
  });

  it("does not retry a plain object with an unrelated code, a non-string code or no code", () => {
    expect(isRetryableTxError({ code: "P2002", message: "Unique constraint failed" })).toBe(false);
    expect(isRetryableTxError({ code: 1213, message: "deadlock" })).toBe(false);
    expect(isRetryableTxError({ message: "deadlock" })).toBe(false);
    expect(isRetryableTxError(null)).toBe(false);
  });

  it("detects an expired transaction on a plain P2028 and not an unable-to-start one", () => {
    expect(isTransactionExpired({ code: "P2028", message: EXPIRED_MESSAGE })).toBe(true);
    expect(isTransactionExpired({ code: "P2028", message: UNABLE_TO_START_MESSAGE })).toBe(false);
    expect(isTransactionExpired({ code: "P2002", message: EXPIRED_MESSAGE })).toBe(false);
  });
});
