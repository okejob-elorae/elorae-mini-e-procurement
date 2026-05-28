import * as XLSX from 'xlsx';
import { excelPlanRowSchema } from '@/lib/validations/planning';

export interface ParsedPlanExcelRow {
  rowNumber: number;
  code: string;
  name: string;
  description?: string;
  parentCode?: string;
  targetQty?: number | null;
  parentSharePercent?: number | null;
  itemSku?: string | null;
}

export interface ParsePlanExcelResult {
  rows: ParsedPlanExcelRow[];
  errors: Array<{ row: number; message: string }>;
}

const HEADER_ALIASES: Record<string, keyof Omit<ParsedPlanExcelRow, 'rowNumber'>> = {
  code: 'code',
  kode: 'code',
  jenis: 'code',
  name: 'name',
  nama: 'name',
  keterangan: 'name',
  description: 'description',
  parentcode: 'parentCode',
  parent: 'parentCode',
  parent_code: 'parentCode',
  targetqty: 'targetQty',
  target: 'targetQty',
  plan: 'targetQty',
  parentsharepercent: 'parentSharePercent',
  share: 'parentSharePercent',
  sharepercent: 'parentSharePercent',
  itemsku: 'itemSku',
  sku: 'itemSku',
  item: 'itemSku',
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function toOptionalNumber(value: unknown): number | null | undefined {
  if (value === '' || value == null) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function parsePlanExcelBuffer(buffer: Buffer): ParsePlanExcelResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: [{ row: 0, message: 'Workbook has no sheets' }] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });

  if (rawRows.length === 0) {
    return { rows: [], errors: [] };
  }

  const headerKeys = Object.keys(rawRows[0] ?? {});
  const columnMap = new Map<string, keyof Omit<ParsedPlanExcelRow, 'rowNumber'>>();
  for (const key of headerKeys) {
    const mapped = HEADER_ALIASES[normalizeHeader(key)];
    if (mapped) columnMap.set(key, mapped);
  }

  const rows: ParsedPlanExcelRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const record: Record<string, unknown> = {};
    for (const [key, field] of columnMap.entries()) {
      record[field] = raw[key];
    }

    const candidate = {
      code: String(record.code ?? '').trim(),
      name: String(record.name ?? '').trim(),
      description: record.description ? String(record.description).trim() : undefined,
      parentCode: record.parentCode ? String(record.parentCode).trim() : undefined,
      targetQty: toOptionalNumber(record.targetQty),
      parentSharePercent: toOptionalNumber(record.parentSharePercent),
      itemSku: record.itemSku ? String(record.itemSku).trim() : undefined,
    };

    if (!candidate.code && !candidate.name) return;

    const parsed = excelPlanRowSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({
        row: rowNumber,
        message: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    rows.push({ rowNumber, ...parsed.data });
  });

  return { rows, errors };
}

export function buildPlanTemplateWorkbook(): Buffer {
  const headers = [
    'code',
    'name',
    'description',
    'parentCode',
    'targetQty',
    'parentSharePercent',
    'itemSku',
  ];
  const example = [
    ['KSM', 'KAOS MAN', 'Parent category', '', 54000, '', ''],
    ['JK_RK', 'JUNKIES REGULER', '', 'KSM', '', 50, 'SKU-001'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plan');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
