import type { OpnameScope, OpnameStatus } from "@elorae/db";
import { Decimal } from "decimal.js";

export const SELF_APPROVAL_ERROR =
  "Penghitung tidak dapat menyetujui opname yang dibuatnya sendiri. Minta admin lain untuk approve.";

export function computeVariance(counted: number, snapshot: number): number {
  return new Decimal(counted).minus(snapshot).toNumber();
}

export function hasQtyDrift(currentQty: number, snapshotQty: number): boolean {
  return !new Decimal(currentQty).equals(snapshotQty);
}

export function shouldApplyAdjustment(countedQty: number, currentQty: number): boolean {
  return !new Decimal(countedQty).equals(currentQty);
}

export function isSelfApprovalBlocked(
  submittedById: string | null | undefined,
  approverId: string,
  canApproveOwn: boolean,
): boolean {
  if (canApproveOwn) return false;
  if (!submittedById) return false;
  return submittedById === approverId;
}

export function scopeToItemType(scope: OpnameScope): "FINISHED_GOOD" | "FABRIC" | "ACCESSORIES" {
  return scope;
}

const VALID_SUBMIT_STATUSES: OpnameStatus[] = ["COUNTING", "CREATED"];

export function canSubmitOpname(status: OpnameStatus): boolean {
  return VALID_SUBMIT_STATUSES.includes(status);
}

const VALID_APPROVE_STATUS: OpnameStatus = "SUBMITTED";

export function canApproveOpname(status: OpnameStatus): boolean {
  return status === VALID_APPROVE_STATUS;
}

const CANCELLABLE: OpnameStatus[] = ["CREATED", "COUNTING", "SUBMITTED"];

export function canCancelOpname(status: OpnameStatus): boolean {
  return CANCELLABLE.includes(status);
}

export function allItemCountsFilled(
  rows: Array<{ countedQty: unknown }>,
): boolean {
  return rows.every((r) => r.countedQty != null);
}

export function allRollCountsFilled(
  rows: Array<{ countedLength: unknown }>,
): boolean {
  return rows.every((r) => r.countedLength != null);
}

export function normalizeVariantKey(variantSku: string | null | undefined): string {
  return variantSku ?? "";
}
