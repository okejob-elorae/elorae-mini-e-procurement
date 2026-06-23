import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { formatFlexibleDateIso, parseFlexibleDate } from "./umkm-excel-parse";
import {
  type ErpVariantIndex,
  normalizeOtherSourceSku,
} from "./umkm-sku-bridge";

export type OtherSourceParseStatus =
  | "OK"
  | "NON_UMKM"
  | "UNRESOLVED_SKU"
  | "INVALID_ROW"
  | "DUPLICATE";

export type OtherSourceLine = {
  sourceFile: string;
  sourceSheet: string;
  lineKind: "fake_buy_credit" | "deduction";
  deductionType: string;
  parentKode: string;
  size: string;
  erpVariantSku: string;
  qty: number;
  referenceId: string;
  tanggal: string | null;
  channel: string | null;
  parseStatus: OtherSourceParseStatus;
  orderId: string | null;
};

export type OtherSourcesParseResult = {
  fakeBuyLines: OtherSourceLine[];
  deductionLines: OtherSourceLine[];
  skipped: OtherSourceLine[];
  summary: {
    fakeBuyLineCount: number;
    deductionLineCount: number;
    skippedLineCount: number;
    duplicateCount: number;
    byDeductionType: Record<string, number>;
    bySourceFile: Record<string, number>;
  };
};

type RawLineInput = {
  sourceFile: string;
  sourceSheet: string;
  lineKind: "fake_buy_credit" | "deduction";
  deductionType: string;
  artikel: string;
  size: string;
  qty: unknown;
  referenceId: string;
  tanggal: unknown;
  channel: string | null;
  orderId: string | null;
};

function cellString(raw: unknown): string {
  if (raw == null) return "";
  return String(raw).trim();
}

function parseQty(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string") {
    const n = Number(raw.replace(/,/g, "").trim());
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

function sheetMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];
}

function headerIndexMap(headerRow: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((cell, idx) => {
    const key = cellString(cell).toLowerCase();
    if (key) map.set(key, idx);
  });
  return map;
}

function col(row: unknown[], header: Map<string, number>, name: string): unknown {
  const idx = header.get(name.toLowerCase());
  return idx == null ? "" : row[idx];
}

function finalizeLine(
  input: RawLineInput,
  umkmParentSet: Set<string>,
  erpIndex: ErpVariantIndex,
): OtherSourceLine {
  const qty = parseQty(input.qty);
  const tanggal = formatFlexibleDateIso(parseFlexibleDate(input.tanggal));

  const base: OtherSourceLine = {
    sourceFile: input.sourceFile,
    sourceSheet: input.sourceSheet,
    lineKind: input.lineKind,
    deductionType: input.deductionType,
    parentKode: "",
    size: "",
    erpVariantSku: "",
    qty,
    referenceId: input.referenceId,
    tanggal,
    channel: input.channel,
    parseStatus: "INVALID_ROW",
    orderId: input.orderId,
  };

  if (!input.artikel || qty <= 0) {
    return base;
  }

  const normalized = normalizeOtherSourceSku(input.artikel, input.size, erpIndex);
  if (!normalized) {
    return { ...base, parseStatus: "UNRESOLVED_SKU" };
  }

  if (!umkmParentSet.has(normalized.parentKode)) {
    return {
      ...base,
      parentKode: normalized.parentKode,
      size: normalized.size,
      erpVariantSku: normalized.erpVariantSku,
      parseStatus: "NON_UMKM",
    };
  }

  return {
    ...base,
    parentKode: normalized.parentKode,
    size: normalized.size,
    erpVariantSku: normalized.erpVariantSku,
    parseStatus: "OK",
  };
}

