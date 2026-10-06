import { describe, expect, it } from "vitest";
import { parseItemImportPayload, validateItemImport, type ItemImportLookups } from "./validate";
import { skuMatchKey } from "@/lib/items/sku-match-key";
import { ITEM_IMPORT_MAX_ROWS, type ItemImportRow } from "./types";

const lookups = (over: Partial<ItemImportLookups> = {}): ItemImportLookups => ({
  uoms: [{ id: "uom-pcs", code: "PCS" }],
  categories: [
    { id: "cat-kmj", code: "KMJ", name: "Kemeja" },
    { id: "cat-aks", code: null, name: "Aksesoris" },
  ],
  existingItemSkus: new Set(),
  existingVariantSkus: new Set(),
  existingBarcodes: new Set(),
  ...over,
});

let nextRow = 2;
function row(over: Partial<ItemImportRow>): ItemImportRow {
  return {
    row: nextRow++,
    artikel: "KMJ-01",
    nama: "Kemeja",
    namaEn: "",
    kategori: "",
    satuan: "PCS",
    hargaJual: null,
    warna: "",
    ukuran: "",
    skuVarian: "",
    barcode: "",
    deskripsi: "",
    ...over,
  };
}
const codes = (r: ReturnType<typeof validateItemImport>) => r.errors.map((e) => e.code);

describe("validateItemImport — happy paths", () => {
  it("groups variant rows into one planned item with parent-based generated SKUs", () => {
    const r = validateItemImport(
      [
        row({ kategori: "kmj", hargaJual: 250000, warna: "Merah", ukuran: "M" }),
        row({ kategori: "kmj", hargaJual: 250000, warna: "Merah", ukuran: "L", barcode: "899001" }),
      ],
      lookups(),
    );
    expect(r.errors).toEqual([]);
    expect(r.artikelCount).toBe(1);
    expect(r.variantCount).toBe(2);
    expect(r.plan?.items).toEqual([
      {
        sku: "KMJ-01",
        nameId: "Kemeja",
        nameEn: "Kemeja",
        uomId: "uom-pcs",
        categoryId: "cat-kmj",
        sellingPrice: 250000,
        description: null,
        variants: [
          { Warna: "Merah", Ukuran: "M", sku: "KMJ-01-MERAH-M" },
          { Warna: "Merah", Ukuran: "L", sku: "KMJ-01-MERAH-L", barcode: "899001" },
        ],
      },
    ]);
  });

  it("plans a single-row artikel with no variant cells as a variantless item", () => {
    const r = validateItemImport([row({ artikel: "SYL-01", nama: "Syal", hargaJual: "90000" })], lookups());
    expect(r.errors).toEqual([]);
    expect(r.plan?.items[0]).toMatchObject({ sku: "SYL-01", variants: [], sellingPrice: 90000 });
    expect(r.preview[0]).toMatchObject({ artikel: "SYL-01", variantless: true, variants: [] });
  });

  it("matches Kategori by name when no code matches", () => {
    const r = validateItemImport([row({ artikel: "GLG-01", kategori: "aksesoris" })], lookups());
    expect(r.plan?.items[0].categoryId).toBe("cat-aks");
  });

  it("groups one artikel typed with different casing and spacing", () => {
    const r = validateItemImport(
      [row({ artikel: "KMJ-01", warna: "Merah" }), row({ artikel: " kmj-01 ", warna: "Biru" })],
      lookups(),
    );
    expect(r.errors).toEqual([]);
    expect(r.plan?.items).toHaveLength(1);
    expect(r.plan?.items[0].variants).toHaveLength(2);
  });

  it("shows both the typed and the final SKU when the prefix rule rewrites a typed SKU", () => {
    const r = validateItemImport([row({ warna: "Merah", skuVarian: "merah-m" })], lookups());
    expect(r.preview[0].variants[0]).toMatchObject({ typedSku: "merah-m", finalSku: "KMJ-01-MERAHM" });
  });
});

