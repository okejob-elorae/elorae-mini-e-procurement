import * as fs from "fs";
import * as XLSX from "xlsx";
import type { ManifestResult } from "./umkm-opening-stock";

function summaryRows(result: ManifestResult): (string | number)[][] {
  return [
    ["field", "value"],
    ["cutoff", result.cutoff.toISOString()],
    ["excel_max_tgl", result.excelMaxTgl?.toISOString() ?? ""],
    ["sales_max_date", result.salesMaxDate?.toISOString() ?? ""],
    ["parent_skus", result.summary.totalParentSkus],
    ["variant_rows", result.summary.totalVariantRows],
    ["mapped", result.summary.mapped],
    ["unmapped", result.summary.unmapped],
    ["applyable", result.summary.applyable],
    ["sales_order_lines", result.salesOrders.length],
    ["fake_buy_lines", result.otherSourcesSummary.fakeBuyLineCount],
    ["other_deduction_lines", result.otherSourcesSummary.deductionLineCount],
    ["other_sources_skipped", result.otherSourcesSummary.skippedLineCount],
    ["bonus_duplicates", result.otherSourcesSummary.duplicateCount],
  ];
}

export function manifestToXlsxBuffer(result: ManifestResult): Buffer {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(summaryRows(result)),
    "Summary",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(result.rows),
    "Manifest",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(result.salesOrders),
    "SalesOrders",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(result.fakeBuyCredits),
    "FakeBuyCredits",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(result.otherDeductions),
    "OtherDeductions",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(result.otherSourcesSkipped),
    "OtherSourcesSkipped",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(result.variantMap),
    "VariantMap",
  );

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function writeManifestXlsx(outputPath: string, result: ManifestResult): void {
  fs.writeFileSync(outputPath, manifestToXlsxBuffer(result));
}