function parseBomCodFile(
  filePath: string,
  sourceFile: string,
  umkmParentSet: Set<string>,
  erpIndex: ErpVariantIndex,
): OtherSourceLine[] {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true });
  const lines: OtherSourceLine[] = [];

  for (const sheetName of workbook.SheetNames) {
    const matrix = sheetMatrix(workbook.Sheets[sheetName]!);
    if (matrix.length < 2) continue;

    const header = headerIndexMap(matrix[0] as unknown[]);
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] as unknown[];
      const artikel = cellString(col(row, header, "artikel"));
      if (!artikel) continue;

      lines.push(
        finalizeLine(
          {
            sourceFile,
            sourceSheet: sheetName,
            lineKind: "fake_buy_credit",
            deductionType: "fake_buy_bom",
            artikel,
            size: cellString(col(row, header, "size")),
            qty: col(row, header, "qty"),
            referenceId: cellString(col(row, header, "no pesanan")) || artikel,
            tanggal: null,
            channel: cellString(col(row, header, "platform")).toUpperCase() || null,
            orderId: cellString(col(row, header, "no pesanan")) || null,
          },
          umkmParentSet,
          erpIndex,
        ),
      );
    }
  }

  return lines;
}

function parseFakeBuyFile(
  filePath: string,
  sourceFile: string,
  umkmParentSet: Set<string>,
  erpIndex: ErpVariantIndex,
): OtherSourceLine[] {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true });
  const lines: OtherSourceLine[] = [];

  for (const sheetName of workbook.SheetNames) {
    const matrix = sheetMatrix(workbook.Sheets[sheetName]!);
    if (matrix.length < 2) continue;

    const header = headerIndexMap(matrix[0] as unknown[]);
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] as unknown[];
      const sku = cellString(col(row, header, "sku"));
      if (!sku) continue;

      const orderId = cellString(col(row, header, "order number"));
      lines.push(
        finalizeLine(
          {
            sourceFile,
            sourceSheet: sheetName,
            lineKind: "fake_buy_credit",
            deductionType: "fake_buy",
            artikel: sku,
            size: "",
            qty: col(row, header, "qty"),
            referenceId: orderId || sku,
            tanggal: col(row, header, "tanggal"),
            channel: cellString(col(row, header, "kanal")).toUpperCase() || null,
            orderId: orderId || null,
          },
          umkmParentSet,
          erpIndex,
        ),
      );
    }
  }

  return lines;
}

function parseArtikelSizeQtySheets(
  filePath: string,
  sourceFile: string,
  sheetConfigs: Array<{ sheetName: string; deductionType: string; referenceColumn: string }>,
  umkmParentSet: Set<string>,
  erpIndex: ErpVariantIndex,
): OtherSourceLine[] {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true });
  const lines: OtherSourceLine[] = [];

  for (const config of sheetConfigs) {
    const sheet = workbook.Sheets[config.sheetName];
    if (!sheet) continue;

    const matrix = sheetMatrix(sheet);
    if (matrix.length < 2) continue;

    const header = headerIndexMap(matrix[0] as unknown[]);
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] as unknown[];
      const artikel = cellString(col(row, header, "artikel"));
      if (!artikel) continue;

      lines.push(
        finalizeLine(
          {
            sourceFile,
            sourceSheet: config.sheetName,
            lineKind: "deduction",
            deductionType: config.deductionType,
            artikel,
            size: cellString(col(row, header, "size")),
            qty: col(row, header, "qty"),
            referenceId: cellString(col(row, header, config.referenceColumn)),
            tanggal: col(row, header, "tanggal"),
            channel: null,
            orderId: null,
          },
          umkmParentSet,
          erpIndex,
        ),
      );
    }
  }

  return lines;
}

