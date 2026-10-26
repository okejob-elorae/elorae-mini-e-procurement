import { describe, it, expect } from "vitest";
import { hasDuplicateAddedLine } from "./added-lines";

describe("hasDuplicateAddedLine", () => {
  it("flags two identical added lines within one batch, with nothing on the document", () => {
    expect(
      hasDuplicateAddedLine([], [
        { itemId: "i1", variantSku: "" },
        { itemId: "i1", variantSku: "" },
      ]),
    ).toBe(true);
  });

  it("flags an added line that repeats one already on the document", () => {
    expect(hasDuplicateAddedLine([{ itemId: "i1", variantSku: "S" }], [{ itemId: "i1", variantSku: "S" }])).toBe(true);
  });

  it("does not flag the same item under a different variant, or different items", () => {
    expect(
      hasDuplicateAddedLine([{ itemId: "i1", variantSku: "S" }], [
        { itemId: "i1", variantSku: "M" },
        { itemId: "i2", variantSku: "S" },
      ]),
    ).toBe(false);
  });
});
