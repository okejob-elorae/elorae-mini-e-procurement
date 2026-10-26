import { resolveVariantAxes } from "@elorae/db/variant-axes";
import { groupVariantsByColor, type VariantAxisRow } from "@/lib/work-orders/color-ratio";
import { parseItemVariants } from "@/lib/items/variants";
import { apportion } from "./apportion";

export type WorkOrderExportInput = {
  docNumber: string;
  status: string;
  createdAt: Date;
  issuedAt: Date | null;
  targetDate: Date | null;
  notes: string | null;
  plannedQty: number;
  outputMode: string;
  vendor: { name: string; code: string };
  finishedGood: { sku: string; nameId: string; uomCode: string; variants: unknown };
  skuBreakdown: unknown;
  consumptionPlan: unknown;
};

export type SheetRows = Array<Array<string | number | null>>;

type BreakdownEntry = { variantSku: string; ratioPercent: number };

type PlanLine = {
  itemName: string;
  uomCode: string;
  qtyRequired: number;
  wastePercent: number;
  plannedQty: number;
  issuedQty: number;
  byColor: Array<{ colorName: string; plannedQty: number }> | null;
};

const DASH = "—";
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function wibDate(date: Date | null): string {
  if (!date) return "";
  return new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseBreakdown(raw: unknown): BreakdownEntry[] {
  const value = parseMaybeJson(raw);
  if (Array.isArray(value)) {
    const entries: BreakdownEntry[] = [];
    for (const e of value) {
      if (e && typeof e === "object" && typeof (e as { variantSku?: unknown }).variantSku === "string") {
        const entry = e as { variantSku: string; ratioPercent?: unknown };
        entries.push({ variantSku: entry.variantSku, ratioPercent: toNumber(entry.ratioPercent) });
      }
    }
    return entries;
  }
  if (value && typeof value === "object" && typeof (value as { variantSku?: unknown }).variantSku === "string") {
    return [{ variantSku: (value as { variantSku: string }).variantSku, ratioPercent: 100 }];
  }
  return [];
}

function parsePlan(raw: unknown): PlanLine[] {
  const value = parseMaybeJson(raw);
  if (!Array.isArray(value)) return [];
  const lines: PlanLine[] = [];
  for (const m of value) {
    if (!m || typeof m !== "object") continue;
    const line = m as Record<string, unknown>;
    const byColor = Array.isArray(line.byColor)
      ? line.byColor
          .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
          .map((c) => ({ colorName: String(c.colorName ?? DASH), plannedQty: toNumber(c.plannedQty) }))
      : [];
    lines.push({
      itemName: String(line.itemName ?? ""),
      uomCode: String(line.uomCode ?? ""),
      qtyRequired: toNumber(line.qtyRequired),
      wastePercent: toNumber(line.wastePercent),
      plannedQty: toNumber(line.plannedQty),
      issuedQty: toNumber(line.issuedQty),
      byColor: byColor.length > 0 ? byColor : null,
    });
  }
  return lines;
}

function sum(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

type QtyRow = VariantAxisRow & { ratioPercent: number; qty: number };

function buildQtyRows(input: WorkOrderExportInput, entries: BreakdownEntry[]): QtyRow[] {
  const bySku = new Map<string, { colorLabel: string | null; size: string | null }>();
  for (const v of parseItemVariants(input.finishedGood.variants)) {
    const sku = (v.sku ?? "").trim();
    if (!sku) continue;
    const axes = resolveVariantAxes(v, new Map());
    bySku.set(sku, { colorLabel: axes.colorLabel, size: axes.size });
  }

  const qtys = apportion(input.plannedQty, entries.map((e) => e.ratioPercent));
  const rows = entries.map((e, i): QtyRow => {
    const axes = bySku.get(e.variantSku.trim());
    return {
      variantSku: e.variantSku,
      colorKey: axes?.colorLabel ? axes.colorLabel.toLowerCase() : "none",
      colorName: axes?.colorLabel ?? null,
      size: axes?.size ?? null,
      ratioPercent: e.ratioPercent,
      qty: qtys[i],
    };
  });
  /* rows with no colour (unknown SKUs included) go last, so groupVariantsByColor lists them last */
  return [...rows.filter((r) => r.colorKey !== "none"), ...rows.filter((r) => r.colorKey === "none")];
}

function buildMatrix(rows: QtyRow[]): { matrix: SheetRows; detail: SheetRows } {
  const groups = groupVariantsByColor(rows) as Array<{ colorKey: string; colorName: string | null; variants: QtyRow[] }>;

  const knownSizes = new Map<string, string>();
  let hasUnsized = false;
  for (const r of rows) {
    if (r.size) knownSizes.set(r.size.toLowerCase(), r.size);
    else hasUnsized = true;
  }
  const sizeRows = groupVariantsByColor(
    [...knownSizes.values()].map((size) => ({ variantSku: size, colorKey: "all", colorName: null, size })),
  );
  const sizes = (sizeRows[0]?.variants ?? []).map((v) => v.size as string);
  if (hasUnsized) sizes.push(DASH);

  const matrix: SheetRows = [["Warna", ...sizes, "Total"]];
  const columnTotals = sizes.map(() => 0);
  const detail: SheetRows = [["Varian SKU", "Warna", "Ukuran", "Rasio (%)", "Qty"]];

  for (const g of groups) {
    const cells: Array<number | null> = sizes.map(() => null);
    for (const v of g.variants) {
      const col = sizes.indexOf(v.size ? (knownSizes.get(v.size.toLowerCase()) as string) : DASH);
      cells[col] = sum([cells[col] ?? 0, v.qty]);
      columnTotals[col] = sum([columnTotals[col], v.qty]);
      detail.push([v.variantSku, g.colorName ?? DASH, v.size ?? DASH, v.ratioPercent, v.qty]);
    }
    matrix.push([g.colorName ?? DASH, ...cells, sum(g.variants.map((v) => v.qty))]);
  }

  const grand = sum(columnTotals);
  matrix.push(["Total", ...columnTotals, grand]);
  detail.push(["Total", null, null, sum(rows.map((r) => r.ratioPercent)), grand]);
  return { matrix, detail };
}

function buildMaterials(raw: unknown): SheetRows {
  const header: SheetRows = [["Bahan", "Warna", "Satuan", "Per Pcs", "Waste (%)", "Rencana", "Sudah Diissue"]];
  const plan = parsePlan(raw);
  if (plan.length === 0) return [...header, ["Belum ada rencana bahan"]];

  const out = header;
  for (const m of plan) {
    if (m.byColor) {
      for (const c of m.byColor) out.push([m.itemName, c.colorName, m.uomCode, null, null, c.plannedQty, null]);
      out.push([m.itemName, "Total", m.uomCode, m.qtyRequired, m.wastePercent, m.plannedQty, m.issuedQty]);
    } else {
      out.push([m.itemName, "", m.uomCode, m.qtyRequired, m.wastePercent, m.plannedQty, m.issuedQty]);
    }
  }
  return out;
}

export function buildWorkOrderExportSheets(input: WorkOrderExportInput): {
  workOrder: SheetRows;
  skuDetail: SheetRows | null;
  materials: SheetRows;
} {
  const { finishedGood: fg } = input;
  const workOrder: SheetRows = [
    ["No. WO", input.docNumber],
    ["Tanggal", wibDate(input.createdAt)],
    ["Tanggal Issue", wibDate(input.issuedAt)],
    ["Target Selesai", wibDate(input.targetDate)],
    ["Status", input.status],
    ["Vendor", `${input.vendor.name} (${input.vendor.code})`],
    ["Produk", `${fg.sku} ${DASH} ${fg.nameId}`],
    ["Total Qty", `${input.plannedQty} ${fg.uomCode}`],
    ["Catatan", input.notes ?? ""],
    [],
  ];

  const entries = parseBreakdown(input.skuBreakdown);
  let skuDetail: SheetRows | null = null;
  if (entries.length === 0) {
    workOrder.push(["Tanpa rincian warna/ukuran (generic)"]);
  } else {
    const { matrix, detail } = buildMatrix(buildQtyRows(input, entries));
    workOrder.push(...matrix);
    skuDetail = detail;
  }

  return { workOrder, skuDetail, materials: buildMaterials(input.consumptionPlan) };
}