describe("validateItemImport — refusals", () => {
  it("requires Artikel, Nama and Satuan", () => {
    const r = validateItemImport([row({ artikel: "" }), row({ artikel: "B-1", nama: "", satuan: "" })], lookups());
    expect(r.errors.map((e) => [e.code, e.column])).toEqual([
      ["REQUIRED", "artikel"],
      ["REQUIRED", "nama"],
      ["REQUIRED", "satuan"],
    ]);
    expect(r.plan).toBeNull();
  });

  it("rejects formatted or negative prices", () => {
    expect(codes(validateItemImport([row({ hargaJual: "150.000" })], lookups()))).toEqual(["INVALID_NUMBER"]);
    expect(codes(validateItemImport([row({ hargaJual: -5 })], lookups()))).toEqual(["NEGATIVE_NUMBER"]);
    expect(codes(validateItemImport([row({ hargaJual: "-5" })], lookups()))).toEqual(["NEGATIVE_NUMBER"]);
  });

  it("rejects a numeric price cell with a fraction", () => {
    expect(codes(validateItemImport([row({ hargaJual: 1234.567 })], lookups()))).toEqual(["INVALID_NUMBER"]);
  });

  it("rejects an unknown Satuan or Kategori", () => {
    expect(codes(validateItemImport([row({ satuan: "BOX" })], lookups()))).toEqual(["UNKNOWN_UOM"]);
    expect(codes(validateItemImport([row({ kategori: "Celana" })], lookups()))).toEqual(["UNKNOWN_CATEGORY"]);
  });

  it("refuses a Kategori name shared by two categories instead of calling it unknown", () => {
    const twoAksesoris = lookups({
      categories: [
        { id: "cat-a", code: null, name: "Aksesoris" },
        { id: "cat-b", code: "AKB", name: "aksesoris" },
      ],
    });
    const r = validateItemImport([row({ kategori: "Aksesoris" })], twoAksesoris);
    expect(r.errors.map((e) => [e.code, e.column])).toEqual([["AMBIGUOUS_CATEGORY", "kategori"]]);
  });

  it("rejects item-level cells that differ between rows of one artikel", () => {
    const r = validateItemImport(
      [row({ warna: "Merah", hargaJual: 100 }), row({ warna: "Biru", hargaJual: 120 })],
      lookups(),
    );
    expect(r.errors.map((e) => [e.code, e.column])).toEqual([["INCONSISTENT_ARTIKEL", "hargaJual"]]);
  });

  it("rejects mixing a variantless row into a variant artikel, and two variantless rows", () => {
    expect(codes(validateItemImport([row({ warna: "Merah" }), row({})], lookups()))).toEqual(["MIXED_VARIANTLESS"]);
    expect(codes(validateItemImport([row({}), row({})], lookups()))).toEqual(["MIXED_VARIANTLESS"]);
  });

  it("rejects a barcode on a variantless row, which has nowhere to be stored", () => {
    expect(codes(validateItemImport([row({ barcode: "899001" })], lookups()))).toEqual(["VARIANTLESS_BARCODE"]);
  });

  it("rejects the same Warna + Ukuran twice in one artikel", () => {
    const r = validateItemImport(
      [row({ warna: "Merah", ukuran: "M" }), row({ warna: "merah", ukuran: "m" })],
      lookups(),
    );
    expect(codes(r)).toEqual(["DUPLICATE_VARIANT"]);
  });

  it("rejects a repeated Warna + Ukuran even when both rows type a SKU Varian, on the later row only", () => {
    const a = row({ warna: "Merah", ukuran: "M", skuVarian: "KMJ-01-A" });
    const b = row({ warna: "Merah", ukuran: "M", skuVarian: "KMJ-01-B" });
    const r = validateItemImport([a, b], lookups());
    expect(r.errors.map((e) => [e.code, e.row])).toEqual([["DUPLICATE_VARIANT", b.row]]);
  });

  it("rejects a variant row that names neither Warna nor Ukuran", () => {
    const r = validateItemImport([row({ skuVarian: "KMJ-01-X" })], lookups());
    expect(r.errors.map((e) => [e.code, e.column])).toEqual([["VARIANT_NEEDS_ATTRIBUTE", "warna"]]);
  });

  it("rejects an attribute filled on some variant rows of an artikel but not others", () => {
    const a = row({ warna: "Merah", ukuran: "M" });
    const b = row({ warna: "Biru", ukuran: "" });
    const r = validateItemImport([a, b], lookups());
    expect(r.errors.map((e) => [e.code, e.row, e.column, e.detail])).toEqual([
      ["INCONSISTENT_ATTRIBUTES", b.row, "ukuran", String(a.row)],
    ]);
  });

  it("accepts a two-attribute artikel that leaves out a Warna x Ukuran combination", () => {
    const r = validateItemImport(
      [row({ warna: "Merah", ukuran: "M" }), row({ warna: "Merah", ukuran: "L" }), row({ warna: "Biru", ukuran: "M" })],
      lookups(),
    );
    expect(r.errors).toEqual([]);
    expect(r.plan?.items[0].variants).toEqual([
      { Warna: "Merah", Ukuran: "M", sku: "KMJ-01-MERAH-M" },
      { Warna: "Merah", Ukuran: "L", sku: "KMJ-01-MERAH-L" },
      { Warna: "Biru", Ukuran: "M", sku: "KMJ-01-BIRU-M" },
    ]);
  });

  it("accepts a full grid typed with mixed casing", () => {
    const r = validateItemImport(
      [
        row({ warna: "Merah", ukuran: "M" }),
        row({ warna: "merah", ukuran: "L" }),
        row({ warna: "Biru", ukuran: "m" }),
        row({ warna: "BIRU", ukuran: "l" }),
      ],
      lookups(),
    );
    expect(r.errors).toEqual([]);
    expect(r.plan?.items[0].variants).toHaveLength(4);
  });

  it("rejects two rows of one artikel typing the same SKU Varian, on the later row with the SKU as detail", () => {
    const b = row({ warna: "Biru", skuVarian: "KMJ-01-X" });
    const r = validateItemImport([row({ warna: "Merah", skuVarian: "KMJ-01-X" }), b], lookups());
    expect(r.errors.map((e) => [e.code, e.row, e.detail])).toEqual([["DUPLICATE_IN_FILE", b.row, "KMJ-01-X"]]);
  });

  it("rejects an artikel that already exists, case-insensitively", () => {
    const r = validateItemImport([row({})], lookups({ existingItemSkus: new Set(["kmj-01"]) }));
    expect(codes(r)).toEqual(["ARTIKEL_EXISTS"]);
  });

  it("rejects an artikel equal to an existing variant SKU, and a variant SKU equal to an existing artikel", () => {
    const artikelClash = validateItemImport(
      [row({ artikel: "KMJ-01-MERAH" })],
      lookups({ existingVariantSkus: new Set(["kmj-01-merah"]) }),
    );
    expect(artikelClash.errors.map((e) => [e.code, e.column, e.detail])).toEqual([
      ["SKU_NAMESPACE_TAKEN", "artikel", "KMJ-01-MERAH"],
    ]);
    const variantClash = validateItemImport(
      [row({ warna: "Merah" })],
      lookups({ existingItemSkus: new Set(["kmj-01-merah"]) }),
    );
    expect(variantClash.errors.map((e) => [e.code, e.column, e.detail])).toEqual([
      ["SKU_NAMESPACE_TAKEN", "skuVarian", "KMJ-01-MERAH"],
    ]);
  });

  it("rejects a final variant SKU or barcode already used by another item", () => {
    expect(
      codes(validateItemImport([row({ warna: "Merah", ukuran: "M" })], lookups({ existingVariantSkus: new Set(["kmj-01-merah-m"]) }))),
    ).toEqual(["VARIANT_SKU_TAKEN"]);
    expect(
      codes(validateItemImport([row({ warna: "Merah", barcode: "X1" })], lookups({ existingBarcodes: new Set(["x1"]) }))),
    ).toEqual(["BARCODE_TAKEN"]);
  });

  it("rejects an artikel that matches an existing one via accent folding", () => {
    const r = validateItemImport([row({ artikel: "CAFÉ01" })], lookups({ existingItemSkus: new Set([skuMatchKey("cafe01")]) }));
    expect(codes(r)).toEqual(["ARTIKEL_EXISTS"]);
  });

  it("rejects a variant SKU differing from an existing one only by an accent", () => {
    const r = validateItemImport(
      [row({ warna: "Merah", skuVarian: "KMJ-01-MÉRAH" })],
      lookups({ existingVariantSkus: new Set([skuMatchKey("kmj-01-merah")]) }),
    );
    expect(codes(r)).toEqual(["VARIANT_SKU_TAKEN"]);
  });

  it("rejects a variant SKU or barcode used twice across artikels in the file", () => {
    /* Both typed SKUs carry a valid prefix (artikel `KMJ` and artikel `KMJ-01`), so neither is rewritten and they collide. */
    const skuClash = validateItemImport(
      [row({ artikel: "KMJ", warna: "Merah", skuVarian: "KMJ-01-M" }), row({ artikel: "KMJ-01", warna: "Merah", skuVarian: "KMJ-01-M" })],
      lookups(),
    );
    expect(skuClash.errors.map((e) => [e.code, e.detail])).toEqual([["DUPLICATE_IN_FILE", "KMJ-01-M"]]);
    const barcodeClash = validateItemImport(
      [row({ artikel: "A-1", warna: "Merah", barcode: "B1" }), row({ artikel: "B-1", warna: "Merah", barcode: "b1" })],
      lookups(),
    );
    expect(codes(barcodeClash)).toEqual(["DUPLICATE_IN_FILE"]);
  });

  it("rejects a generated variant SKU longer than the column allows, even when every cell is short enough", () => {
    const longArtikel = "A".repeat(180);
    const r = validateItemImport([row({ artikel: longArtikel, warna: "Merah Marun", ukuran: "XXL" })], lookups());
    expect(r.errors.map((e) => [e.code, e.column])).toEqual([["TOO_LONG", "skuVarian"]]);
  });

  it("rejects an over-long cell", () => {
    expect(codes(validateItemImport([row({ nama: "N".repeat(192) })], lookups()))).toEqual(["TOO_LONG"]);
  });

  it("refuses an empty list and more than the row cap", () => {
    expect(codes(validateItemImport([], lookups()))).toEqual(["EMPTY_FILE"]);
    const many = Array.from({ length: ITEM_IMPORT_MAX_ROWS + 1 }, (_, i) => row({ artikel: `A-${i}` }));
    expect(codes(validateItemImport(many, lookups()))).toEqual(["TOO_MANY_ROWS"]);
  });

  it("flags only the failing artikel in the preview", () => {
    const r = validateItemImport([row({ artikel: "OK-1" }), row({ artikel: "BAD-1", satuan: "BOX" })], lookups());
    expect(r.preview.map((p) => [p.artikel, p.hasErrors])).toEqual([["OK-1", false], ["BAD-1", true]]);
  });

  it("sorts errors by sheet row", () => {
    const r = validateItemImport([row({ artikel: "B-1", satuan: "BOX" }), row({ artikel: "" })], lookups());
    expect(r.errors.map((e) => e.row)).toEqual([...r.errors.map((e) => e.row)].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});

describe("parseItemImportPayload", () => {
  it("accepts rows shaped like the parser's output", () => {
    const rows = [row({})];
    expect(parseItemImportPayload(JSON.parse(JSON.stringify(rows)))).toEqual(rows);
  });

  it("refuses anything that is not an array of row objects", () => {
    expect(parseItemImportPayload(null)).toBeNull();
    expect(parseItemImportPayload({})).toBeNull();
    expect(parseItemImportPayload([{ row: "2" }])).toBeNull();
    expect(parseItemImportPayload([{ ...row({}), artikel: { x: 1 } }])).toBeNull();
  });
});
