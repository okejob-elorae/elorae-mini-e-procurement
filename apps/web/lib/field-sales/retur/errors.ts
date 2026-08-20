export type FieldReturnErrorCode =
  | "NO_LINES"
  | "BAD_QTY"
  | "STORE_NOT_FOUND"
  | "VISIT_NOT_OWNED"
  | "MISSING_RESI"
  | "MISSING_REASON_NOTE";

export class FieldReturnError extends Error {
  constructor(public code: FieldReturnErrorCode) {
    super(code);
    this.name = "FieldReturnError";
  }
}
