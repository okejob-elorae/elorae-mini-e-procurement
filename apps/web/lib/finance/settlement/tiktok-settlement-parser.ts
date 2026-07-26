import * as XLSX from "xlsx";
import type { ParsedIncomeLine, ParsedSettlement, SettlementParseError } from "./shopee-settlement-parser";

type ParseSuccess = { ok: true; data: ParsedSettlement };
type ParseFailure = { ok: false; errors: SettlementParseError[] };

const REQUIRED_SHEETS = ["Detail pesanan"] as const;
const OPTIONAL_SHEETS = ["Laporan"] as const;

const ORDER_HEADER_LABEL = "ID Pesanan/Penyesuaian";

/**
 * Decision #2 (net-income column): which per-order column ties to the actual
 * payout. Kept as a single named constant so it is a one-line change if the
 * owner's validation against the real export says otherwise.
 */
const NET_INCOME_COLUMN = "Jumlah penyelesaian pembayaran";

const ORDER_COLUMNS = {
  orderNo: ORDER_HEADER_LABEL,
  netIncome: NET_INCOME_COLUMN,
  totalPendapatan: "Total Pendapatan",
  totalBiaya: "Total Biaya",
} as const;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return (v == null ? "" : String(v)).trim();
}

function findHeaderRow(matrix: unknown[][], label: string): number {
  return matrix.findIndex((r) => r.some((c) => str(c) === label));
}

function colIndex(headerRow: unknown[], label: string): number {
  return headerRow.findIndex((c) => str(c) === label);
}

function dateToYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The TikTok export has no Shopee-style "Summary" anchor sheet with an
 * explicit period range, so the settlement period is derived by scanning
 * every cell of the per-order data rows for JS `Date` values (the workbook
 * is read with `cellDates: true`) and taking the min/max found. This is a
 * heuristic pending validation against the real export — if the export
 * carries no date-typed column at all, both bounds fall back to "today".
 */
function derivePeriodRange(dataRows: unknown[][]): { from: string; to: string } {
  let min: Date | undefined;
  let max: Date | undefined;
  for (const row of dataRows) {
    if (!row) continue;
    for (const cell of row) {
      if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
        if (!min || cell < min) min = cell;
        if (!max || cell > max) max = cell;
      }
    }
  }
  if (!min || !max) {
    const today = dateToYmd(new Date());
    return { from: today, to: today };
  }
  return { from: dateToYmd(min), to: dateToYmd(max) };
}

/**
 * No seller/store-name column has been confirmed in the TikTok export
 * (spec §Findings lists no such field) — "TikTok Shop" mirrors the
 * confirmed `Sumber pesanan` value rather than a guessed field name.
 */
const DEFAULT_SELLER = "TikTok Shop";

function parseDetailPesananSheet(matrix: unknown[][]): {
  lines: ParsedIncomeLine[];
  totalPendapatan: number;
  totalBiaya: number;
  errors: SettlementParseError[];
} {
  const errors: SettlementParseError[] = [];
  const headerRowIdx = findHeaderRow(matrix, ORDER_HEADER_LABEL);
  if (headerRowIdx < 0) {
    errors.push({
      sheet: "Detail pesanan",
      row: null,
      message: `Header row containing "${ORDER_HEADER_LABEL}" not found`,
    });
    return { lines: [], totalPendapatan: 0, totalBiaya: 0, errors };
  }

  const headerRow = matrix[headerRowIdx];
  const colIdx = {
    orderNo: colIndex(headerRow, ORDER_COLUMNS.orderNo),
    netIncome: colIndex(headerRow, ORDER_COLUMNS.netIncome),
    totalPendapatan: colIndex(headerRow, ORDER_COLUMNS.totalPendapatan),
    totalBiaya: colIndex(headerRow, ORDER_COLUMNS.totalBiaya),
  };

  if (colIdx.orderNo < 0) {
    errors.push({
      sheet: "Detail pesanan",
      row: headerRowIdx + 1,
      message: `Column "${ORDER_COLUMNS.orderNo}" not found in header row`,
    });
    return { lines: [], totalPendapatan: 0, totalBiaya: 0, errors };
  }
  if (colIdx.netIncome < 0) {
    errors.push({
      sheet: "Detail pesanan",
      row: headerRowIdx + 1,
      message: `Column "${ORDER_COLUMNS.netIncome}" not found in header row`,
    });
    return { lines: [], totalPendapatan: 0, totalBiaya: 0, errors };
  }

  const lines: ParsedIncomeLine[] = [];
  let totalPendapatan = 0;
  let totalBiaya = 0;

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

    const netIncome = num(row[colIdx.netIncome]);
    // TikTok's per-order fee breakdown doesn't map 1:1 onto Shopee's 6 columns.
    // Only netIncome is populated on the shared shape; the rest stay 0 — the
    // full row (all ~60 fee columns) is preserved in `raw` for anyone auditing
    // a specific order's fee lines.
    lines.push({
      orderNo,
      netIncome,
      hargaAsliProduk: 0,
      totalDiskonProduk: 0,
      biayaAdministrasi: 0,
      biayaLayanan: 0,
      biayaKomisiAms: 0,
      biayaProsesPesanan: 0,
      raw,
    });

    if (colIdx.totalPendapatan >= 0) totalPendapatan += num(row[colIdx.totalPendapatan]);
    if (colIdx.totalBiaya >= 0) totalBiaya += num(row[colIdx.totalBiaya]);
  }

  return { lines, totalPendapatan, totalBiaya, errors };
}

export function parseTiktokSettlement(buffer: Buffer): ParseSuccess | ParseFailure {
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

  const detailMatrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Detail pesanan"], {
    header: 1,
  }) as unknown[][];
  const { lines: incomeLines, totalPendapatan, totalBiaya, errors } =
    parseDetailPesananSheet(detailMatrix);
  if (errors.length > 0) return { ok: false, errors };

  if (incomeLines.length === 0) {
    return {
      ok: false,
      errors: [{ sheet: "Detail pesanan", row: null, message: "No order rows found" }],
    };
  }

  // Scanning the whole matrix (including the header row) is harmless — header
  // cells are strings, never `Date` instances, so they never affect the range.
  const period = derivePeriodRange(detailMatrix);
  const parsedNetTotal = incomeLines.reduce((sum, line) => sum + line.netIncome, 0);

  const optionalSheetsRaw: Record<string, unknown> = {};
  for (const sheetName of OPTIONAL_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (sheet) {
      optionalSheetsRaw[sheetName] = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
      });
    }
  }

  const data: ParsedSettlement = {
    seller: DEFAULT_SELLER,
    periodFrom: period.from,
    periodTo: period.to,
    summary: {
      // Derived by aggregation over "Detail pesanan" — there is no Summary
      // sheet to read these from directly. totalDilepas mirrors the sum of
      // per-order netIncome so the persist checksum (parsedNetTotal ==
      // totalDilepas) holds by construction.
      totalPendapatan,
      totalPengeluaran: totalBiaya,
      totalDilepas: parsedNetTotal,
      raw: optionalSheetsRaw,
    },
    incomeLines,
    sellerFeesRaw: [],
    adjustmentsRaw: [],
    parsedNetTotal,
  };

  return { ok: true, data };
}
