/**
 * Comparison key for SKU and barcode uniqueness checks. The database compares these columns under
 * utf8mb4_unicode_ci, which ignores case AND accents, so a validator that only lower-cases passes
 * "CAFÉ" beside "CAFE" and the insert then fails on the unique index. Match key only: never
 * write it back to a row.
 */
export function skuMatchKey(value: string): string {
  return value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
