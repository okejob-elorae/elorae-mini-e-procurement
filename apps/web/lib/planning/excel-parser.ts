import * as XLSX from "xlsx";
import {
  excelMonthlyCmtRowSchema,
  excelMonthlyColorRowSchema,
  excelPlanRowSchema,
} from "@/lib/validations/planning";

export interface ParsedPlanExcelRow {
  rowNumber: number;
  code: string;
  name: string;
  description?: string;
  parentCode?: string;
  targetQty?: number | null;
  parentSharePercent?: number | null;
  itemSku?: string | null;
  itemCategoryCode?: string | null;
}

export interface ParsedMonthlyColorRow {
  rowNumber: number;
  code: string;
  month: number;
  variantSku: string;
  qty: number;
}

export interface ParsedMonthlyCmtRow {
  rowNumber: number;
  code: string;
  month: number;
  variantSku: string;
  supplierCode: string;
  qty: number;
}

export interface ParsePlanExcelResult {
  rows: ParsedPlanExcelRow[];
  monthlyColors: ParsedMonthlyColorRow[];
  monthlyCmt: ParsedMonthlyCmtRow[];
  errors: Array<{ row: number; message: string; sheet?: string }>;
}

const CATEGORY_HEADER_ALIASES: Record<string, keyof Omit<ParsedPlanExcelRow, "rowNumber">> = {
  code: "code",
  kode: "code",
  jenis: "code",
  name: "name",
  nama: "name",
  keterangan: "name",
  description: "description",
  parentcode: "parentCode",
  parent: "parentCode",
  parent_code: "parentCode",
  targetqty: "targetQty",
  target: "targetQty",
  plan: "targetQty",
  parentsharepercent: "parentSharePercent",
  share: "parentSharePercent",
  sharepercent: "parentSharePercent",
  itemsku: "itemSku",
  sku: "itemSku",
  item: "itemSku",
  itemcategorycode: "itemCategoryCode",
  categorycode: "itemCategoryCode",
  kategoricode: "itemCategoryCode",
};

const COLOR_HEADER_ALIASES: Record<string, keyof Omit<ParsedMonthlyColorRow, "rowNumber">> = {
  code: "code",
  kode: "code",
  month: "month",
  bulan: "month",
  variantsku: "variantSku",
  variant: "variantSku",
  sku: "variantSku",
  qty: "qty",
  quantity: "qty",
  allocatedqty: "qty",
};

const CMT_HEADER_ALIASES: Record<string, keyof Omit<ParsedMonthlyCmtRow, "rowNumber">> = {
  code: "code",
  kode: "code",
  month: "month",
  bulan: "month",
  variantsku: "variantSku",
  variant: "variantSku",
  suppliercode: "supplierCode",
  supplier: "supplierCode",
  vendorcode: "supplierCode",
  qty: "qty",
  quantity: "qty",
  allocatedqty: "qty",
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function toOptionalNumber(value: unknown): number | null | undefined {
  if (value === "" || value == null) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function parseSheetRows<T extends Record<string, unknown>>(
  sheet: XLSX.WorkSheet,
  headerAliases: Record<string, string>,
  sheetName: string
): { rows: Array<T & { rowNumber: number }>; errors: ParsePlanExcelResult["errors"] } {
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  if (rawRows.length === 0) return { rows: [], errors: [] };

  const headerKeys = Object.keys(rawRows[0] ?? {});
  const columnMap = new Map<string, string>();
  for (const key of headerKeys) {
    const mapped = headerAliases[normalizeHeader(key)];
    if (mapped) columnMap.set(key, mapped);
  }

  const rows: Array<T & { rowNumber: number }> = [];
  const errors: ParsePlanExcelResult["errors"] = [];

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const record: Record<string, unknown> = {};
    for (const [key, field] of columnMap.entries()) {
      record[field] = raw[key];
    }
    if (Object.keys(record).length === 0) return;
    rows.push({ ...(record as T), rowNumber });
  });

  return { rows, errors };
}

function parseCategorySheet(sheet: XLSX.WorkSheet): {
  rows: ParsedPlanExcelRow[];
  errors: ParsePlanExcelResult["errors"];
} {
  const parsed = parseSheetRows<Record<string, unknown>>(sheet, CATEGORY_HEADER_ALIASES, "Categories");
  const rows: ParsedPlanExcelRow[] = [];
  const errors = [...parsed.errors];

  for (const record of parsed.rows) {
    const candidate = {
      code: String(record.code ?? "").trim(),
      name: String(record.name ?? "").trim(),
      description: record.description ? String(record.description).trim() : undefined,
      parentCode: record.parentCode ? String(record.parentCode).trim() : undefined,
      targetQty: toOptionalNumber(record.targetQty),
      parentSharePercent: toOptionalNumber(record.parentSharePercent),
      itemSku: record.itemSku ? String(record.itemSku).trim() : undefined,
      itemCategoryCode: record.itemCategoryCode
        ? String(record.itemCategoryCode).trim()
        : undefined,
    };

    if (!candidate.code && !candidate.name) continue;

    const result = excelPlanRowSchema.safeParse(candidate);
    if (!result.success) {
      errors.push({
        row: record.rowNumber,
        sheet: "Categories",
        message: result.error.issues.map((i) => i.message).join("; "),
      });
      continue;
    }
    rows.push({ rowNumber: record.rowNumber, ...result.data });
  }

  return { rows, errors };
}

