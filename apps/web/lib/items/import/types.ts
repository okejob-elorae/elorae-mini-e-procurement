export const ITEM_IMPORT_MAX_ROWS = 1000;
export const ITEM_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const ITEM_IMPORT_SHEET = "Produk";
export const ITEM_IMPORT_GUIDE_SHEET = "Petunjuk";
export const ITEM_IMPORT_MAX_LENGTH = 191;

export const ITEM_IMPORT_COLUMNS = [
  { key: "artikel", header: "Artikel (SKU)", required: true },
  { key: "nama", header: "Nama", required: true },
  { key: "namaEn", header: "Nama (EN)", required: false },
  { key: "kategori", header: "Kategori", required: false },
  { key: "satuan", header: "Satuan", required: true },
  { key: "hargaJual", header: "Harga Jual", required: false },
  { key: "warna", header: "Warna", required: false },
  { key: "ukuran", header: "Ukuran", required: false },
  { key: "skuVarian", header: "SKU Varian", required: false },
  { key: "barcode", header: "Barcode", required: false },
  { key: "deskripsi", header: "Deskripsi", required: false },
] as const;

export type ItemImportColumnKey = (typeof ITEM_IMPORT_COLUMNS)[number]["key"];

/** One sheet row after parsing; `row` is the sheet's own row number (header = 1). */
export type ItemImportRow = {
  row: number;
  artikel: string;
  nama: string;
  namaEn: string;
  kategori: string;
  satuan: string;
  hargaJual: string | number | null;
  warna: string;
  ukuran: string;
  skuVarian: string;
  barcode: string;
  deskripsi: string;
};

export const ITEM_IMPORT_ERROR_CODES = [
  "NOT_XLSX",
  "FILE_TOO_LARGE",
  "UNREADABLE_FILE",
  "MISSING_SHEET",
  "MISSING_HEADER",
  "EMPTY_FILE",
  "TOO_MANY_ROWS",
  "INVALID_PAYLOAD",
  "REQUIRED",
  "INVALID_NUMBER",
  "NEGATIVE_NUMBER",
  "UNKNOWN_UOM",
  "UNKNOWN_CATEGORY",
  "TOO_LONG",
  "VARIANTLESS_BARCODE",
  "INCONSISTENT_ARTIKEL",
  "MIXED_VARIANTLESS",
  "DUPLICATE_VARIANT",
  "ARTIKEL_EXISTS",
  "VARIANT_SKU_TAKEN",
  "BARCODE_TAKEN",
  "DUPLICATE_IN_FILE",
  "SKU_TAKEN",
] as const;

export type ItemImportErrorCode = (typeof ITEM_IMPORT_ERROR_CODES)[number];

export type ItemImportError = {
  code: ItemImportErrorCode;
  row: number | null;
  column: ItemImportColumnKey | null;
  artikel: string | null;
  detail: string | null;
};

export function importError(
  code: ItemImportErrorCode,
  fields: Partial<Omit<ItemImportError, "code">> = {},
): ItemImportError {
  return {
    code,
    row: fields.row ?? null,
    column: fields.column ?? null,
    artikel: fields.artikel ?? null,
    detail: fields.detail ?? null,
  };
}

export type ItemImportPreviewVariant = {
  row: number;
  warna: string;
  ukuran: string;
  barcode: string | null;
  /** What the sheet typed in SKU Varian, or null when blank. */
  typedSku: string | null;
  /** The SKU that will be stored; null when normalisation could not run for this artikel. */
  finalSku: string | null;
};

export type ItemImportPreviewItem = {
  artikel: string;
  nameId: string;
  rows: number[];
  variantless: boolean;
  variants: ItemImportPreviewVariant[];
  hasErrors: boolean;
};

export type ItemImportPlannedItem = {
  sku: string;
  nameId: string;
  nameEn: string;
  uomId: string;
  categoryId: string | null;
  sellingPrice: number | null;
  description: string | null;
  variants: Array<Record<string, string>>;
};

export type ItemImportPlan = { items: ItemImportPlannedItem[] };

export type ItemImportValidatedResult = {
  errors: ItemImportError[];
  preview: ItemImportPreviewItem[];
  artikelCount: number;
  variantCount: number;
};

export type ItemImportPreviewResult =
  | { status: "forbidden" }
  | ({ status: "validated" } & ItemImportValidatedResult);

export type ItemImportCommitResult =
  | { status: "forbidden" }
  | ({ status: "invalid" } & ItemImportValidatedResult)
  | {
      status: "created";
      items: Array<{ id: string; sku: string; nameId: string }>;
      variantCount: number;
      jubelioRequested: boolean;
      jubelioFailed: number;
    }
  | { status: "failed" };
