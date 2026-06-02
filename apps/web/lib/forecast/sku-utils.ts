/**
 * Derive parent SKU from variant SKU.
 * Hyphenated: first segment before hyphen.
 * Non-hyphenated: unchanged.
 */
export function deriveParentSku(variantSku: string): string {
  const trimmed = variantSku.trim();
  if (trimmed.includes("-")) {
    return trimmed.split("-")[0];
  }
  return trimmed;
}

/**
 * Parse variation strings like "Dark Brown,M" or "Black, L".
 */
export function parseVariation(variation: string | null | undefined): {
  color: string | null;
  size: string | null;
} {
  if (!variation || variation.trim() === "") {
    return { color: null, size: null };
  }

  const parts = variation.split(",").map((s) => s.trim());
  if (parts.length === 1) return { color: parts[0], size: null };
  if (parts.length === 2) return { color: parts[0], size: parts[1] };
  return { color: parts[0], size: parts[parts.length - 1] };
}

export function parseNumber(value: unknown, defaultValue = 0): number {
  if (value == null || value === "") return defaultValue;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const str = String(value).replace(/,/g, "").trim();
  const num = Number(str);
  return Number.isFinite(num) ? num : defaultValue;
}

export function parseIntSafe(value: unknown, defaultValue = 0): number {
  return Math.trunc(parseNumber(value, defaultValue));
}

export function cellString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}
