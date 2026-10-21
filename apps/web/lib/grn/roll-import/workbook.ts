import * as XLSX from "xlsx";
import {
  GRN_ROLL_IMPORT_COLUMNS,
  GRN_ROLL_IMPORT_GUIDE_SHEET,
  GRN_ROLL_IMPORT_LINES_SHEET,
  GRN_ROLL_IMPORT_MAX_LENGTH,
  GRN_ROLL_IMPORT_MAX_ROWS,
  GRN_ROLL_IMPORT_SHEET,
  rollImportError,
  type GrnRollImportColumnKey,
  type GrnRollImportError,
  type GrnRollImportRow,
  type GrnRollImportTargetLine,
} from "./types";

/**
 * Runs in the BROWSER: the GRN form loads this module with a dynamic `import()`, so `xlsx`
 * never reaches another bundle and the server never parses an uploaded workbook. The rows are
 * validated afterwards from scratch, so nothing here is trusted.
 */

const HEADER_TO_KEY = new Map<string, GrnRollImportColumnKey>(
  GRN_ROLL_IMPORT_COLUMNS.map((c) => [c.header.trim().toLowerCase(), c.key]),
);

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? value.toFixed(0) : String(value);
  return String(value).trim();
}

/* One character past the cap is enough for the validator's TOO_LONG to fire, and keeps the payload bounded. */
function textCell(value: unknown): string {
  return cellText(value).slice(0, GRN_ROLL_IMPORT_MAX_LENGTH + 1);
}

function lengthCell(value: unknown): string | number | null {
  if (typeof value === "number") return value;
  const text = textCell(value);
  return text === "" ? null : text;
}

/**
 * Excel turns text like `1-2` or, under an id-ID locale, a length like `12.5` typed into a General
 * cell into a date, which the raw value then carries as a serial such as `46086`. Such a cell is
 * refused rather than imported as that number, Panjang included.
 */
function isDateCell(cell: XLSX.CellObject | undefined): boolean {
  if (!cell) return false;
  if (cell.t === "d") return true;
  return cell.t === "n" && typeof cell.z === "string" && Boolean(XLSX.SSF.is_date(cell.z));
}

/**
 * A number typed into a cell with a custom format (`0000` on No. Roll turns 12 into "0012") keeps
 * only the bare number as its raw value, so for No. Roll the formatted text is what the person sees
 * and wins. General-format cells keep the raw value, since Excel's General display rounds long digit
 * runs into scientific notation. Only No. Roll reads it: SKU and Varian SKU must match the form's
 * codes, which a `0.00` or `#,##0` format would turn into "10234.00" or "10,234".
 */
function formattedNumber(cell: XLSX.CellObject | undefined): string | null {
  if (!cell || cell.t !== "n" || typeof cell.w !== "string" || cell.w === "") return null;
  if (typeof cell.z !== "string" || cell.z === "General") return null;
  return cell.w.trim();
}

