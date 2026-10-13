/**
 * The `(itemId, variantSku)` unique index sits on a case-insensitive collation, so the database
 * treats `ABC-01` and `abc-01` as one variant key; matching here does the same, or a catalog
 * variant shows zero while its real stock surfaces as an off-catalog row under another spelling.
 */
export function matchKey(variantSku: string | null): string {
  return (variantSku ?? "").trim().toLowerCase();
}
