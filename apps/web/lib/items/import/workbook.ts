import * as XLSX from "xlsx";
import {
  ITEM_IMPORT_COLUMNS,
  ITEM_IMPORT_GUIDE_SHEET,
  ITEM_IMPORT_MAX_LENGTH,
  ITEM_IMPORT_MAX_ROWS,
  ITEM_IMPORT_SHEET,
  importError,
  type ItemImportColumnKey,
  type ItemImportError,
  type ItemImportRow,
} from "./types";

/**
 * Runs in the BROWSER: the import page loads this module with a dynamic `import()`, so `xlsx`
 * never reaches another bundle and the server never parses an uploaded workbook. The server
 * validates the resulting rows from scratch, so nothing here is trusted.
 */

const HEADER_TO_KEY = new Map<string, ItemImportColumnKey>(
  ITEM_IMPORT_COLUMNS.map((c) => [c.header.trim().toLowerCase(), c.key]),
);

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? value.toFixed(0) : String(value);
  return String(value).trim();
}

/* One character past the cap is enough for the validator's TOO_LONG to fire, and keeps the payload bounded. */
function textCell(value: unknown): string {
  return cellText(value).slice(0, ITEM_IMPORT_MAX_LENGTH + 1);
}

function priceCell(value: unknown): string | number | null {
  if (typeof value === "number") return value;
  const text = textCell(value);
  return text === "" ? null : text;
}

/**
 * Excel turns text like a kids' size `3-4` typed into a General cell into a date, which the raw
 * value then carries as a serial such as `46085`. Such a cell is refused rather than imported as
 * that number; Harga Jual is the one numeric column and is never checked.
 */
function isDateCell(cell: XLSX.CellObject | undefined): boolean {
  if (!cell) return false;
  if (cell.t === "d") return true;
  return cell.t === "n" && typeof cell.z === "string" && Boolean(XLSX.SSF.is_date(cell.z));
}

const TEXT_COLUMNS = ITEM_IMPORT_COLUMNS.filter((c) => c.key !== "hargaJual").map((c) => c.key);

export function parseItemImportWorkbook(data: ArrayBuffer): { rows: ItemImportRow[]; errors: ItemImportError[] } {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "array", cellNF: true });
  } catch {
    return { rows: [], errors: [importError("UNREADABLE_FILE")] };
  }
  const sheet = workbook.Sheets[ITEM_IMPORT_SHEET];
  if (!sheet) return { rows: [], errors: [importError("MISSING_SHEET", { detail: ITEM_IMPORT_SHEET })] };

  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : { s: { r: 0, c: 0 } };
  const firstRow = range.s.r + 1;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true });
  if (grid.length === 0) return { rows: [], errors: [importError("EMPTY_FILE")] };

  const headerCells = grid[0].map((h) => cellText(h).toLowerCase());
  const indexByKey = new Map<ItemImportColumnKey, number>();
  headerCells.forEach((h, i) => {
    const key = HEADER_TO_KEY.get(h);
    if (key && !indexByKey.has(key)) indexByKey.set(key, i);
  });
  const missing = ITEM_IMPORT_COLUMNS.filter((c) => c.required && !indexByKey.has(c.key));
  if (missing.length > 0) {
    return { rows: [], errors: missing.map((c) => importError("MISSING_HEADER", { detail: c.header })) };
  }

  const read = (cells: unknown[], key: ItemImportColumnKey): unknown => {
    const i = indexByKey.get(key);
    return i === undefined ? "" : cells[i];
  };

  const rows: ItemImportRow[] = [];
  const rowErrors: ItemImportError[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (cells.every((c) => cellText(c) === "")) continue;
    for (const key of TEXT_COLUMNS) {
      const col = indexByKey.get(key);
      if (col === undefined) continue;
      const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r + i, c: range.s.c + col })] as XLSX.CellObject | undefined;
      if (isDateCell(cell)) rowErrors.push(importError("DATE_CELL", { row: firstRow + i, column: key }));
    }
    rows.push({
      row: firstRow + i,
      artikel: textCell(read(cells, "artikel")),
      nama: textCell(read(cells, "nama")),
      namaEn: textCell(read(cells, "namaEn")),
      kategori: textCell(read(cells, "kategori")),
      satuan: textCell(read(cells, "satuan")),
      hargaJual: priceCell(read(cells, "hargaJual")),
      warna: textCell(read(cells, "warna")),
      ukuran: textCell(read(cells, "ukuran")),
      skuVarian: textCell(read(cells, "skuVarian")),
      barcode: textCell(read(cells, "barcode")),
      deskripsi: textCell(read(cells, "deskripsi")),
    });
  }

  if (rows.length === 0) return { rows: [], errors: [importError("EMPTY_FILE")] };
  if (rows.length > ITEM_IMPORT_MAX_ROWS) {
    return { rows: [], errors: [importError("TOO_MANY_ROWS", { detail: String(ITEM_IMPORT_MAX_ROWS) })] };
  }
  /* Row-level errors travel WITH the rows: the page merges them into the preview's errors, so commit stays blocked. */
  return { rows, errors: rowErrors };
}