export function parseGrnRollImportWorkbook(data: ArrayBuffer): { rows: GrnRollImportRow[]; errors: GrnRollImportError[] } {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "array", cellNF: true });
  } catch {
    return { rows: [], errors: [rollImportError("UNREADABLE_FILE")] };
  }
  const sheet = workbook.Sheets[GRN_ROLL_IMPORT_SHEET];
  if (!sheet) return { rows: [], errors: [rollImportError("MISSING_SHEET", { detail: GRN_ROLL_IMPORT_SHEET })] };

  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : { s: { r: 0, c: 0 } };
  const firstRow = range.s.r + 1;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true });
  if (grid.length === 0) return { rows: [], errors: [rollImportError("EMPTY_FILE")] };

  const headerCells = grid[0].map((h) => cellText(h).toLowerCase());
  const indexByKey = new Map<GrnRollImportColumnKey, number>();
  headerCells.forEach((h, i) => {
    const key = HEADER_TO_KEY.get(h);
    if (key && !indexByKey.has(key)) indexByKey.set(key, i);
  });
  const missing = GRN_ROLL_IMPORT_COLUMNS.filter((c) => c.required && !indexByKey.has(c.key));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: missing.map((c) => rollImportError("MISSING_HEADER", { column: c.key, detail: c.header })),
    };
  }

  const read = (cells: unknown[], key: GrnRollImportColumnKey): unknown => {
    const i = indexByKey.get(key);
    return i === undefined ? "" : cells[i];
  };

  const rows: GrnRollImportRow[] = [];
  const rowErrors: GrnRollImportError[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (cells.every((c) => cellText(c) === "")) continue;
    const formatted = new Map<GrnRollImportColumnKey, string>();
    for (const { key } of GRN_ROLL_IMPORT_COLUMNS) {
      const col = indexByKey.get(key);
      if (col === undefined) continue;
      const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r + i, c: range.s.c + col })] as XLSX.CellObject | undefined;
      if (isDateCell(cell)) rowErrors.push(rollImportError("DATE_CELL", { row: firstRow + i, column: key }));
      const shown = key === "noRoll" ? formattedNumber(cell) : null;
      if (shown !== null) formatted.set(key, shown);
    }
    const text = (key: GrnRollImportColumnKey): string => {
      const shown = formatted.get(key);
      return shown === undefined ? textCell(read(cells, key)) : textCell(shown);
    };
    rows.push({
      row: firstRow + i,
      sku: text("sku"),
      varianSku: text("varianSku"),
      panjang: lengthCell(read(cells, "panjang")),
      noRoll: text("noRoll"),
      catatan: text("catatan"),
    });
  }

  if (rows.length > GRN_ROLL_IMPORT_MAX_ROWS) {
    return { rows: [], errors: [rollImportError("TOO_MANY_ROWS", { detail: String(GRN_ROLL_IMPORT_MAX_ROWS) })] };
  }
  /* Row-level errors travel WITH the rows: the caller merges them into the validator's errors, so commit stays blocked. */
  return { rows, errors: rowErrors };
}

const LINES_HEADERS = ["SKU", "Varian SKU", "Nama", "Satuan", "Dipesan", "Sudah diterima", "Sisa"];

const TEMPLATE_GUIDE: string[][] = [
  ["Kolom", "Wajib", "Keterangan"],
  ["SKU", "Ya", "SKU kain. Salin dari sheet Daftar Kain."],
  ["Varian SKU", "Tidak", "SKU varian. Salin dari sheet Daftar Kain; kosongkan jika kain tidak punya varian."],
  ["Panjang", "Ya", "Panjang satu rol dalam satuan kain (lihat kolom Satuan di sheet Daftar Kain). Angka saja, maksimal 2 desimal."],
  ["No. Roll", "Tidak", "Nomor atau kode rol. Format kolom sebagai Teks agar Excel tidak mengubahnya menjadi tanggal."],
  ["Catatan", "Tidak", "Catatan untuk rol ini."],
  ["", "", ""],
  ["Satu baris satu rol", "", "Isi satu baris untuk setiap rol. Kain yang sama boleh muncul di banyak baris."],
  ["Sheet Daftar Kain", "", "Hanya referensi untuk disalin; sheet ini tidak dibaca saat import."],
];

export function buildGrnRollImportTemplate(lines: GrnRollImportTargetLine[]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();

  const rolls = XLSX.utils.aoa_to_sheet([GRN_ROLL_IMPORT_COLUMNS.map((c) => c.header)]);
  rolls["!cols"] = GRN_ROLL_IMPORT_COLUMNS.map((c) => ({ wch: Math.max(14, c.header.length + 4) }));
  XLSX.utils.book_append_sheet(workbook, rolls, GRN_ROLL_IMPORT_SHEET);

  const reference = XLSX.utils.aoa_to_sheet([
    LINES_HEADERS,
    ...lines.map((l) => [
      l.sku,
      l.variantSku ?? "",
      l.name,
      l.uomCode,
      l.orderedQty ?? "",
      l.orderedQty === null ? "" : (l.alreadyReceivedQty ?? 0),
      l.orderedQty === null ? "" : Math.max(0, l.orderedQty - (l.alreadyReceivedQty ?? 0)),
    ]),
  ]);
  reference["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 32 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(workbook, reference, GRN_ROLL_IMPORT_LINES_SHEET);

  const guide = XLSX.utils.aoa_to_sheet(TEMPLATE_GUIDE);
  guide["!cols"] = [{ wch: 24 }, { wch: 8 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, guide, GRN_ROLL_IMPORT_GUIDE_SHEET);

  return XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}
