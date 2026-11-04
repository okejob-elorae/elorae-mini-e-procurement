import { describe, expect, it } from "vitest";
import { barisBahan, parseVendorReturnLines } from "./baris-retur";

describe("parseVendorReturnLines", () => {
  const baris = [{ type: "ACCESSORIES", itemId: "kancing", qty: 3, costValue: 4_500 }];

  it("teks JSON (bentuk yang ditulis penulis retur) → array baris", () => {
    expect(parseVendorReturnLines(JSON.stringify(baris))).toEqual(baris);
  });

  it("array lama tetap diterima; teks rusak, objek, dan null → []", () => {
    expect(parseVendorReturnLines(baris)).toEqual(baris);
    expect(parseVendorReturnLines("{rusak")).toEqual([]);
    expect(parseVendorReturnLines(JSON.stringify({ itemId: "x" }))).toEqual([]);
    expect(parseVendorReturnLines(null)).toEqual([]);
  });

  it("barisBahan: kain & aksesori ya, FG_REJECT tidak", () => {
    expect(["FABRIC", "ACCESSORIES", "FG_REJECT"].map((type) => barisBahan({ ...baris[0], type }))).toEqual([
      true,
      true,
      false,
    ]);
  });
});
