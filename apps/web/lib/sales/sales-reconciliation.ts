import type { SalesChannel } from "@elorae/db";

export type ReconciliationStatus =
  | "IN_SYNC"
  | "EXCEL_HIGHER"
  | "JUBELIO_HIGHER";

export type ExcelHistoryRow = {
  parentSku: string;
  productName: string;
  netQuantity: number;
  itemId: string | null;
  resolutionStatus: "MAPPED" | "UNMAPPED" | "AMBIGUOUS";
};

export type JubelioOrderLine = {
  itemId: string | null;
  parentSku: string | null;
  productName: string;
  qty: number;
};

export type ItemReconciliationRow = {
  groupKey: string;
  itemId: string | null;
  parentSku: string;
  productName: string;
  excelQty: number;
  jubelioQty: number;
  delta: number;
  status: ReconciliationStatus;
};

export type ReconciliationReport = {
  channel: SalesChannel;
  periodMonth: number;
  periodYear: number;
  excelTotal: number;
  jubelioTotal: number;
  delta: number;
  items: ItemReconciliationRow[];
  unmappedSkus: string[];
};

const DEFAULT_UNIT_TOLERANCE = 2;
const DEFAULT_PERCENT_TOLERANCE = 0.05;

export function reconciliationTolerance(
  excelQty: number,
  jubelioQty: number,
  unitTolerance = DEFAULT_UNIT_TOLERANCE,
  percentTolerance = DEFAULT_PERCENT_TOLERANCE
): number {
  const base = Math.max(excelQty, jubelioQty);
  return Math.max(unitTolerance, Math.ceil(base * percentTolerance));
}

export function classifyReconciliationDelta(
  excelQty: number,
  jubelioQty: number,
  unitTolerance = DEFAULT_UNIT_TOLERANCE,
  percentTolerance = DEFAULT_PERCENT_TOLERANCE
): ReconciliationStatus {
  const delta = excelQty - jubelioQty;
  const tolerance = reconciliationTolerance(
    excelQty,
    jubelioQty,
    unitTolerance,
    percentTolerance
  );
  if (Math.abs(delta) <= tolerance) return "IN_SYNC";
  if (delta > 0) return "EXCEL_HIGHER";
  return "JUBELIO_HIGHER";
}

function itemGroupKey(
  itemId: string | null,
  resolutionStatus: ExcelHistoryRow["resolutionStatus"],
  parentSku: string
): string {
  if (itemId && resolutionStatus === "MAPPED") {
    return `item:${itemId}`;
  }
  return `sku:${parentSku}`;
}

export function aggregateExcelByItem(
  rows: ExcelHistoryRow[]
): Map<
  string,
  { itemId: string | null; parentSku: string; productName: string; excelQty: number }
> {
  const map = new Map<
    string,
    { itemId: string | null; parentSku: string; productName: string; excelQty: number }
  >();

  for (const row of rows) {
    const key = itemGroupKey(row.itemId, row.resolutionStatus, row.parentSku);
    const existing = map.get(key);
    if (existing) {
      existing.excelQty += row.netQuantity;
      if (!existing.productName && row.productName) {
        existing.productName = row.productName;
      }
    } else {
      map.set(key, {
        itemId: row.itemId,
        parentSku: row.parentSku,
        productName: row.productName,
        excelQty: row.netQuantity,
      });
    }
  }

  return map;
}

export function aggregateJubelioByItem(
  lines: JubelioOrderLine[]
): Map<
  string,
  { itemId: string | null; parentSku: string; productName: string; jubelioQty: number }
> {
  const map = new Map<
    string,
    { itemId: string | null; parentSku: string; productName: string; jubelioQty: number }
  >();

  for (const line of lines) {
    const parentSku = line.parentSku ?? "unknown";
    const key =
      line.itemId ? `item:${line.itemId}` : `sku:${parentSku}`;
    const existing = map.get(key);
    if (existing) {
      existing.jubelioQty += line.qty;
    } else {
      map.set(key, {
        itemId: line.itemId,
        parentSku,
        productName: line.productName,
        jubelioQty: line.qty,
      });
    }
  }

  return map;
}

export function buildReconciliationReport(input: {
  channel: SalesChannel;
  periodMonth: number;
  periodYear: number;
  excelRows: ExcelHistoryRow[];
  jubelioLines: JubelioOrderLine[];
  unmappedSkus?: string[];
}): ReconciliationReport {
  const excelByItem = aggregateExcelByItem(input.excelRows);
  const jubelioByItem = aggregateJubelioByItem(input.jubelioLines);

  const allKeys = new Set([...excelByItem.keys(), ...jubelioByItem.keys()]);
  const items: ItemReconciliationRow[] = [];

  let excelTotal = 0;
  let jubelioTotal = 0;

  for (const key of allKeys) {
    const excel = excelByItem.get(key);
    const jubelio = jubelioByItem.get(key);
    const excelQty = excel?.excelQty ?? 0;
    const jubelioQty = jubelio?.jubelioQty ?? 0;
    excelTotal += excelQty;
    jubelioTotal += jubelioQty;

    const itemId = excel?.itemId ?? jubelio?.itemId ?? null;
    const parentSku = excel?.parentSku ?? jubelio?.parentSku ?? key;
    const productName =
      excel?.productName ?? jubelio?.productName ?? parentSku;
    const delta = excelQty - jubelioQty;

    items.push({
      groupKey: key,
      itemId,
      parentSku,
      productName,
      excelQty,
      jubelioQty,
      delta,
      status: classifyReconciliationDelta(excelQty, jubelioQty),
    });
  }

  items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    channel: input.channel,
    periodMonth: input.periodMonth,
    periodYear: input.periodYear,
    excelTotal,
    jubelioTotal,
    delta: excelTotal - jubelioTotal,
    items,
    unmappedSkus: input.unmappedSkus ?? [],
  };
}
