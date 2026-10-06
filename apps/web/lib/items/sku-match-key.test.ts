import { describe, expect, it } from "vitest";
import { skuMatchKey } from "./sku-match-key";

describe("skuMatchKey", () => {
  it("folds case and surrounding space", () => {
    expect(skuMatchKey("  Abc-01 ")).toBe("abc-01");
  });
  it("folds accents the way utf8mb4_unicode_ci does", () => {
    expect(skuMatchKey("CAFÉ-01")).toBe(skuMatchKey("cafe-01"));
    expect(skuMatchKey("Ñ")).toBe("n");
  });
});
