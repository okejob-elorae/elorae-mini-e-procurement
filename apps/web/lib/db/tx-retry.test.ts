import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@elorae/db";
import { withRetry, isRetryableTxError } from "./tx-retry";

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
