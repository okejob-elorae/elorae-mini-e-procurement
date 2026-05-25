export const FAMILY_CODE_LENGTH = 6;

export function parseStyleSegment(itemCode: string): string {
  const trimmed = itemCode.trim();
  if (!trimmed) return "";
  const idx = trimmed.indexOf("-");
  if (idx === -1) return trimmed;
  return trimmed.slice(0, idx);
}

export function parseParentSku(itemCode: string): string {
  const style = parseStyleSegment(itemCode);
  if (!style) return "";
  if (style.length <= FAMILY_CODE_LENGTH) return style;
  return style.slice(0, FAMILY_CODE_LENGTH);
}

export function parseVariantSku(itemCode: string): string {
  const trimmed = itemCode.trim();
  if (!trimmed) return "";
  if (!trimmed.includes("-")) return trimmed;

  const parts = trimmed.split("-");
  if (parts.length < 2) return trimmed;

  const style = parts[0];
  const size = parts[parts.length - 1];
  return `${style}-${size}`;
}

export function isVariantlessItemCode(itemCode: string): boolean {
  return !itemCode.trim().includes("-");
}

export function parseFamilyCode(itemCode: string): string {
  return parseParentSku(itemCode);
}

export function parseStyleCode(itemCode: string): string {
  const style = parseStyleSegment(itemCode);
  return style.length > FAMILY_CODE_LENGTH ? style.slice(FAMILY_CODE_LENGTH) : "";
}
