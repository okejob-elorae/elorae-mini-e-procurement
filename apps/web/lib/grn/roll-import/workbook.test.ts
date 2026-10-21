import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildGrnRollImportTemplate, parseGrnRollImportWorkbook } from "./workbook";
import { GRN_ROLL_IMPORT_MAX_ROWS, type GrnRollImportTargetLine } from "./types";

function workbookFrom(aoa: unknown[][], sheetName = "Rol"): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

const HEADERS = ["SKU", "Varian SKU", "Panjang", "No. Roll", "Catatan"];

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
  name: "Satin",
  uomCode: "MTR",
  orderedQty: null,
  alreadyReceivedQty: null,
};

describe("buildGrnRollImportTemplate", () => {
  it("round-trips to zero rows and lists the fabric lines on Daftar Kain", () => {
    const data = buildGrnRollImportTemplate([L1, L2]);
    expect(parseGrnRollImportWorkbook(data)).toEqual({ rows: [], errors: [] });

    const wb = XLSX.read(data, { type: "array" });
    expect(wb.SheetNames).toEqual(["Rol", "Daftar Kain", "Petunjuk"]);
    const reference = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Daftar Kain"], { header: 1, defval: "" });
    expect(reference[1]).toEqual(["FAB-01", "", "Katun", "YD", 100, 20, 80]);
    expect(reference[2]).toEqual(["FAB-02", "FAB-02-RED", "Satin", "MTR", "", "", ""]);
  });
});

describe("parseGrnRollImportWorkbook", () => {
  it("parses filled rows with the sheet's own row numbers, skipping blank rows", () => {
    const { rows, errors } = parseGrnRollImportWorkbook(
      workbookFrom([
        HEADERS,
        ["FAB-01", "", 25.5, "A1", "ok"],
        ["", "", "", "", ""],
        ["FAB-01", "", "30,5", "A2", ""],
      ]),
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { row: 2, sku: "FAB-01", varianSku: "", panjang: 25.5, noRoll: "A1", catatan: "ok" },
      { row: 4, sku: "FAB-01", varianSku: "", panjang: "30,5", noRoll: "A2", catatan: "" },
    ]);
  });

  it("keeps a half-filled row so the validator can raise REQUIRED", () => {
    const { rows } = parseGrnRollImportWorkbook(workbookFrom([HEADERS, ["FAB-01", "", "", "A1", ""]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sku: "FAB-01", noRoll: "A1", panjang: null });
  });

  it("matches headers case-insensitively and reports a missing Panjang header", () => {
    const ok = parseGrnRollImportWorkbook(workbookFrom([["sku", "VARIAN SKU", "panjang"], ["FAB-01", "", 10]]));
    expect(ok.errors).toEqual([]);
    expect(ok.rows[0]).toMatchObject({ sku: "FAB-01", panjang: 10 });

    const missing = parseGrnRollImportWorkbook(workbookFrom([["SKU", "No. Roll"], ["FAB-01", "A1"]]));
    expect(missing.rows).toEqual([]);
    expect(missing.errors.map((e) => [e.code, e.column])).toEqual([["MISSING_HEADER", "panjang"]]);
  });

  it("refuses a workbook without the Rol sheet", () => {
    expect(parseGrnRollImportWorkbook(workbookFrom([HEADERS], "Sheet1")).errors.map((e) => e.code)).toEqual(["MISSING_SHEET"]);
  });

  it("reports an unreadable file instead of throwing", () => {
    const { rows, errors } = parseGrnRollImportWorkbook(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(rows).toEqual([]);
    expect(["UNREADABLE_FILE", "MISSING_SHEET"]).toContain(errors[0].code);
  });

  it("refuses more than the row cap without returning rows", () => {
    const body = Array.from({ length: GRN_ROLL_IMPORT_MAX_ROWS + 1 }, () => ["FAB-01", "", 10, "", ""]);
    const { rows, errors } = parseGrnRollImportWorkbook(workbookFrom([HEADERS, ...body]));
    expect(rows).toEqual([]);
    expect(errors.map((e) => e.code)).toEqual(["TOO_MANY_ROWS"]);
  });

  it("reports a date-formatted No. Roll cell as DATE_CELL, still returning the row", () => {
    const { rows, errors } = parseGrnRollImportWorkbook(
      workbookFrom([HEADERS, ["FAB-01", "", 10, new Date(2026, 2, 4), ""]]),
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => [e.code, e.row, e.column])).toEqual([["DATE_CELL", 2, "noRoll"]]);
  });

  it("reports a date-formatted Panjang cell as DATE_CELL instead of accepting its serial", () => {
    const { errors } = parseGrnRollImportWorkbook(
      workbookFrom([HEADERS, ["FAB-01", "", new Date(2026, 4, 12), "", ""]]),
    );
    expect(errors.map((e) => [e.code, e.row, e.column])).toEqual([["DATE_CELL", 2, "panjang"]]);
  });
});
