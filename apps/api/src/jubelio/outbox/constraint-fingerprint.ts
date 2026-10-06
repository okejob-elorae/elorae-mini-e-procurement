import { JubelioError } from "../jubelio.types";

const SQLSTATE_INTEGRITY_CLASS = /^23\d{3}$/;

/**
 * Identifies a Jubelio reply that carries an integrity-constraint SQLSTATE
 * (class 23, e.g. "23505") in its body `code`. The error message is generic in
 * that case, so the fingerprint is what lets two attempts be compared.
 */
export function constraintFingerprint(err: unknown): string | null {
  if (!(err instanceof JubelioError)) return null;
  const cause = err.cause;
  if (typeof cause !== "object" || cause === null) return null;
  const code = (cause as { code?: unknown }).code;
  if (typeof code !== "string" || !SQLSTATE_INTEGRITY_CLASS.test(code)) return null;
  return `${err.status}:${code}`;
}

export function withFingerprint(message: string, fp: string | null): string {
  return fp === null ? message : `${message} [constraint ${fp}]`;
}

export function hasFingerprint(lastError: string | null | undefined, fp: string): boolean {
  return lastError?.includes(`[constraint ${fp}]`) ?? false;
}
