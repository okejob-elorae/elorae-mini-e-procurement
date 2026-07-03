import { describe, expect, it } from "vitest";
import {
  buildVariantBarcode,
  extractParentSeq,
  parseVariantBarcodeFormat,
} from "./variant-barcode";

describe("extractParentSeq", () => {
  it("derives six-digit body from 27-prefixed parent SKUs", () => {
    expect(extractParentSeq("2700016", 6)).toBe("000016");
    expect(extractParentSeq("2700121", 6)).toBe("000121");
    expect(extractParentSeq("2700005", 6)).toBe("000005");
  });
});

describe("buildVariantBarcode", () => {
  const config = parseVariantBarcodeFormat(
    JSON.stringify({ template: "{categoryCode}{parentSeq:6}{attrs}" })
  );

  it("matches Elorae-style barcode samples", () => {
    expect(
      buildVariantBarcode(config, {
        parentSku: "2700016",
        categoryCode: "0224",
        combo: { Size: "T03" },
        orderedAttributeKeys: ["Size"],
      })
    ).toBe("0224000016T03");

    expect(
      buildVariantBarcode(config, {
        parentSku: "2700121",
        categoryCode: "0127",
        combo: { Size: "PXL" },
        orderedAttributeKeys: ["Size"],
      })
    ).toBe("0127000121PXL");
  });

  it("supports named attribute placeholders", () => {
    const named = parseVariantBarcodeFormat(
      JSON.stringify({ template: "{categoryCode}{parentSeq:6}{attr:Size}" })
    );
    expect(
      buildVariantBarcode(named, {
        parentSku: "2700005",
        categoryCode: "0224",
        combo: { Color: "Red", Size: "T04" },
        orderedAttributeKeys: ["Color", "Size"],
      })
    ).toBe("0224000005T04");
  });
});
