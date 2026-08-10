import { describe, it, expect } from "vitest";
import { Prisma } from "@elorae/db";
import { attemptSupplierPaymentJournal } from "./post-supplier-payment-journal-safely";

/*
 * No DB: every case feeds a canned post result or throw. Pins the contract the
 * paid toggle's transaction depends on — a journal problem comes back as a value
 * so the toggle still commits, while a transaction abort escapes so the retry
 * wrapper can re-run the toggle and the post together.
 */
describe("attemptSupplierPaymentJournal", () => {
  it("reports no failure for a posted journal", async () => {
    const r = await attemptSupplierPaymentJournal("payment", async () => ({
      ok: true,
      journalId: "j1",
      created: true,
    }));
    expect(r).toBeNull();
  });

  it("stays silent for NOTHING_TO_POST on a reversal", async () => {
    const r = await attemptSupplierPaymentJournal("reversal", async () => ({
      ok: false,
      code: "NOTHING_TO_POST",
    }));
    expect(r).toBeNull();
  });

  it("reports NOTHING_TO_POST on a payment", async () => {
    const r = await attemptSupplierPaymentJournal("payment", async () => ({
      ok: false,
      code: "NOTHING_TO_POST",
    }));
    expect(r).toEqual({ reason: "NOTHING_TO_POST", role: null });
  });

  it("reports GRN_REVERSAL_MISSING with its code intact", async () => {
    const r = await attemptSupplierPaymentJournal("payment", async () => ({
      ok: false,
      code: "GRN_REVERSAL_MISSING",
    }));
    expect(r).toEqual({ reason: "GRN_REVERSAL_MISSING", role: null });
  });

  it("carries the role through on UNMAPPED_ROLE", async () => {
    const r = await attemptSupplierPaymentJournal("payment", async () => ({
      ok: false,
      code: "UNMAPPED_ROLE",
      role: "AP",
    }));
    expect(r).toEqual({ reason: "UNMAPPED_ROLE", role: "AP" });
  });

  it("turns a non-retryable throw into an ERROR failure instead of failing the toggle", async () => {
    const r = await attemptSupplierPaymentJournal("payment", async () => {
      throw new Error("boom");
    });
    expect(r).toEqual({ reason: "ERROR", role: null, detail: "boom" });
  });

  it("rethrows a retryable transaction error so the whole transaction can be retried", async () => {
    const deadlock = new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", {
      code: "P2034",
      clientVersion: "test",
    });
    await expect(
      attemptSupplierPaymentJournal("payment", async () => {
        throw deadlock;
      }),
    ).rejects.toBe(deadlock);
  });
});
