import { describe, it, expect } from "vitest";
import { expandPack, parsePackRatio, validatePackRatio } from "./pack-ratio";

const ratio = [
  { size: "S", qty: 1 },
  { size: "M", qty: 2 },
  { size: "L", qty: 2 },
  { size: "XL", qty: 1 },
];
const variants = [
  { variantSku: "A-S", size: "S" },
  { variantSku: "A-M", size: "M" },
  { variantSku: "A-L", size: "L" },
  { variantSku: "A-XL", size: "XL" },
];
const fullStock = { "A-S": 5, "A-M": 5, "A-L": 5, "A-XL": 5 };

describe("expandPack", () => {
  it("expands one pack into size lines in ratio order", () => {
    const r = expandPack({ ratio, variants, available: fullStock });
    expect(r).toEqual({
      ok: true,
      lines: [
        { variantSku: "A-S", size: "S", qty: 1 },
        { variantSku: "A-M", size: "M", qty: 2 },
        { variantSku: "A-L", size: "L", qty: 2 },
        { variantSku: "A-XL", size: "XL", qty: 1 },
      ],
    });
  });

  it("matches size case- and whitespace-insensitively", () => {
    const r = expandPack({
      ratio: [{ size: "S", qty: 1 }],
      variants: [{ variantSku: "A-S", size: " s " }],
      available: { "A-S": 1 },
    });
    expect(r).toEqual({ ok: true, lines: [{ variantSku: "A-S", size: " s ", qty: 1 }] });
  });

  it("drops when a ratio size has no matching variant (first blocker)", () => {
    const r = expandPack({
      ratio,
      variants: variants.filter((v) => v.size !== "L"),
      available: fullStock,
    });
    expect(r).toEqual({ ok: false, reason: "MISSING_SIZE", size: "L" });
  });

  it("drops when a matched variant is short on stock (missing key = 0)", () => {
    const r = expandPack({ ratio, variants, available: { "A-S": 1, "A-M": 2, "A-L": 1, "A-XL": 1 } });
    expect(r).toEqual({ ok: false, reason: "INSUFFICIENT_STOCK", size: "L", needed: 2, have: 1 });
  });

  it("returns EMPTY_RATIO for an empty ratio", () => {
    expect(expandPack({ ratio: [], variants, available: fullStock })).toEqual({ ok: false, reason: "EMPTY_RATIO" });
  });
});

describe("parsePackRatio", () => {
  it("parses a valid JSON array", () => {
    expect(parsePackRatio('[{"size":"S","qty":1}]')).toEqual([{ size: "S", qty: 1 }]);
  });
  it("returns [] on null/garbage", () => {
    expect(parsePackRatio(null)).toEqual([]);
    expect(parsePackRatio("not json")).toEqual([]);
    expect(parsePackRatio('{"size":"S"}')).toEqual([]);
  });
});

describe("validatePackRatio", () => {
  it("accepts and trims a valid list", () => {
    expect(validatePackRatio([{ size: " S ", qty: 1 }])).toEqual({ ok: true, rows: [{ size: "S", qty: 1 }] });
  });
  it("rejects empty", () => {
    expect(validatePackRatio([])).toEqual({ ok: false, code: "EMPTY" });
  });
  it("rejects an empty/whitespace size", () => {
    expect(validatePackRatio([{ size: "  ", qty: 1 }])).toEqual({ ok: false, code: "BAD_SIZE" });
  });
  it("rejects duplicate sizes case-insensitively", () => {
    expect(validatePackRatio([{ size: "S", qty: 1 }, { size: "s", qty: 2 }])).toEqual({ ok: false, code: "DUP_SIZE" });
  });
  it("rejects non-positive / non-integer qty", () => {
    expect(validatePackRatio([{ size: "S", qty: 0 }])).toEqual({ ok: false, code: "BAD_QTY" });
    expect(validatePackRatio([{ size: "S", qty: 1.5 }])).toEqual({ ok: false, code: "BAD_QTY" });
  });
});
