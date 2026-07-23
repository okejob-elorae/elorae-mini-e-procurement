import { describe, it, expect } from "vitest";
import { salesorderNoForSettlement } from "./match-key";

describe("salesorderNoForSettlement", () => {
  it("prefixes SP- for shopee", () => {
    expect(salesorderNoForSettlement("SHOPEE", "260529M3FSPVC9")).toBe("SP-260529M3FSPVC9");
  });

  it("returns null for unknown marketplace", () => {
    expect(salesorderNoForSettlement("LAZADA", "x")).toBeNull();
  });

  it("returns null for tokopedia (not yet supported)", () => {
    expect(salesorderNoForSettlement("TOKOPEDIA", "x")).toBeNull();
  });

  it("trims whitespace before prefixing", () => {
    expect(salesorderNoForSettlement("SHOPEE", "  AAA  ")).toBe("SP-AAA");
  });

  it("returns null for an empty orderNo", () => {
    expect(salesorderNoForSettlement("SHOPEE", "   ")).toBeNull();
  });
});
