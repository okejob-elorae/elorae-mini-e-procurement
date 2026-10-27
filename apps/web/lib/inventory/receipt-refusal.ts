import { ConcurrentFirstReceiptError, MainStockNegativeError } from "@elorae/db";
import { ReceiptLineError, WorkOrderNotFoundError } from "./receipt-errors";

export type ReceiptRefusalCode =
  | "CONCURRENT_FIRST_RECEIPT"
  | "MAIN_STOCK_NEGATIVE"
  | "ITEM_NOT_FOUND"
  | "VARIANT_REQUIRED"
  | "VARIANT_NOT_ALLOWED"
  | "WORK_ORDER_NOT_FOUND";

export type ReceiptRefusal = { success: false; code: ReceiptRefusalCode; detail?: string };

/**
 * Known refusals of a stock receipt as a typed result, so production's digest-masking of thrown
 * server-action errors cannot hide them. Anything else returns null and must be rethrown.
 */
export function toReceiptRefusal(error: unknown): ReceiptRefusal | null {
  if (error instanceof ConcurrentFirstReceiptError) {
    return { success: false, code: "CONCURRENT_FIRST_RECEIPT" };
  }
  if (error instanceof MainStockNegativeError) {
    return { success: false, code: "MAIN_STOCK_NEGATIVE" };
  }
  if (error instanceof ReceiptLineError) {
    return { success: false, code: error.code, detail: error.detail };
  }
  if (error instanceof WorkOrderNotFoundError) {
    return { success: false, code: "WORK_ORDER_NOT_FOUND" };
  }
  return null;
}
