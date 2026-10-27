export type VendorBillStatus = "UNPAID" | "PARTIAL" | "PAID" | "VOID";

/** Bill status from its paid amount. A zero-total bill has nothing to pay, so it reads PAID. */
export function deriveBillStatus(total: number, paidAmount: number, voided: boolean): VendorBillStatus {
  if (voided) return "VOID";
  if (paidAmount >= total - 0.005) return "PAID";
  if (paidAmount > 0.005) return "PARTIAL";
  return "UNPAID";
}
