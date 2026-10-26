import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@elorae/db";

const { mockRunSerializable, mockFindUnique } = vi.hoisted(() => ({
  mockRunSerializable: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock("@/lib/db/tx-retry", () => ({ runSerializable: mockRunSerializable }));
vi.mock("@/lib/docNumber", () => ({ generateDocNumber: vi.fn() }));

import { recordPayment } from "./payment-writer";

function keyConflict(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { constraint: "Payment_idempotencyKey_key" },
  });
}

const input = {
  storeId: "store-1",
  paidAt: new Date("2026-03-01T00:00:00.000+07:00"),
  method: "CASH" as const,
  amount: 100,
  recordedById: "user-1",
  allocations: [{ receivableId: "rec-1", amount: 100 }],
  idempotencyKey: "key-1",
};

/* Runs the writer's own callback against a fake tx whose key lookup finds the racing winner. */
function runCallback(cb: (tx: unknown) => Promise<unknown>): Promise<unknown> {
  return cb({ payment: { findUnique: mockFindUnique } });
}

describe("recordPayment idempotency-key race", () => {
  beforeEach(() => {
    mockRunSerializable.mockReset();
    mockFindUnique.mockReset();
  });

  it("retries once after a P2002 on the key index and returns the winner's payment", async () => {
    mockFindUnique.mockResolvedValue({ id: "pay-1", docNo: "PAY/1", status: "POSTED" });
    mockRunSerializable.mockRejectedValueOnce(keyConflict()).mockImplementationOnce(runCallback);

    await expect(recordPayment(input)).resolves.toEqual({ paymentId: "pay-1", docNo: "PAY/1" });
    expect(mockRunSerializable).toHaveBeenCalledTimes(2);
  });

  it("gives up after the bounded attempts and rethrows the conflict", async () => {
    mockRunSerializable.mockRejectedValue(keyConflict());

    await expect(recordPayment(input)).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(mockRunSerializable).toHaveBeenCalledTimes(4);
  });

  it("does not retry a P2002 on a different unique index", async () => {
    const other = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { constraint: "PaymentAllocation_paymentId_receivableId_key" },
    });
    mockRunSerializable.mockRejectedValue(other);

    await expect(recordPayment(input)).rejects.toBe(other);
    expect(mockRunSerializable).toHaveBeenCalledTimes(1);
  });

  it("does not retry a key-index conflict when the caller sent no key", async () => {
    mockRunSerializable.mockRejectedValue(keyConflict());

    await expect(recordPayment({ ...input, idempotencyKey: undefined })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(mockRunSerializable).toHaveBeenCalledTimes(1);
  });
});
