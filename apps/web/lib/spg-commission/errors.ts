export type SpgCommissionRateErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_MONTH"
  | "MONTH_CLOSED"
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_INACTIVE";

export class SpgCommissionRateError extends Error {
  constructor(
    readonly code: SpgCommissionRateErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SpgCommissionRateError";
  }
}
