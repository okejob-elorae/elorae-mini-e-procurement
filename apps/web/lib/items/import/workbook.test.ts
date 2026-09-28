import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildItemImportTemplate, parseItemImportWorkbook } from "./workbook";
import { ITEM_IMPORT_MAX_LENGTH, ITEM_IMPORT_MAX_ROWS } from "./types";

function workbookFrom(aoa: unknown[][], sheetName = "Produk"): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

const HEADERS = ["Artikel (SKU)", "Nama", "Nama (EN)", "Kategori", "Satuan", "Harga Jual", "Warna", "Ukuran", "SKU Varian", "Barcode", "Deskripsi"];

describe("parseItemImportWorkbook", () => {
  it("round-trips the downloadable template into rows numbered like the sheet", () => {
    const { rows, errors } = parseItemImportWorkbook(buildItemImportTemplate());
    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].row).toBe(2);
    expect(typeof rows[0].hargaJual).toBe("number");
  });

  it("maps columns by header text regardless of order and case", () => {
    const { rows, errors } = parseItemImportWorkbook(
      workbookFrom([
        ["satuan", "NAMA", "Artikel (SKU)", "Ukuran"],
        ["PCS", "Kemeja", "KMJ-01", "M"],
      ]),
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ row: 2, artikel: "KMJ-01", nama: "Kemeja", satuan: "PCS", ukuran: "M", warna: "", hargaJual: null });
  });

  it("turns numeric text cells into strings, keeping Harga Jual numeric", () => {
    const { rows } = parseItemImportWorkbook(
      workbookFrom([
        HEADERS,
        ["SPT-01", "Sepatu", "", "", "PCS", 350000, "Hitam", 42, "", 8990001234567, ""],
      ]),
    );
    expect(rows[0]).toMatchObject({ ukuran: "42", barcode: "8990001234567", hargaJual: 350000 });
  });

  it("clips an over-long text cell to one character past the cap, so TOO_LONG still fires", () => {
    const { rows } = parseItemImportWorkbook(
      workbookFrom([
        HEADERS,
        ["A-1", "N".repeat(500), "", "", "PCS", "", "", "", "", "", ""],
      ]),
    );
    expect(rows[0].nama).toHaveLength(ITEM_IMPORT_MAX_LENGTH + 1);
  });

  it("reports a date-formatted text cell as DATE_CELL on its row and column, still returning the rows", () => {
    const { rows, errors } = parseItemImportWorkbook(
      workbookFrom([
        HEADERS,
        ["KID-01", "Kaos Anak", "", "", "PCS", 50000, "Merah", new Date(2026, 2, 4), "", "", ""],
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => [e.code, e.row, e.column])).toEqual([["DATE_CELL", 2, "ukuran"]]);
  });

  it("ships a template whose example artikel lists the whole Warna x Ukuran grid", () => {
    const { rows } = parseItemImportWorkbook(buildItemImportTemplate());
    const pairs = rows.filter((r) => r.artikel === "KMJ-001").map((r) => `${r.warna}/${r.ukuran}`);
    expect(pairs.sort()).toEqual(["Biru/L", "Biru/M", "Merah/L", "Merah/M"]);
  });

  it("skips blank rows but keeps the sheet's own row numbers", () => {
    const { rows } = parseItemImportWorkbook(
      workbookFrom([
        HEADERS,
        ["A-1", "A", "", "", "PCS", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", ""],
        ["B-1", "B", "", "", "PCS", "", "", "", "", "", ""],
      ]),
    );
    expect(rows.map((r) => [r.row, r.artikel])).toEqual([[2, "A-1"], [4, "B-1"]]);
  });

  it("reports each missing required header and returns no rows", () => {
    const { rows, errors } = parseItemImportWorkbook(workbookFrom([["Nama", "Warna"], ["X", "Merah"]]));
    expect(rows).toEqual([]);
    expect(errors.map((e) => [e.code, e.detail])).toEqual([
      ["MISSING_HEADER", "Artikel (SKU)"],
      ["MISSING_HEADER", "Satuan"],
    ]);
  });

  it("refuses a workbook without the Produk sheet", () => {
    expect(parseItemImportWorkbook(workbookFrom([HEADERS], "Sheet1")).errors.map((e) => e.code)).toEqual(["MISSING_SHEET"]);
  });

  it("refuses a sheet with a header but no data rows", () => {
    expect(parseItemImportWorkbook(workbookFrom([HEADERS])).errors.map((e) => e.code)).toEqual(["EMPTY_FILE"]);
  });

  it("refuses more than the row cap without returning rows", () => {
    const body = Array.from({ length: ITEM_IMPORT_MAX_ROWS + 1 }, (_, i) => [`A-${i}`, "A", "", "", "PCS", "", "", "", "", "", ""]);
    const { rows, errors } = parseItemImportWorkbook(workbookFrom([HEADERS, ...body]));
    expect(rows).toEqual([]);
    expect(errors.map((e) => e.code)).toEqual(["TOO_MANY_ROWS"]);
  });

  it("reports an unreadable file instead of throwing", () => {
    const { rows, errors } = parseItemImportWorkbook(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(rows).toEqual([]);
    expect(["UNREADABLE_FILE", "MISSING_SHEET"]).toContain(errors[0].code);
  });
});
