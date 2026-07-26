import { describe, it, expect } from "vitest";
import { salesorderNoForSettlement } from "./match-key";

describe("salesorderNoForSettlement", () => {
  it("prefixes SP- for shopee", () => {
    expect(salesorderNoForSettlement("SHOPEE", "260529M3FSPVC9")).toBe("SP-260529M3FSPVC9");
  });

  it("returns null for unknown marketplace", () => {
    expect(salesorderNoForSettlement("LAZADA", "x")).toBeNull();
  });

  it("returns the raw orderNo (no prefix) for tiktok", () => {
    expect(salesorderNoForSettlement("TIKTOK", "584771788142839379")).toBe("584771788142839379");
  });

  it("returns the raw orderNo (no prefix) for tokopedia", () => {
    expect(salesorderNoForSettlement("TOKOPEDIA", "x")).toBe("x");
  });

  it("trims whitespace before prefixing", () => {
    expect(salesorderNoForSettlement("SHOPEE", "  AAA  ")).toBe("SP-AAA");
  });

  it("trims whitespace for tiktok too", () => {
    expect(salesorderNoForSettlement("TIKTOK", "  584771788142839379  ")).toBe(
      "584771788142839379",
    );
  });

  it("returns null for an empty orderNo", () => {
    expect(salesorderNoForSettlement("SHOPEE", "   ")).toBeNull();
  });

  it("returns null for an empty orderNo on tiktok", () => {
    expect(salesorderNoForSettlement("TIKTOK", "   ")).toBeNull();
  });
});
