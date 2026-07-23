import * as XLSX from "xlsx";

export type ParsedIncomeLine = {
  orderNo: string;
  netIncome: number;
  hargaAsliProduk: number;
  totalDiskonProduk: number;
  biayaAdministrasi: number;
  biayaLayanan: number;
  biayaKomisiAms: number;
  biayaProsesPesanan: number;
  raw: Record<string, unknown>;
};

export type ParsedSettlement = {
  seller: string;
  periodFrom: string;
  periodTo: string;
  summary: {
    totalPendapatan: number;
    totalPengeluaran: number;
    totalDilepas: number;
    raw: Record<string, unknown>;
  };
  incomeLines: ParsedIncomeLine[];
  sellerFeesRaw: unknown[];
  adjustmentsRaw: unknown[];
  parsedNetTotal: number;
};

export type SettlementParseError = { sheet: string; row: number | null; message: string };

type ParseSuccess = { ok: true; data: ParsedSettlement };
type ParseFailure = { ok: false; errors: SettlementParseError[] };

const REQUIRED_SHEETS = ["Summary", "Income", "Adjustment", "Seller Fee"] as const;

const INCOME_HEADER_LABEL = "No. Pesanan";

const SUMMARY_LABELS = {
  seller: "Username (Penjual)",
  periodFrom: "Dari",
  periodTo: "ke",
  totalPendapatan: "1. Total Pendapatan",
  totalPengeluaran: "2. Total Pengeluaran",
  totalDilepas: "3. Total yang Dilepas",
} as const;

const INCOME_COLUMNS = {
  orderNo: "No. Pesanan",
  netIncome: "Total Penghasilan",
  hargaAsliProduk: "Harga Asli Produk",
  totalDiskonProduk: "Total Diskon Produk",
  biayaAdministrasi: "Biaya Administrasi",
  biayaLayanan: "Biaya Layanan",
  biayaKomisiAms: "Biaya Komisi AMS",
  biayaProsesPesanan: "Biaya Proses Pesanan",
} as const;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return (v == null ? "" : String(v)).trim();
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Summary "Dari"/"ke" cells come out of the workbook as either a JS `Date`
 * (the sheet is read with `cellDates: true`) or a plain string. Persist
 * expects a clean `YYYY-MM-DD` string it can safely append a fixed offset
 * time to; anything else is recorded as a parse error instead of silently
 * flowing through as an unparseable date.
 */
function normalizePeriodDate(
  v: unknown,
  label: string,
): { value: string; error?: SettlementParseError } {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) {
      return {
        value: "",
        error: { sheet: "Summary", row: null, message: `Invalid date value for "${label}"` },
      };
    }
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return { value: `${y}-${m}-${d}` };
  }

  const s = str(v);
  if (YMD_RE.test(s)) {
    return { value: s.slice(0, 10) };
  }

  return {
    value: "",
    error: { sheet: "Summary", row: null, message: `Could not resolve "${label}" as a date` },
  };
}

function findHeaderRow(matrix: unknown[][], label: string): number {
  return matrix.findIndex((r) => r.some((c) => str(c) === label));
}

function colIndex(headerRow: unknown[], label: string): number {
  return headerRow.findIndex((c) => str(c) === label);
}

/**
 * The Summary sheet is a key/value layout: column A holds a label, the value
 * sits somewhere after it on the same row (sometimes adjacent, sometimes a
 * few empty cells further along). Scanning from the end for the last
 * non-empty cell handles both shapes.
 */
function rowValue(row: unknown[]): unknown {
  for (let i = row.length - 1; i >= 1; i--) {
    const cell = row[i];
    if (cell !== null && cell !== undefined && cell !== "") return cell;
  }
  return undefined;
}

function parseSummarySheet(matrix: unknown[][]): {
  seller: string;
  periodFrom: string;
  periodTo: string;
  totalPendapatan: number;
  totalPengeluaran: number;
  totalDilepas: number;
  raw: Record<string, unknown>;
  errors: SettlementParseError[];
} {
  const raw: Record<string, unknown> = {};
  for (const row of matrix) {
    const label = str(row?.[0]);
    if (!label) continue;
    raw[label] = rowValue(row);
  }

  const errors: SettlementParseError[] = [];

  const seller = str(raw[SUMMARY_LABELS.seller]);
  if (!seller) {
    errors.push({
      sheet: "Summary",
      row: null,
      message: `Could not resolve "${SUMMARY_LABELS.seller}" anchor`,
    });
  }

  const totalDilepasCell = raw[SUMMARY_LABELS.totalDilepas];
  if (totalDilepasCell === undefined || str(totalDilepasCell) === "") {
    errors.push({
      sheet: "Summary",
      row: null,
      message: `Could not resolve "${SUMMARY_LABELS.totalDilepas}" anchor`,
    });
  }

  const periodFromResult = normalizePeriodDate(
    raw[SUMMARY_LABELS.periodFrom],
    SUMMARY_LABELS.periodFrom,
  );
  if (periodFromResult.error) errors.push(periodFromResult.error);

  const periodToResult = normalizePeriodDate(raw[SUMMARY_LABELS.periodTo], SUMMARY_LABELS.periodTo);
  if (periodToResult.error) errors.push(periodToResult.error);

  return {
    seller,
    periodFrom: periodFromResult.value,
    periodTo: periodToResult.value,
    totalPendapatan: num(raw[SUMMARY_LABELS.totalPendapatan]),
    totalPengeluaran: num(raw[SUMMARY_LABELS.totalPengeluaran]),
    totalDilepas: num(totalDilepasCell),
    raw,
    errors,
  };
}

