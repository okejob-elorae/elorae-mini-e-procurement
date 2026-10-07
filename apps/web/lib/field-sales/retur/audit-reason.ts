import { FieldReturnError } from "./errors";

/** `AuditLog.reason` is a bare `String?` in the schema, i.e. MySQL `VARCHAR(191)`. */
export const MAX_AUDIT_REASON_LENGTH = 191;

/**
 * The one spelling of a retur writer's required audit reason: trimmed, refused with
 * `MISSING_REASON` when blank, and capped to fit `AuditLog.reason` so an overlong reason can never
 * kill the writer's transaction at insert. The cap counts code points (`Array.from`), not UTF-16
 * units: a utf8mb4 `VARCHAR(191)` measures characters, and cutting by code point never strands half
 * of a surrogate pair.
 */
export function auditReason(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") throw new FieldReturnError("MISSING_REASON");
  return Array.from(trimmed).slice(0, MAX_AUDIT_REASON_LENGTH).join("");
}
