export type FieldReturnErrorCode =
  | "NO_LINES"
  | "BAD_QTY"
  | "BAD_LINE_SHAPE"
  | "ITEM_NOT_FOUND"
  | "BAD_VARIANT"
  | "STORE_NOT_FOUND"
  | "VISIT_NOT_OWNED"
  | "MISSING_RESI"
  | "MISSING_EXPEDITION_NAME"
  | "MISSING_REASON_NOTE"
  | "MISSING_NOTA_PHOTO"
  | "MISSING_TRANSPORT"
  | "INVALID_STATE"
  | "SPLIT_MISMATCH"
  | "UNKNOWN_LINE"
  | "MISSING_LINE"
  | "NOT_FOUND"
  | "DUPLICATE_LINE"
  | "NO_VARIANCE"
  | "RESOLUTION_DIRECTION_MISMATCH"
  | "SALESMAN_BEARS_NOT_ALLOWED"
  | "UNRESOLVED_LINES"
  | "MISSING_REASON";

export class FieldReturnError extends Error {
  /**
   * @param detail Optional human label for what the code is about (today: the product and
   * variant of the line a `SPLIT_MISMATCH` names). Never part of `message`, so existing
   * message-based assertions and logs are unchanged.
   */
  constructor(
    public code: FieldReturnErrorCode,
    public detail?: string,
  ) {
    super(code);
    this.name = "FieldReturnError";
  }
}
