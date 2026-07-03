export const VARIANT_BARCODE_FORMAT_KEY = "VARIANT_BARCODE_FORMAT";

export const DEFAULT_VARIANT_BARCODE_TEMPLATE = "{categoryCode}{parentSeq:6}{attrs}";

export type VariantBarcodeFormatConfig = {
  template: string;
};

export type VariantBarcodeContext = {
  parentSku: string;
  categoryCode: string;
  combo: Record<string, string>;
  orderedAttributeKeys: string[];
};

const RESERVED_VARIANT_KEYS = new Set(["sku", "barcode"]);

export function slugBarcodeSegment(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

export function extractParentSeq(parentSku: string, padLength: number): string {
  const digits = parentSku.replace(/\D/g, "");
  if (!digits) return "".padStart(padLength, "0");
  const body = digits.length > padLength ? digits.slice(2) : digits;
  const normalized = body.length > padLength ? body.slice(-padLength) : body;
  return normalized.padStart(padLength, "0");
}

function concatAttributeSegments(
  combo: Record<string, string>,
  orderedAttributeKeys: string[]
): string {
  return orderedAttributeKeys
    .map((key) => slugBarcodeSegment(combo[key] ?? ""))
    .filter((segment) => segment.length > 0)
    .join("");
}

function resolveAttributeByName(
  combo: Record<string, string>,
  attributeName: string
): string {
  const target = attributeName.trim().toLowerCase();
  for (const [key, value] of Object.entries(combo)) {
    if (RESERVED_VARIANT_KEYS.has(key)) continue;
    if (key.trim().toLowerCase() === target) {
      return slugBarcodeSegment(value);
    }
  }
  return "";
}

export function parseVariantBarcodeFormat(raw: string | null | undefined): VariantBarcodeFormatConfig {
  if (!raw?.trim()) {
    return { template: DEFAULT_VARIANT_BARCODE_TEMPLATE };
  }
  try {
    const parsed = JSON.parse(raw) as { template?: unknown };
    const template =
      typeof parsed.template === "string" && parsed.template.trim()
        ? parsed.template.trim()
        : DEFAULT_VARIANT_BARCODE_TEMPLATE;
    return { template };
  } catch {
    return { template: DEFAULT_VARIANT_BARCODE_TEMPLATE };
  }
}

export function buildVariantBarcode(
  config: VariantBarcodeFormatConfig,
  ctx: VariantBarcodeContext
): string {
  const orderedKeys = ctx.orderedAttributeKeys
    .map((key) => key.trim())
    .filter((key) => key.length > 0 && !RESERVED_VARIANT_KEYS.has(key));
  const attrs = concatAttributeSegments(ctx.combo, orderedKeys);

  let result = config.template;
  result = result.replace(/\{categoryCode\}/g, ctx.categoryCode.trim());
  result = result.replace(/\{parentSku\}/g, ctx.parentSku.trim());
  result = result.replace(/\{attrs\}/g, attrs);
  result = result.replace(/\{parentSeq:(\d+)\}/g, (_match, padLength: string) =>
    extractParentSeq(ctx.parentSku, Number(padLength) || 6)
  );
  result = result.replace(/\{attr:([^}]+)\}/g, (_match, attributeName: string) =>
    resolveAttributeByName(ctx.combo, attributeName)
  );
  return result.trim();
}
