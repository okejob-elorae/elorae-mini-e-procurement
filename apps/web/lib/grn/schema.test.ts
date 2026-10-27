import { describe, expect, it } from "vitest";
import {
  GRN_MAX_PHOTOS,
  GRN_MAX_ROLLS,
  GRN_NOTES_MAX,
  GRN_PHOTO_URL_MAX,
  GRN_ROLL_TEXT_MAX,
  grnSchema,
} from "./schema";

function payload(rolls: Array<{ rollRef: string; length: number; notes?: string }>) {
  return {
    supplierId: "sup1",
    items: [{ itemId: "item1", qty: 10, unitCost: 5, rolls }],
  };
}

describe("grnSchema roll caps", () => {
  it("parses a minimal payload with one roll", () => {
    expect(grnSchema.safeParse(payload([{ rollRef: "A1", length: 10 }])).success).toBe(true);
  });

  it("caps rollRef at the column width", () => {
    const ok = "x".repeat(GRN_ROLL_TEXT_MAX);
    expect(grnSchema.safeParse(payload([{ rollRef: ok, length: 1 }])).success).toBe(true);
    expect(grnSchema.safeParse(payload([{ rollRef: `${ok}x`, length: 1 }])).success).toBe(false);
  });

  it("caps roll notes at the column width", () => {
    const tooLong = "x".repeat(GRN_ROLL_TEXT_MAX + 1);
    expect(
      grnSchema.safeParse(payload([{ rollRef: "A1", length: 1, notes: tooLong }])).success
    ).toBe(false);
  });

  it("caps the number of rolls per line", () => {
    const rolls = (n: number) => Array.from({ length: n }, (_, i) => ({ rollRef: `R${i}`, length: 1 }));
    expect(grnSchema.safeParse(payload(rolls(GRN_MAX_ROLLS))).success).toBe(true);
    expect(grnSchema.safeParse(payload(rolls(GRN_MAX_ROLLS + 1))).success).toBe(false);
  });
});

describe("grnSchema roll length decimals", () => {
  it("accepts up to two decimals, including float-noise values", () => {
    for (const length of [10, 10.5, 10.25, 0.07, 1.15]) {
      expect(grnSchema.safeParse(payload([{ rollRef: "A1", length }])).success).toBe(true);
    }
  });

  it("refuses a third decimal", () => {
    for (const length of [10.123, 0.001, 48.555]) {
      expect(grnSchema.safeParse(payload([{ rollRef: "A1", length }])).success).toBe(false);
    }
  });
});

describe("grnSchema notes and photo caps", () => {
  const base = { supplierId: "sup1", items: [{ itemId: "item1", qty: 1, unitCost: 1 }] };

  it("caps notes at the column width", () => {
    expect(grnSchema.safeParse({ ...base, notes: "x".repeat(GRN_NOTES_MAX) }).success).toBe(true);
    expect(grnSchema.safeParse({ ...base, notes: "x".repeat(GRN_NOTES_MAX + 1) }).success).toBe(false);
  });

  it("caps the photo count", () => {
    const urls = (n: number) => Array.from({ length: n }, () => "https://cdn.example/p.jpg");
    expect(grnSchema.safeParse({ ...base, photoUrls: urls(GRN_MAX_PHOTOS) }).success).toBe(true);
    expect(grnSchema.safeParse({ ...base, photoUrls: urls(GRN_MAX_PHOTOS + 1) }).success).toBe(false);
  });

  it("caps each photo URL", () => {
    const ok = "x".repeat(GRN_PHOTO_URL_MAX);
    expect(grnSchema.safeParse({ ...base, photoUrls: [ok] }).success).toBe(true);
    expect(grnSchema.safeParse({ ...base, photoUrls: [`${ok}x`] }).success).toBe(false);
  });
});