const TEMPLATE_EXAMPLE: unknown[][] = [
  ["KMJ-001", "Kemeja Batik Parang", "Parang Batik Shirt", "", "PCS", 250000, "Merah", "M", "", "", ""],
  ["KMJ-001", "Kemeja Batik Parang", "Parang Batik Shirt", "", "PCS", 250000, "Merah", "L", "", "", ""],
  ["KMJ-001", "Kemeja Batik Parang", "Parang Batik Shirt", "", "PCS", 250000, "Biru", "M", "", "", ""],
  ["KMJ-001", "Kemeja Batik Parang", "Parang Batik Shirt", "", "PCS", 250000, "Biru", "L", "", "", ""],
  ["SYL-001", "Syal Tenun", "", "", "PCS", 90000, "", "", "", "", ""],
];

const TEMPLATE_GUIDE: string[][] = [
  ["Kolom", "Wajib", "Keterangan"],
  ["Artikel (SKU)", "Ya", "SKU produk. Baris dengan Artikel yang sama menjadi satu produk dengan beberapa varian."],
  ["Nama", "Ya", "Nama produk. Harus sama di semua baris satu Artikel."],
  ["Nama (EN)", "Tidak", "Nama dalam bahasa Inggris. Kosong = sama dengan Nama."],
  ["Kategori", "Tidak", "Kode atau nama kategori yang sudah ada."],
  ["Satuan", "Ya", "Kode satuan yang sudah ada, misalnya PCS."],
  ["Harga Jual", "Tidak", "Angka saja, tanpa titik atau koma, misalnya 250000."],
  ["Warna", "Tidak", "Atribut varian."],
  ["Ukuran", "Tidak", "Atribut varian. Format sel sebagai Teks agar ukuran seperti 3-4 tidak berubah menjadi tanggal."],
  ["SKU Varian", "Tidak", "Kosong = dibuat otomatis dari Artikel, Warna dan Ukuran (misalnya KMJ-001-MERAH-M). Jika diisi, harus diawali Artikel atau kode Kategori; jika tidak, SKU akan diubah."],
  ["Barcode", "Tidak", "Barcode varian. Format sel sebagai Teks agar angka panjang tidak berubah."],
  ["Deskripsi", "Tidak", "Harus sama di semua baris satu Artikel."],
  ["", "", ""],
  ["Produk tanpa varian", "", "Isi satu baris saja dan kosongkan Warna, Ukuran dan SKU Varian."],
  ["Atribut varian konsisten", "", "Setiap baris varian harus punya Warna atau Ukuran, dan kolom yang dipakai harus terisi di semua baris satu Artikel."],
  ["Sel Teks", "", "Format kolom Ukuran dan Barcode sebagai Teks sebelum mengisi, agar Excel tidak mengubah 3-4 menjadi tanggal atau memotong angka panjang."],
  ["Semua atau tidak sama sekali", "", "Jika ada satu error, tidak ada produk yang dibuat. Perbaiki file lalu upload ulang."],
];

export function buildItemImportTemplate(): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const products = XLSX.utils.aoa_to_sheet([ITEM_IMPORT_COLUMNS.map((c) => c.header), ...TEMPLATE_EXAMPLE]);
  products["!cols"] = ITEM_IMPORT_COLUMNS.map((c) => ({ wch: Math.max(12, c.header.length + 4) }));
  XLSX.utils.book_append_sheet(workbook, products, ITEM_IMPORT_SHEET);
  const guide = XLSX.utils.aoa_to_sheet(TEMPLATE_GUIDE);
  guide["!cols"] = [{ wch: 28 }, { wch: 8 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, guide, ITEM_IMPORT_GUIDE_SHEET);
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}
