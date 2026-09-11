import { getJakartaMonthBounds } from "./calculations";

export interface MonthlyColorAllocationRow {
  variantSku: string;
  colorLabel?: string | null;
  allocatedQty: number;
  notes?: string | null;
}

export interface CmtAllocationRow {
  month: number;
  variantSku: string;
  supplierId: string;
  allocatedQty: number;
  supplierName?: string | null;
  notes?: string | null;
}

export interface AllocationValidationResult {
  valid: boolean;
  sum: number;
  target: number;
  delta: number;
  message?: string;
}

export interface PlanCategoryForWo {
  itemId: string | null;
  code: string;
}

export interface WorkOrderPayloadFromCmt {
  finishedGoodId: string;
  vendorId: string;
  plannedQty: number;
  variantSku: string;
  targetDate: Date;
  outputMode: "SKU";
}

export function validateMonthlyColorAllocations(
  monthlyTarget: number,
  rows: Array<Pick<MonthlyColorAllocationRow, "allocatedQty">>
): AllocationValidationResult {
  const sum = rows.reduce((total, row) => total + row.allocatedQty, 0);
  const delta = sum - monthlyTarget;
  const valid = sum === monthlyTarget;
  return {
    valid,
    sum,
    target: monthlyTarget,
    delta,
    message: valid
      ? undefined
      : `Color allocation total (${sum}) must equal monthly target (${monthlyTarget})`,
  };
}

export function validateCmtAllocations(
  colorQty: number,
  rows: Array<Pick<CmtAllocationRow, "allocatedQty">>
): AllocationValidationResult {
  const sum = rows.reduce((total, row) => total + row.allocatedQty, 0);
  const delta = sum - colorQty;
  const valid = sum === colorQty;
  return {
    valid,
    sum,
    target: colorQty,
    delta,
    message: valid
      ? undefined
      : `CMT allocation total (${sum}) must equal color quantity (${colorQty})`,
  };
}

export function stageNameFromAllocation(
  categoryCode: string,
  month: number,
  variantSku: string,
  supplierName: string
): string {
  return `${categoryCode} · M${String(month).padStart(2, "0")} · ${variantSku} · ${supplierName}`;
}

export const VARIANTLESS_FG_FOR_PLAN_MESSAGE =
  "Finished good has no SKU variants. Plan Kerja cannot process variantless items — add variants on the item, then link it again.";

export const STAGE_MISSING_VARIANT_SKU_MESSAGE =
  "Stage has no variant SKU. Assign a variant on this Plan Kerja stage before creating a Work Order.";

export function assertVariantSkuForPlanWo(variantSku: string | null | undefined): string {
  const sku = (variantSku ?? "").trim();
  if (!sku) {
    throw new Error(STAGE_MISSING_VARIANT_SKU_MESSAGE);
  }
  return sku;
}

export function buildWoPayloadFromCmtRow(
  category: PlanCategoryForWo,
  cmtRow: CmtAllocationRow,
  planYear: number
): WorkOrderPayloadFromCmt {
  if (!category.itemId) {
    throw new Error("Plan category must be linked to a finished good item");
  }
  if (cmtRow.allocatedQty <= 0) {
    throw new Error("CMT allocation quantity must be positive");
  }
  const variantSku = assertVariantSkuForPlanWo(cmtRow.variantSku);

  const { endExclusive } = getJakartaMonthBounds(planYear, cmtRow.month);
  const targetDate = new Date(endExclusive.getTime() - 1);

  return {
    finishedGoodId: category.itemId,
    vendorId: cmtRow.supplierId,
    plannedQty: cmtRow.allocatedQty,
    variantSku,
    targetDate,
    outputMode: "SKU",
  };
}
