import * as XLSX from "xlsx";
import {
  ITEM_IMPORT_COLUMNS,
  ITEM_IMPORT_GUIDE_SHEET,
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

function priceCell(value: unknown): string | number | null {
  if (typeof value === "number") return value;
  const text = cellText(value);
  return text === "" ? null : text;
}

export function parseItemImportWorkbook(data: ArrayBuffer): { rows: ItemImportRow[]; errors: ItemImportError[] } {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "array" });
  } catch {
    return { rows: [], errors: [importError("UNREADABLE_FILE")] };
  }
  const sheet = workbook.Sheets[ITEM_IMPORT_SHEET];
  if (!sheet) return { rows: [], errors: [importError("MISSING_SHEET", { detail: ITEM_IMPORT_SHEET })] };

  const firstRow = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r + 1 : 1;
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
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (cells.every((c) => cellText(c) === "")) continue;
    rows.push({
      row: firstRow + i,
      artikel: cellText(read(cells, "artikel")),
      nama: cellText(read(cells, "nama")),
      namaEn: cellText(read(cells, "namaEn")),
      kategori: cellText(read(cells, "kategori")),
      satuan: cellText(read(cells, "satuan")),
      hargaJual: priceCell(read(cells, "hargaJual")),
      warna: cellText(read(cells, "warna")),
      ukuran: cellText(read(cells, "ukuran")),
      skuVarian: cellText(read(cells, "skuVarian")),
      barcode: cellText(read(cells, "barcode")),
      deskripsi: cellText(read(cells, "deskripsi")),
    });
  }

  if (rows.length === 0) return { rows: [], errors: [importError("EMPTY_FILE")] };
  if (rows.length > ITEM_IMPORT_MAX_ROWS) {
    return { rows: [], errors: [importError("TOO_MANY_ROWS", { detail: String(ITEM_IMPORT_MAX_ROWS) })] };
  }
  return { rows, errors: [] };
}

const TEMPLATE_EXAMPLE: unknown[][] = [
  ["KMJ-001", "Kemeja Batik Parang", "Parang Batik Shirt", "", "PCS", 250000, "Merah", "M", "", "", ""],
  ["KMJ-001", "Kemeja Batik Parang", "Parang Batik Shirt", "", "PCS", 250000, "Merah", "L", "", "", ""],
  ["KMJ-001", "Kemeja Batik Parang", "Parang Batik Shirt", "", "PCS", 250000, "Biru", "M", "", "", ""],
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
  ["Ukuran", "Tidak", "Atribut varian."],
  ["SKU Varian", "Tidak", "Kosong = dibuat otomatis dari Artikel, Warna dan Ukuran (misalnya KMJ-001-MERAH-M)."],
  ["Barcode", "Tidak", "Barcode varian. Format sel sebagai Teks agar angka panjang tidak berubah."],
  ["Deskripsi", "Tidak", "Harus sama di semua baris satu Artikel."],
  ["", "", ""],
  ["Produk tanpa varian", "", "Isi satu baris saja dan kosongkan Warna, Ukuran dan SKU Varian."],
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
