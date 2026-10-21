import { describe, expect, it } from "vitest";
import { parseRollLength, validateGrnRollImport } from "./validate";
import type { GrnRollImportRow, GrnRollImportTargetLine } from "./types";

const L1: GrnRollImportTargetLine = {
  lineId: "l1",
  sku: "FAB-01",
  variantSku: null,
  name: "Katun",
  uomCode: "YD",
  orderedQty: 100,
  alreadyReceivedQty: 20,
};
const L2: GrnRollImportTargetLine = {
  lineId: "l2",
  sku: "FAB-02",
  variantSku: "FAB-02-RED",
  name: "Linen",
  uomCode: "YD",
  orderedQty: null,
  alreadyReceivedQty: null,
};

function row(n: number, overrides: Partial<GrnRollImportRow> = {}): GrnRollImportRow {
  return { row: n, sku: "FAB-01", varianSku: "", panjang: 10, noRoll: "", catatan: "", ...overrides };
}

describe("parseRollLength", () => {
  it("returns null for blanks and non-numbers", () => {
    expect(parseRollLength(null)).toBeNull();
    expect(parseRollLength("  ")).toBeNull();
    expect(parseRollLength("abc")).toBeNull();
  });
});

describe("validateGrnRollImport", () => {
  it("plans rolls per line in file order", () => {
    const result = validateGrnRollImport(
      [row(2, { panjang: 50, noRoll: "A1" }), row(3, { panjang: "45.5" })],
      [L1, L2],
    );
    expect(result.errors).toEqual([]);
    expect(result.plan?.l1).toEqual([
      { length: 50, ref: "A1", notes: null },
      { length: 45.5, ref: null, notes: null },
    ]);
    expect(result.plan?.l2).toBeUndefined();
    expect(result.summary).toHaveLength(1);
    expect(result.summary[0]).toMatchObject({
      lineId: "l1",
      rollCount: 2,
      totalLength: 95.5,
      afterQty: 115.5,
      overBy: 15.5,
    });
  });

  it("accepts a decimal comma", () => {
    const result = validateGrnRollImport([row(2, { panjang: "12,5" })], [L1]);
    expect(result.errors).toEqual([]);
    expect(result.plan?.l1[0].length).toBe(12.5);
  });

  it("does not flag float noise", () => {
    const result = validateGrnRollImport([row(2, { panjang: 12.300000000000001 })], [L1]);
    expect(result.errors).toEqual([]);
    expect(result.plan?.l1[0].length).toBe(12.3);
  });

  it("matches sku and variant ignoring case and spaces", () => {
    const result = validateGrnRollImport([row(2, { sku: " fab-02 ", varianSku: "fab-02-red" })], [L1, L2]);
    expect(result.errors).toEqual([]);
    expect(result.plan?.l2).toHaveLength(1);
  });

  it("needs the variant for a variant line", () => {
    const result = validateGrnRollImport([row(2, { sku: "FAB-02", panjang: 10 })], [L1, L2]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "UNKNOWN_LINE", row: 2, column: "varianSku" });
    expect(result.errors[0].detail).toContain("FAB-02");
    expect(result.plan).toBeNull();
  });

  it("flags a blank sku and a blank length as REQUIRED", () => {
    const sku = validateGrnRollImport([row(2, { sku: "" })], [L1]);
    expect(sku.errors).toEqual([{ code: "REQUIRED", row: 2, column: "sku", detail: null }]);
    const panjang = validateGrnRollImport([row(2, { panjang: null })], [L1]);
    expect(panjang.errors).toEqual([{ code: "REQUIRED", row: 2, column: "panjang", detail: null }]);
  });

  it("flags an unknown sku", () => {
    const result = validateGrnRollImport([row(2, { sku: "NOPE" })], [L1]);
    expect(result.errors[0]).toMatchObject({ code: "UNKNOWN_LINE", row: 2, column: "sku" });
  });

  it("flags text as INVALID_NUMBER", () => {
    const result = validateGrnRollImport([row(2, { panjang: "abc" })], [L1]);
    expect(result.errors[0]).toMatchObject({ code: "INVALID_NUMBER", column: "panjang" });
  });

  it("flags zero and negative lengths as NOT_POSITIVE", () => {
    const result = validateGrnRollImport([row(2, { panjang: 0 }), row(3, { panjang: -1 })], [L1]);
    expect(result.errors.map((e) => e.code)).toEqual(["NOT_POSITIVE", "NOT_POSITIVE"]);
  });

  it("flags more than two decimals", () => {
    const result = validateGrnRollImport([row(2, { panjang: 1.234 })], [L1]);
    expect(result.errors[0]).toMatchObject({ code: "TOO_MANY_DECIMALS", column: "panjang" });
  });

  it("flags a single oversized length", () => {
    const result = validateGrnRollImport([row(2, { panjang: 100000000 })], [L1]);
    expect(result.errors[0]).toMatchObject({ code: "TOO_LARGE", row: 2 });
  });

  it("flags the row that pushes a line total past the column", () => {
    const result = validateGrnRollImport([row(2, { panjang: 99999999.99 }), row(3, { panjang: 1 })], [L1]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "TOO_LARGE", row: 3 });
  });

  it("caps noRoll and catatan at 191 characters", () => {
    const ok = validateGrnRollImport([row(2, { noRoll: "x".repeat(191), catatan: "y".repeat(191) })], [L1]);
    expect(ok.errors).toEqual([]);
    const bad = validateGrnRollImport([row(2, { noRoll: "x".repeat(192), catatan: "y".repeat(192) })], [L1]);
    expect(bad.errors).toEqual([
      { code: "TOO_LONG", row: 2, column: "noRoll", detail: "191" },
      { code: "TOO_LONG", row: 2, column: "catatan", detail: "191" },
    ]);
  });

  it("flags a repeated roll number on one line, ignoring case", () => {
    const result = validateGrnRollImport(
      [row(2, { noRoll: "A1" }), row(3, { noRoll: "a1" })],
      [L1],
    );
    expect(result.errors).toEqual([{ code: "DUPLICATE_REF", row: 3, column: "noRoll", detail: "a1" }]);
  });

  it("allows the same roll number on different lines", () => {
    const result = validateGrnRollImport(
      [row(2, { noRoll: "A1" }), row(3, { sku: "FAB-02", varianSku: "FAB-02-RED", noRoll: "A1" })],
      [L1, L2],
    );
    expect(result.errors).toEqual([]);
  });

  it("refuses ambiguous form lines", () => {
    const result = validateGrnRollImport([row(2)], [L1, { ...L1, lineId: "l1b" }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "AMBIGUOUS_LINE", row: null });
    expect(result.plan).toBeNull();
  });

  it("refuses an empty file and one over the row cap", () => {
    expect(validateGrnRollImport([], [L1]).errors[0].code).toBe("EMPTY_FILE");
    const many = Array.from({ length: 2001 }, (_, i) => row(i + 2));
    expect(validateGrnRollImport(many, [L1]).errors[0].code).toBe("TOO_MANY_ROWS");
  });

  it("nulls the plan when any row errors and sorts errors by row", () => {
    const result = validateGrnRollImport(
      [row(2), row(5, { panjang: "abc" }), row(4), row(3, { sku: "NOPE" })],
      [L1],
    );
    expect(result.errors.map((e) => e.row)).toEqual([3, 5]);
    expect(result.plan).toBeNull();
    expect(result.summary).toHaveLength(1);
    expect(result.summary[0].rollCount).toBe(2);
  });
});
