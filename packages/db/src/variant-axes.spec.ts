import { describe, expect, it } from "vitest";
import {
  buildColorIndex,
  colorMatchKey,
  normalizeVariantAxisKeys,
  resolveVariantAxes,
  sizeMatchKey,
} from "./variant-axes";

describe("normalizeVariantAxisKeys", () => {
  it("maps colour and size label spellings onto Warna and Ukuran", () => {
    expect(normalizeVariantAxisKeys({ sku: "A-L", color: "Red", Size: "L", barcode: "1" })).toEqual({
      sku: "A-L",
      Warna: "Red",
      Ukuran: "L",
      barcode: "1",
    });
    expect(normalizeVariantAxisKeys({ sku: "B", COLOUR: "Black", " ukuran ": "S" })).toEqual({
      sku: "B",
      Warna: "Black",
      Ukuran: "S",
    });
  });

  it("keeps other keys and an existing canonical value", () => {
    expect(normalizeVariantAxisKeys({ sku: "C", Warna: "Black", color: "Grey", Motif: "X" })).toEqual({
      sku: "C",
      Warna: "Black",
      Motif: "X",
    });
  });
});

describe("match keys", () => {
  it("ignore case, spacing and punctuation", () => {
    expect(colorMatchKey(" Light  Brown (B) ")).toBe("lightbrownb");
    expect(colorMatchKey("Dark-Grey")).toBe(colorMatchKey("dark grey"));
    expect(sizeMatchKey(" all size ")).toBe("ALLSIZE");
  });
});

describe("resolveVariantAxes", () => {
  const index = buildColorIndex([
    { id: "c1", name: "Cappuccino", aliases: ["Cappucino", "Cppuccino"] },
    { id: "c2", name: "Khaki", aliases: ["Khaky"] },
  ]);

  it("resolves a colour by name or alias and keeps the size text", () => {
    expect(resolveVariantAxes({ sku: "x", Warna: "cppuccino", Ukuran: "XL" }, index)).toEqual({
      colorId: "c1",
      colorLabel: "cppuccino",
      size: "XL",
    });
    expect(resolveVariantAxes({ sku: "y", color: "Khaki", Size: "S" }, index).colorId).toBe("c2");
  });

  it("returns null for an unknown colour or a missing axis", () => {
    expect(resolveVariantAxes({ sku: "z", Warna: "Mauve" }, index)).toEqual({
      colorId: null,
      colorLabel: "Mauve",
      size: null,
    });
  });
});
