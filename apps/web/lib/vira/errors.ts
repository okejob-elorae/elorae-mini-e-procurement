export type ViraAuthReason =
  | "missing_secret"
  | "invalid"
  | "expired"
  | "forbidden"
  | "bad_service_key"
  | "bad_origin";

export class ViraAuthError extends Error {
  constructor(
    public readonly reason: ViraAuthReason,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "ViraAuthError";
  }
}

/** Thrown by tool handlers when a record does not exist or is not visible. */
export class ViraNotFoundError extends Error {}

/** Thrown by tool handlers for bad input that zod cannot express (e.g. ambiguous store name). */
export class ViraInputError extends Error {}
