export type PushableSnapshot = {
  nameId: string;
  nameEn: string;
  description: string | null;
  sellingPrice: number | null;
  variants: Array<Record<string, string>> | null;
  isActive: boolean;
};

function normalizeVariants(input: PushableSnapshot['variants']): string {
  if (!input || input.length === 0) return '[]';
  const sorted = [...input]
    .map((v) => {
      const sku = (v as Record<string, string>).sku ?? '';
      const entries = Object.entries(v as Record<string, string>)
        .filter(([k]) => k !== 'sku')
        .sort(([a], [b]) => a.localeCompare(b));
      return JSON.stringify({ sku, attrs: entries });
    })
    .sort();
  return JSON.stringify(sorted);
}

export function hasPushableChange(before: PushableSnapshot, after: PushableSnapshot): boolean {
  if (before.nameId !== after.nameId) return true;
  if (before.nameEn !== after.nameEn) return true;
  if ((before.description ?? '') !== (after.description ?? '')) return true;
  if ((before.sellingPrice ?? null) !== (after.sellingPrice ?? null)) return true;
  if (before.isActive !== after.isActive) return true;
  if (normalizeVariants(before.variants) !== normalizeVariants(after.variants)) return true;
  return false;
}