function parseBonusStandaloneFile(
  filePath: string,
  sourceFile: string,
  umkmParentSet: Set<string>,
  erpIndex: ErpVariantIndex,
): OtherSourceLine[] {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true });
  const lines: OtherSourceLine[] = [];

  for (const sheetName of workbook.SheetNames) {
    const matrix = sheetMatrix(workbook.Sheets[sheetName]!);
    if (matrix.length < 2) continue;

    const header = headerIndexMap(matrix[0] as unknown[]);
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] as unknown[];
      const artikel = cellString(col(row, header, "artikel"));
      if (!artikel) continue;

      lines.push(
        finalizeLine(
          {
            sourceFile,
            sourceSheet: sheetName,
            lineKind: "deduction",
            deductionType: "bonus",
            artikel,
            size: cellString(col(row, header, "size")),
            qty: col(row, header, "qty"),
            referenceId: cellString(col(row, header, "nama")),
            tanggal: col(row, header, "tanggal"),
            channel: null,
            orderId: null,
          },
          umkmParentSet,
          erpIndex,
        ),
      );
    }
  }

  return lines;
}

function parseKirimTokoFile(
  filePath: string,
  sourceFile: string,
  umkmParentSet: Set<string>,
  erpIndex: ErpVariantIndex,
): OtherSourceLine[] {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true });
  const lines: OtherSourceLine[] = [];

  for (const sheetName of workbook.SheetNames) {
    const matrix = sheetMatrix(workbook.Sheets[sheetName]!);
    if (matrix.length < 2) continue;

    const header = headerIndexMap(matrix[0] as unknown[]);
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] as unknown[];
      const artikel = cellString(col(row, header, "artikel"));
      if (!artikel) continue;

      lines.push(
        finalizeLine(
          {
            sourceFile,
            sourceSheet: sheetName,
            lineKind: "deduction",
            deductionType: "store_shipment",
            artikel,
            size: cellString(col(row, header, "size")),
            qty: col(row, header, "qty"),
            referenceId: sheetName,
            tanggal: null,
            channel: null,
            orderId: null,
          },
          umkmParentSet,
          erpIndex,
        ),
      );
    }
  }

  return lines;
}

function bonusDedupKey(line: OtherSourceLine): string {
  const name = line.referenceId.toLowerCase().trim();
  return `${line.tanggal ?? ""}|${name}|${line.parentKode}|${line.size}|${line.qty}`;
}

function applyBonusDedup(lines: OtherSourceLine[]): OtherSourceLine[] {
  const seen = new Set<string>();
  const result: OtherSourceLine[] = [];

  for (const line of lines) {
    if (line.deductionType !== "bonus" || line.parseStatus !== "OK") {
      result.push(line);
      continue;
    }

    const key = bonusDedupKey(line);
    if (seen.has(key)) {
      result.push({ ...line, parseStatus: "DUPLICATE" });
      continue;
    }

    seen.add(key);
    result.push(line);
  }

  return result;
}

function partitionLines(allLines: OtherSourceLine[]): OtherSourcesParseResult {
  const deduped = applyBonusDedup(allLines);
  const fakeBuyLines: OtherSourceLine[] = [];
  const deductionLines: OtherSourceLine[] = [];
  const skipped: OtherSourceLine[] = [];

  const byDeductionType: Record<string, number> = {};
  const bySourceFile: Record<string, number> = {};
  let duplicateCount = 0;

  for (const line of deduped) {
    bySourceFile[line.sourceFile] = (bySourceFile[line.sourceFile] ?? 0) + 1;

    if (line.parseStatus === "OK") {
      byDeductionType[line.deductionType] = (byDeductionType[line.deductionType] ?? 0) + 1;
      if (line.lineKind === "fake_buy_credit") {
        fakeBuyLines.push(line);
      } else {
        deductionLines.push(line);
      }
    } else {
      if (line.parseStatus === "DUPLICATE") duplicateCount += 1;
      skipped.push(line);
    }
  }

  return {
    fakeBuyLines,
    deductionLines,
    skipped,
    summary: {
      fakeBuyLineCount: fakeBuyLines.length,
      deductionLineCount: deductionLines.length,
      skippedLineCount: skipped.length,
      duplicateCount,
      byDeductionType,
      bySourceFile,
    },
  };
}