function parseMonthlyColorSheet(sheet: XLSX.WorkSheet): {
  rows: ParsedMonthlyColorRow[];
  errors: ParsePlanExcelResult["errors"];
} {
  const parsed = parseSheetRows<Record<string, unknown>>(sheet, COLOR_HEADER_ALIASES, "MonthlyColors");
  const rows: ParsedMonthlyColorRow[] = [];
  const errors = [...parsed.errors];

  for (const record of parsed.rows) {
    const candidate = {
      code: String(record.code ?? "").trim(),
      month: Number(record.month),
      variantSku: String(record.variantSku ?? "").trim(),
      qty: Number(record.qty ?? 0),
    };
    if (!candidate.code && !candidate.variantSku) continue;

    const result = excelMonthlyColorRowSchema.safeParse(candidate);
    if (!result.success) {
      errors.push({
        row: record.rowNumber,
        sheet: "MonthlyColors",
        message: result.error.issues.map((i) => i.message).join("; "),
      });
      continue;
    }
    rows.push({ rowNumber: record.rowNumber, ...result.data });
  }

  return { rows, errors };
}

function parseMonthlyCmtSheet(sheet: XLSX.WorkSheet): {
  rows: ParsedMonthlyCmtRow[];
  errors: ParsePlanExcelResult["errors"];
} {
  const parsed = parseSheetRows<Record<string, unknown>>(sheet, CMT_HEADER_ALIASES, "MonthlyCMT");
  const rows: ParsedMonthlyCmtRow[] = [];
  const errors = [...parsed.errors];

  for (const record of parsed.rows) {
    const candidate = {
      code: String(record.code ?? "").trim(),
      month: Number(record.month),
      variantSku: String(record.variantSku ?? "").trim(),
      supplierCode: String(record.supplierCode ?? "").trim(),
      qty: Number(record.qty ?? 0),
    };
    if (!candidate.code && !candidate.supplierCode) continue;

    const result = excelMonthlyCmtRowSchema.safeParse(candidate);
    if (!result.success) {
      errors.push({
        row: record.rowNumber,
        sheet: "MonthlyCMT",
        message: result.error.issues.map((i) => i.message).join("; "),
      });
      continue;
    }
    rows.push({ rowNumber: record.rowNumber, ...result.data });
  }

  return { rows, errors };
}

export function parsePlanExcelBuffer(buffer: Buffer): ParsePlanExcelResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  if (workbook.SheetNames.length === 0) {
    return {
      rows: [],
      monthlyColors: [],
      monthlyCmt: [],
      errors: [{ row: 0, message: "Workbook has no sheets" }],
    };
  }

  const categorySheetName =
    workbook.SheetNames.find((name) => /^(plan|categories)$/i.test(name)) ??
    workbook.SheetNames[0]!;
  const colorSheetName = workbook.SheetNames.find((name) =>
    /^(monthlycolors|monthly_colors|colors)$/i.test(name)
  );
  const cmtSheetName = workbook.SheetNames.find((name) =>
    /^(monthlycmt|monthly_cmt|cmt)$/i.test(name)
  );

  const categoryParsed = parseCategorySheet(workbook.Sheets[categorySheetName]!);
  const colorParsed = colorSheetName
    ? parseMonthlyColorSheet(workbook.Sheets[colorSheetName]!)
    : { rows: [], errors: [] };
  const cmtParsed = cmtSheetName
    ? parseMonthlyCmtSheet(workbook.Sheets[cmtSheetName]!)
    : { rows: [], errors: [] };

  return {
    rows: categoryParsed.rows,
    monthlyColors: colorParsed.rows,
    monthlyCmt: cmtParsed.rows,
    errors: [...categoryParsed.errors, ...colorParsed.errors, ...cmtParsed.errors],
  };
}

export function buildPlanTemplateWorkbook(): Buffer {
  const categoryHeaders = [
    "itemCategoryCode",
    "code",
    "name",
    "description",
    "parentCode",
    "targetQty",
    "parentSharePercent",
    "itemSku",
  ];
  const categoryExample = [
    ["KSM", "KSM", "KAOS MAN", "Parent category", "", 54000, "", ""],
    ["", "JK_RK", "JUNKIES REGULER", "", "KSM", "", 50, "SKU-001"],
  ];
  const colorHeaders = ["code", "month", "variantSku", "qty"];
  const colorExample = [["JK_RK", 3, "SKU-001-BLU", 2000]];
  const cmtHeaders = ["code", "month", "variantSku", "supplierCode", "qty"];
  const cmtExample = [["JK_RK", 3, "SKU-001-BLU", "TAILOR-01", 1000]];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([categoryHeaders, ...categoryExample]),
    "Categories"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([colorHeaders, ...colorExample]),
    "MonthlyColors"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([cmtHeaders, ...cmtExample]),
    "MonthlyCMT"
  );
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
