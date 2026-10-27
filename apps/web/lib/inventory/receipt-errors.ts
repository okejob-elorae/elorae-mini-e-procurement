export type ReceiptLineErrorCode = "ITEM_NOT_FOUND" | "VARIANT_REQUIRED" | "VARIANT_NOT_ALLOWED";

/**
 * A receipt line the operator must fix: unknown item, or a variant that does not match the item's
 * definition. `detail` is the item id for ITEM_NOT_FOUND and the item SKU for the variant codes.
 */
export class ReceiptLineError extends Error {
  constructor(
    public readonly code: ReceiptLineErrorCode,
    public readonly detail: string,
    message: string,
  ) {
    super(message);
    this.name = "ReceiptLineError";
  }
}

export class WorkOrderNotFoundError extends Error {
  constructor() {
    super("Work Order not found");
    this.name = "WorkOrderNotFoundError";
  }
}