export function aggregateOtherSourceQtyByVariant(
  lines: OtherSourceLine[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    if (line.parseStatus !== "OK") continue;
    map.set(line.erpVariantSku, (map.get(line.erpVariantSku) ?? 0) + line.qty);
  }
  return map;
}

const EXPECTED_FILES = {
  bomShopee: "BOM COD - shoppee.xlsx",
  bomTiktok: "BOM COD - tiktok.xlsx",
  fakeBuy: "FAKE BUY.xlsx",
  bonusStandalone: "BONUS BARANG ( FREE).xlsx",
  kirimBarang: "KIRIM BARANG + BONUS - Copy.xlsx",
  kirimToko: "KIRIM TOKO UPDATE JOHAN.xlsx",
} as const;

export function parseOtherSourcesDir(
  dirPath: string,
  umkmParentSet: Set<string>,
  erpIndex: ErpVariantIndex,
): OtherSourcesParseResult {
  const absDir = path.resolve(dirPath);
  if (!fs.existsSync(absDir)) {
    return {
      fakeBuyLines: [],
      deductionLines: [],
      skipped: [],
      summary: {
        fakeBuyLineCount: 0,
        deductionLineCount: 0,
        skippedLineCount: 0,
        duplicateCount: 0,
        byDeductionType: {},
        bySourceFile: {},
      },
    };
  }

  const allLines: OtherSourceLine[] = [];

  const bomShopee = path.join(absDir, EXPECTED_FILES.bomShopee);
  if (fs.existsSync(bomShopee)) {
    allLines.push(
      ...parseBomCodFile(bomShopee, EXPECTED_FILES.bomShopee, umkmParentSet, erpIndex),
    );
  }

  const bomTiktok = path.join(absDir, EXPECTED_FILES.bomTiktok);
  if (fs.existsSync(bomTiktok)) {
    allLines.push(
      ...parseBomCodFile(bomTiktok, EXPECTED_FILES.bomTiktok, umkmParentSet, erpIndex),
    );
  }

  const fakeBuy = path.join(absDir, EXPECTED_FILES.fakeBuy);
  if (fs.existsSync(fakeBuy)) {
    allLines.push(
      ...parseFakeBuyFile(fakeBuy, EXPECTED_FILES.fakeBuy, umkmParentSet, erpIndex),
    );
  }

  const bonusStandalone = path.join(absDir, EXPECTED_FILES.bonusStandalone);
  if (fs.existsSync(bonusStandalone)) {
    allLines.push(
      ...parseBonusStandaloneFile(
        bonusStandalone,
        EXPECTED_FILES.bonusStandalone,
        umkmParentSet,
        erpIndex,
      ),
    );
  }

  const kirimBarang = path.join(absDir, EXPECTED_FILES.kirimBarang);
  if (fs.existsSync(kirimBarang)) {
    allLines.push(
      ...parseArtikelSizeQtySheets(
        kirimBarang,
        EXPECTED_FILES.kirimBarang,
        [
          { sheetName: "KOL", deductionType: "kol", referenceColumn: "kol" },
          { sheetName: "BONUS", deductionType: "bonus", referenceColumn: "nama" },
          { sheetName: "PEMBELIAN MANUAL", deductionType: "manual", referenceColumn: "nama" },
        ],
        umkmParentSet,
        erpIndex,
      ),
    );
  }

  const kirimToko = path.join(absDir, EXPECTED_FILES.kirimToko);
  if (fs.existsSync(kirimToko)) {
    allLines.push(
      ...parseKirimTokoFile(kirimToko, EXPECTED_FILES.kirimToko, umkmParentSet, erpIndex),
    );
  }

  return partitionLines(allLines);
}

export function buildUmkmParentSet(parentKodes: string[]): Set<string> {
  return new Set(parentKodes.map((k) => k.trim()).filter(Boolean));
}
