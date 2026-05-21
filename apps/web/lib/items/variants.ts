export type ItemVariantRow = Record<string, string>;

export function parseItemVariants(raw: unknown): ItemVariantRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is ItemVariantRow => v != null && typeof v === 'object' && !Array.isArray(v));
}

/** Options for PO/GRN variant selects; skips rows without sku. */
/** Human-readable attributes for a variant row (excludes sku key). */
export function variantDetailForSku(
  variants: unknown,
  variantSku: string | null | undefined
): string | null {
  if (!variantSku?.trim()) return null;
  const rows = parseItemVariants(variants);
  const row = rows.find((v) => (v.sku ?? '').trim() === variantSku.trim());
  if (!row) return null;
  const parts = Object.entries(row)
    .filter(([k, v]) => k !== 'sku' && v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${String(v).trim()}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function variantSelectOptions(variants: ItemVariantRow[]): { sku: string; label: string }[] {
  const out: { sku: string; label: string }[] = [];
  for (const v of variants) {
    const sku = (v.sku ?? '').trim();
    if (!sku) continue;
    const labelParts = [v.color, v.size, v.name, v.nameId]
      .map((x) => (x != null ? String(x).trim() : ''))
      .filter(Boolean);
    const label = labelParts.length > 0 ? `${labelParts.join(' · ')} (${sku})` : sku;
    out.push({ sku, label });
  }
  return out;
}
