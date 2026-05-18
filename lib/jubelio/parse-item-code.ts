/** Default length of the family / parent product line prefix (e.g. 240000). */
export const FAMILY_CODE_LENGTH = 6;

/**
 * First hyphen-separated segment of item_code.
 * Example: "24000040T-BLK-L" → "24000040T"
 */
export function parseStyleSegment(itemCode: string): string {
  const trimmed = itemCode.trim();
  if (!trimmed) return '';
  const idx = trimmed.indexOf('-');
  if (idx === -1) return trimmed;
  return trimmed.slice(0, idx);
}

/**
 * ERP parent Item.sku = family code (first 6 chars of style segment).
 * Example: "24000040T-BLK-L" → "240000"
 */
export function parseParentSku(itemCode: string): string {
  const style = parseStyleSegment(itemCode);
  if (!style) return '';
  if (style.length <= FAMILY_CODE_LENGTH) return style;
  return style.slice(0, FAMILY_CODE_LENGTH);
}

/**
 * ERP variant sku = style segment + size (last hyphen segment).
 * Drops the middle color token (BLK, CRM, …); Warna/Ukuran stay on the variant JSON.
 * Example: "24000040T-BLK-L" → "24000040T-L"
 */
export function parseVariantSku(itemCode: string): string {
  const trimmed = itemCode.trim();
  if (!trimmed) return '';
  if (!trimmed.includes('-')) return trimmed;

  const parts = trimmed.split('-');
  if (parts.length < 2) return trimmed;

  const style = parts[0];
  const size = parts[parts.length - 1];
  return `${style}-${size}`;
}

export function isVariantlessItemCode(itemCode: string): boolean {
  return !itemCode.trim().includes('-');
}

/** Family code (same as parent SKU when style segment is longer than 6 chars). */
export function parseFamilyCode(itemCode: string): string {
  return parseParentSku(itemCode);
}

/** Style suffix after family within the style segment (e.g. 40T). */
export function parseStyleCode(itemCode: string): string {
  const style = parseStyleSegment(itemCode);
  return style.length > FAMILY_CODE_LENGTH ? style.slice(FAMILY_CODE_LENGTH) : '';
}
