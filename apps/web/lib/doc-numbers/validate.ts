import { isDocTypeValue, type DocTypeValue } from "./doc-type-groups";

export const RESET_PERIODS = ["YEARLY", "MONTHLY", "NEVER"] as const;
export type ResetPeriod = (typeof RESET_PERIODS)[number];

/**
 * A deliberate UX cap, well inside the real ceiling. The prefix column and the document-number
 * columns it feeds are all `VARCHAR(191)`, and the generator appends at most 17 characters to a
 * prefix: an auto-added `/`, `YYYY/MM/`, and up to 8 digits of padding.
 */
export const PREFIX_MAX_LENGTH = 20;

export type DocNumberConfigErrorCode =
  | "UNKNOWN_DOC_TYPE"
  | "PREFIX_REQUIRED"
  | "PREFIX_TOO_LONG"
  | "INVALID_RESET_PERIOD"
  | "INVALID_PADDING";

export type DocNumberConfigInput = {
  docType: string;
  prefix: string;
  resetPeriod: string;
  padding: number;
};

export type DocNumberConfigValidation =
  | { ok: true; value: { docType: DocTypeValue; prefix: string; resetPeriod: ResetPeriod; padding: number } }
  | { ok: false; code: DocNumberConfigErrorCode };

function isResetPeriod(value: string): value is ResetPeriod {
  return (RESET_PERIODS as readonly string[]).includes(value);
}

/* Shared by the settings form and the server action — the action re-runs it because every `"use server"` export is independently callable. */
export function validateDocNumberConfigInput(input: DocNumberConfigInput): DocNumberConfigValidation {
  if (!isDocTypeValue(input.docType)) return { ok: false, code: "UNKNOWN_DOC_TYPE" };
  const prefix = input.prefix.trim();
  if (prefix === "") return { ok: false, code: "PREFIX_REQUIRED" };
  if (prefix.length > PREFIX_MAX_LENGTH) return { ok: false, code: "PREFIX_TOO_LONG" };
  if (!isResetPeriod(input.resetPeriod)) return { ok: false, code: "INVALID_RESET_PERIOD" };
  if (!Number.isInteger(input.padding) || input.padding < 1 || input.padding > 8) {
    return { ok: false, code: "INVALID_PADDING" };
  }
  return { ok: true, value: { docType: input.docType, prefix, resetPeriod: input.resetPeriod, padding: input.padding } };
}

/* A prefix as `generateDocNumber` renders it: trimmed, as the validator stores it, plus the `/` it appends when missing. */
export function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/**
 * Returns the doc type that already renders `prefix`, or null. Compared case-insensitively
 * because the document-number columns use a `_ci` collation, where `putus/` and `PUTUS/` are
 * the same unique value. Some doc types write one `@unique` column (PUTUS and KONSI both write
 * `FieldSalesOrder.orderNo`), so a shared prefix makes one type draw numbers the other issued.
 */
export function findPrefixConflict<T extends string>(
  docType: string,
  prefix: string,
  rows: readonly { docType: T; prefix: string }[]
): T | null {
  const wanted = normalizePrefix(prefix).toLowerCase();
  const clash = rows.find((row) => row.docType !== docType && normalizePrefix(row.prefix).toLowerCase() === wanted);
  return clash ? clash.docType : null;
}
