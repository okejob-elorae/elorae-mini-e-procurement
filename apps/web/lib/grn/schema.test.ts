import { describe, expect, it } from "vitest";
import { GRN_MAX_ROLLS, GRN_ROLL_TEXT_MAX, grnSchema } from "./schema";

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
