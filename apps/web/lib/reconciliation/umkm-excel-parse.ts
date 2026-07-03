import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import {
  EXCEL_SIZE_KEYS,
  type ExcelSizeKey,
  type SizeQtyMap,
} from "./umkm-sku-bridge";

const ID_MONTHS: Record<string, number> = {
  januari: 1,
  februari: 2,
  maret: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  agustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  desember: 12,
};

export type UmkmExcelRow = {
  /** Excel KODE BARANG — parent / style code (no size suffix). */
  parentKode: string;
  namaBarang: string;
  tgl: Date;
  qty: number;
  sizes: SizeQtyMap;
  label: string;
};

export type UmkmParentAggregate = {
  parentKode: string;
  namaBarang: string;
  excelQty: number;
  sizes: SizeQtyMap;
  latestTgl: Date;
  lineCount: number;
};

const EN_MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

export function parseFlexibleDate(raw: unknown): Date | null {
  const fromUmkm = parseUmkmExcelDate(raw);
  if (fromUmkm) return fromUmkm;

  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const enMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (enMatch) {
    const day = Number(enMatch[1]);
    const month = EN_MONTHS[enMatch[2].toLowerCase()];
    const year = Number(enMatch[3]);
    if (!month || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export function formatFlexibleDateIso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function excelSerialToDate(serial: number): Date {
  const utcDays = serial - 25569;
  return new Date(utcDays * 86400 * 1000);
}

export function parseUmkmExcelDate(raw: unknown): Date | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw;
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 1000) {
    return excelSerialToDate(raw);
  }
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const idMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (idMatch) {
    const day = Number(idMatch[1]);
    const month = ID_MONTHS[idMatch[2].toLowerCase()];
    const year = Number(idMatch[3]);
    if (!month || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const iso = new Date(trimmed);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function parseQty(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string") {
    const n = Number(raw.replace(/,/g, "").trim());
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

function cellString(raw: unknown): string {
  if (raw == null) return "";
  return String(raw).trim();
}

function emptySizes(): SizeQtyMap {
  return { S: 0, M: 0, L: 0, XL: 0 };
}

export function parseUmkmExcelBuffer(buffer: Buffer): UmkmExcelRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  if (matrix.length < 2) return [];

  const header = (matrix[0] as unknown[]).map((h) => cellString(h).toLowerCase());
  const idx = (name: string) => header.findIndex((h) => h === name.toLowerCase());

  const tglIdx = idx("tgl");
  const kodeIdx = idx("kode barang");
  const namaIdx = idx("nama barang");
  const qtyIdx = idx("qty");
  const labelIdx = header.findIndex((h) => h.includes("label"));
  const sizeIdx: Record<ExcelSizeKey, number> = {
    S: idx("s"),
    M: idx("m"),
    L: idx("l"),
    XL: idx("xl"),
  };

  if (tglIdx < 0 || kodeIdx < 0 || qtyIdx < 0 || labelIdx < 0) {
    throw new Error(
      `Excel header mismatch. Expected TGL, KODE BARANG, QTY, LABEL. Got: ${header.join(", ")}`,
    );
  }

  const rows: UmkmExcelRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i] as unknown[];
    const parentKode = cellString(row[kodeIdx]);
    if (!parentKode) continue;

    const label = cellString(row[labelIdx]).toUpperCase();
    if (label !== "UMKM") continue;

    const tgl = parseUmkmExcelDate(row[tglIdx]);
    if (!tgl) continue;

    const sizes = emptySizes();
    for (const key of EXCEL_SIZE_KEYS) {
      const col = sizeIdx[key];
      if (col >= 0) sizes[key] = parseQty(row[col]);
    }

    const qty = parseQty(row[qtyIdx]);
    const sizeSum = EXCEL_SIZE_KEYS.reduce((s, k) => s + sizes[k], 0);
    const effectiveQty = qty > 0 ? qty : sizeSum;
    if (effectiveQty <= 0) continue;

    rows.push({
      parentKode,
      namaBarang: namaIdx >= 0 ? cellString(row[namaIdx]) : "",
      tgl,
      qty: effectiveQty,
      sizes,
      label,
    });
  }

  return rows;
}

export function parseUmkmExcelFile(filePath: string): UmkmExcelRow[] {
  const abs = path.resolve(filePath);
  const buffer = fs.readFileSync(abs);
  return parseUmkmExcelBuffer(buffer);
}

export function aggregateUmkmExcelByParent(
  rows: UmkmExcelRow[],
  cutoff: Date,
): UmkmParentAggregate[] {
  const byParent = new Map<string, UmkmParentAggregate>();

  for (const row of rows) {
    if (row.tgl.getTime() > cutoff.getTime()) continue;

    const existing = byParent.get(row.parentKode);
    if (!existing) {
      byParent.set(row.parentKode, {
        parentKode: row.parentKode,
        namaBarang: row.namaBarang,
        excelQty: row.qty,
        sizes: { ...row.sizes },
        latestTgl: row.tgl,
        lineCount: 1,
      });
      continue;
    }

    existing.excelQty += row.qty;
    existing.lineCount += 1;
    for (const key of EXCEL_SIZE_KEYS) {
      existing.sizes[key] += row.sizes[key];
    }
    if (row.tgl.getTime() > existing.latestTgl.getTime()) {
      existing.latestTgl = row.tgl;
    }
    if (!existing.namaBarang && row.namaBarang) {
      existing.namaBarang = row.namaBarang;
    }
  }

  return Array.from(byParent.values()).sort((a, b) =>
    a.parentKode.localeCompare(b.parentKode),
  );
}

/** @deprecated Use aggregateUmkmExcelByParent */
export function aggregateUmkmExcelRows(
  rows: UmkmExcelRow[],
  cutoff: Date,
): Array<{
  kodeBarang: string;
  namaBarang: string;
  excelQty: number;
  latestTgl: Date;
  lineCount: number;
}> {
  return aggregateUmkmExcelByParent(rows, cutoff).map((p) => ({
    kodeBarang: p.parentKode,
    namaBarang: p.namaBarang,
    excelQty: p.excelQty,
    latestTgl: p.latestTgl,
    lineCount: p.lineCount,
  }));
}
