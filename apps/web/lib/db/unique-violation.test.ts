import { describe, it, expect } from "vitest";
import { Prisma } from "@elorae/db";
import { isUniqueViolationOn } from "./unique-violation";

describe("isUniqueViolationOn", () => {
  it("matches a plain object (no Prisma class) with code P2002 and the column in meta", () => {
    const e = { code: "P2002", message: "Unique constraint failed", meta: { target: "FieldSalesOrder_idempotencyKey_key" } };
    expect(isUniqueViolationOn(e, "idempotencyKey")).toBe(true);
  });

  it("matches a plain object with the column only in the message", () => {
    const e = { code: "P2002", message: "Unique constraint failed on KonsiSellThrough_chainKey_key" };
    expect(isUniqueViolationOn(e, "chainKey")).toBe(true);
  });

  it("does not match another column, another code, a non-string code or a non-object", () => {
    const meta = { target: "FieldSalesOrder_idempotencyKey_key" };
    expect(isUniqueViolationOn({ code: "P2002", message: "x", meta }, "chainKey")).toBe(false);
    expect(isUniqueViolationOn({ code: "P2003", message: "x", meta }, "idempotencyKey")).toBe(false);
    expect(isUniqueViolationOn({ code: 2002, message: "x", meta }, "idempotencyKey")).toBe(false);
    expect(isUniqueViolationOn("P2002 idempotencyKey", "idempotencyKey")).toBe(false);
    expect(isUniqueViolationOn(null, "idempotencyKey")).toBe(false);
  });

  it("still matches a real PrismaClientKnownRequestError", () => {
    const e = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: "X_chainKey_key" },
    });
    expect(isUniqueViolationOn(e, "chainKey")).toBe(true);
  });
});