function parseIncomeSheet(matrix: unknown[][]): {
  lines: ParsedIncomeLine[];
  errors: SettlementParseError[];
} {
  const errors: SettlementParseError[] = [];
  const headerRowIdx = findHeaderRow(matrix, INCOME_HEADER_LABEL);
  if (headerRowIdx < 0) {
    errors.push({
      sheet: "Income",
      row: null,
      message: `Header row containing "${INCOME_HEADER_LABEL}" not found`,
    });
    return { lines: [], errors };
  }

  const headerRow = matrix[headerRowIdx];
  const colIdx = {
    orderNo: colIndex(headerRow, INCOME_COLUMNS.orderNo),
    netIncome: colIndex(headerRow, INCOME_COLUMNS.netIncome),
    hargaAsliProduk: colIndex(headerRow, INCOME_COLUMNS.hargaAsliProduk),
    totalDiskonProduk: colIndex(headerRow, INCOME_COLUMNS.totalDiskonProduk),
    biayaAdministrasi: colIndex(headerRow, INCOME_COLUMNS.biayaAdministrasi),
    biayaLayanan: colIndex(headerRow, INCOME_COLUMNS.biayaLayanan),
    biayaKomisiAms: colIndex(headerRow, INCOME_COLUMNS.biayaKomisiAms),
    biayaProsesPesanan: colIndex(headerRow, INCOME_COLUMNS.biayaProsesPesanan),
  };

  if (colIdx.orderNo < 0) {
    errors.push({
      sheet: "Income",
      row: headerRowIdx + 1,
      message: `Column "${INCOME_COLUMNS.orderNo}" not found in header row`,
    });
    return { lines: [], errors };
  }

  const lines: ParsedIncomeLine[] = [];
  for (let i = headerRowIdx + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row) continue;

    const orderNo = str(row[colIdx.orderNo]);
    if (!orderNo) continue;

    const raw: Record<string, unknown> = {};
    headerRow.forEach((label, idx) => {
      const key = str(label);
      if (key) raw[key] = row[idx];
    });

    lines.push({
      orderNo,
      netIncome: num(row[colIdx.netIncome]),
      hargaAsliProduk: num(row[colIdx.hargaAsliProduk]),
      totalDiskonProduk: num(row[colIdx.totalDiskonProduk]),
      biayaAdministrasi: num(row[colIdx.biayaAdministrasi]),
      biayaLayanan: num(row[colIdx.biayaLayanan]),
      biayaKomisiAms: num(row[colIdx.biayaKomisiAms]),
      biayaProsesPesanan: num(row[colIdx.biayaProsesPesanan]),
      raw,
    });
  }

  return { lines, errors };
}

export function parseShopeeSettlement(buffer: Buffer): ParseSuccess | ParseFailure {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const missingSheetErrors: SettlementParseError[] = [];
  for (const sheetName of REQUIRED_SHEETS) {
    if (!workbook.Sheets[sheetName]) {
      missingSheetErrors.push({
        sheet: sheetName,
        row: null,
        message: `Sheet "${sheetName}" not found`,
      });
    }
  }
  if (missingSheetErrors.length > 0) return { ok: false, errors: missingSheetErrors };

  const summaryMatrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Summary"], {
    header: 1,
  }) as unknown[][];
  const summary = parseSummarySheet(summaryMatrix);
  if (summary.errors.length > 0) return { ok: false, errors: summary.errors };

  const incomeMatrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Income"], {
    header: 1,
  }) as unknown[][];
  const { lines: incomeLines, errors: incomeErrors } = parseIncomeSheet(incomeMatrix);
  if (incomeErrors.length > 0) return { ok: false, errors: incomeErrors };

  const adjustmentsRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets["Adjustment"],
    { defval: null },
  );
  const sellerFeesRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets["Seller Fee"],
    { defval: null },
  );

  const parsedNetTotal = incomeLines.reduce((sum, line) => sum + line.netIncome, 0);

  const data: ParsedSettlement = {
    seller: summary.seller,
    periodFrom: summary.periodFrom,
    periodTo: summary.periodTo,
    summary: {
      totalPendapatan: summary.totalPendapatan,
      totalPengeluaran: summary.totalPengeluaran,
      totalDilepas: summary.totalDilepas,
      raw: summary.raw,
    },
    incomeLines,
    sellerFeesRaw,
    adjustmentsRaw,
    parsedNetTotal,
  };

  return { ok: true, data };
}
