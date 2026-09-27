import { isDocTypeValue, type DocTypeValue } from "./doc-type-groups";

export const RESET_PERIODS = ["YEARLY", "MONTHLY", "NEVER"] as const;
export type ResetPeriod = (typeof RESET_PERIODS)[number];

/**
 * `DocNumberConfig.prefix` is `VARCHAR(191)`, but the generated `docNo` appends up to
 * `YYYY/MM/NNNNNNNN` to it, so the real ceiling is the document columns, not the config column.
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
