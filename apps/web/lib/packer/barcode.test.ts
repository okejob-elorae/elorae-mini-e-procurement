import { describe, expect, it } from "vitest";
import { barcodesMatch, normalizeBarcode } from "./barcode";

describe("packer barcode", () => {
  it("trims whitespace", () => {
    expect(normalizeBarcode("  ABC-1  ")).toBe("ABC-1");
  });

  it("matches start and end when equal", () => {
    expect(barcodesMatch("SO-1", "SO-1")).toBe(true);
  });

  it("rejects different barcodes", () => {
    expect(barcodesMatch("SO-1", "SO-2")).toBe(false);
  });

  it("rejects empty start", () => {
    expect(barcodesMatch("  ", "SO-1")).toBe(false);
  });
});
