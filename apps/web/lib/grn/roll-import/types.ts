export const GRN_ROLL_IMPORT_MAX_ROWS = 2000;
export const GRN_ROLL_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const GRN_ROLL_IMPORT_SHEET = "Rol";
export const GRN_ROLL_IMPORT_LINES_SHEET = "Daftar Kain";
export const GRN_ROLL_IMPORT_GUIDE_SHEET = "Petunjuk";
export const GRN_ROLL_IMPORT_MAX_LENGTH = 191;
export const GRN_ROLL_MAX_VALUE = 99_999_999.99;

export const GRN_ROLL_IMPORT_COLUMNS = [
  { key: "sku", header: "SKU", required: true },
  { key: "varianSku", header: "Varian SKU", required: false },
  { key: "panjang", header: "Panjang", required: true },
  { key: "noRoll", header: "No. Roll", required: false },
  { key: "catatan", header: "Catatan", required: false },
] as const;

export type GrnRollImportColumnKey = (typeof GRN_ROLL_IMPORT_COLUMNS)[number]["key"];

/* One sheet row after parsing; `row` is the sheet's own row number (header = 1). */
export type GrnRollImportRow = {
  row: number;
  sku: string;
  varianSku: string;
  panjang: string | number | null;
  noRoll: string;
  catatan: string;
};

export const GRN_ROLL_IMPORT_ERROR_CODES = [
  "NOT_XLSX",
  "FILE_TOO_LARGE",
  "UNREADABLE_FILE",
  "MISSING_SHEET",
  "MISSING_HEADER",
  "EMPTY_FILE",
  "TOO_MANY_ROWS",
  "AMBIGUOUS_LINE",
  "REQUIRED",
  "UNKNOWN_LINE",
  "INVALID_NUMBER",
  "NOT_POSITIVE",
  "TOO_MANY_DECIMALS",
  "TOO_LARGE",
  "TOO_LONG",
  "DATE_CELL",
  "DUPLICATE_REF",
] as const;

export type GrnRollImportErrorCode = (typeof GRN_ROLL_IMPORT_ERROR_CODES)[number];

export type GrnRollImportError = {
  code: GrnRollImportErrorCode;
  row: number | null;
  column: GrnRollImportColumnKey | null;
  detail: string | null;
};

export function rollImportError(
  code: GrnRollImportErrorCode,
  fields: Partial<Omit<GrnRollImportError, "code">> = {},
): GrnRollImportError {
  return {
    code,
    row: fields.row ?? null,
    column: fields.column ?? null,
    detail: fields.detail ?? null,
  };
}

export type GrnRollImportTargetLine = {
  lineId: string;
  sku: string;
  variantSku: string | null;
  name: string;
  uomCode: string;
  orderedQty: number | null;
  alreadyReceivedQty: number | null;
};

export type ImportedRoll = { length: number; ref: string | null; notes: string | null };

export type GrnRollImportLineSummary = {
  lineId: string;
  sku: string;
  variantSku: string | null;
  name: string;
  uomCode: string;
  rollCount: number;
  totalLength: number;
  orderedQty: number | null;
  alreadyReceivedQty: number | null;
  afterQty: number | null;
  overBy: number | null;
};

export type GrnRollImportResult = {
  errors: GrnRollImportError[];
  summary: GrnRollImportLineSummary[];
  plan: Record<string, ImportedRoll[]> | null;
};
