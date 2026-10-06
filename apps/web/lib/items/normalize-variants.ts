export type VariantGenerationBase = "category" | "parent";

/** Normalize attribute value for variant SKU segment (e.g. red → RED, light blue → LIGHTBLUE). */
export function slugVariantAttributeValue(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

/**
 * Pattern: `{base}-{v1}-…-{vn}` with n = number of attribute columns (e.g. KMJ01-RED-S).
 */
export function buildVariantSkuCode(
  basePrefix: string,
  combo: Record<string, string>,
  orderedAttributeKeys: string[],
): string {
  const base = basePrefix.trim();
  const segments = orderedAttributeKeys
    .map((key) => slugVariantAttributeValue(combo[key] ?? ""))
    .filter((s) => s.length > 0);
  if (!base) return segments.join("-");
  if (segments.length === 0) return base;
  return `${base}-${segments.join("-")}`;
}

/**
 * The prefix blank variant SKUs are generated from: the parent SKU, falling back to the category
 * code only when the parent SKU is empty.
 */
export function variantSkuBase(parentSku: string, categoryCode?: string | null): string {
  return parentSku.trim() || categoryCode?.trim() || "";
}

function variantSuffixFromRecord(v: Record<string, string>): string {
  const segments = Object.entries(v)
    .filter(([key]) => key !== "sku" && key !== "barcode")
    .map(([, value]) => slugVariantAttributeValue(value))
    .filter((s) => s.length > 0);
  if (segments.length > 0) return segments.join("-");
  const legacy = v.color || v.Color || v.COLOR || v.name || v.nameId || "";
  return legacy.trim().replace(/\s+/g, "-").toUpperCase() || "";
}

/**
 * Normalises a variant list the way the single-item form stores it. A typed SKU must start with
 * the parent SKU or the category code, and one that does not is REWRITTEN onto the generation
 * base; a blank SKU is generated as `<base>-<attribute slugs>`. The base is the parent SKU by
 * default, for the form and the bulk import alike, because two artikels in one category otherwise
 * generate the same SKU for the same Warna/Ukuran; `generateFrom: "category"` keeps the legacy
 * category-code base. A typed SKU with either prefix is never renamed, whichever base is chosen.
 */
export function validateAndNormalizeVariants(
  parentSku: string,
  variants: Array<Record<string, string>> | undefined,
  opts?: { categoryCode?: string | null; generateFrom?: VariantGenerationBase },
): Array<Record<string, string>> {
  if (!variants?.length) return [];
  const prefix = parentSku.trim();
  const cat = opts?.categoryCode?.trim() || "";
  const autoBase = opts?.generateFrom === "category" ? cat || prefix : prefix || cat;
  const validPrefixes: string[] = [];
  if (prefix) validPrefixes.push(prefix);
  if (cat && !validPrefixes.includes(cat)) validPrefixes.push(cat);

  const normalized = variants.map((v, idx) => {
    let sku = (v.sku ?? "").trim();
    if (sku) {
      const ok = validPrefixes.some((p) => sku.startsWith(p));
      if (!ok) {
        if (autoBase) {
          const bare = slugVariantAttributeValue(sku) || sku.replace(/\s+/g, "-").toUpperCase();
          sku = `${autoBase}-${bare}`;
        } else {
          const hint =
            cat && prefix
              ? `parent SKU "${prefix}" or category code "${cat}"`
              : prefix
                ? `parent SKU "${prefix}"`
                : cat
                  ? `category code "${cat}"`
                  : "parent SKU";
          throw new Error(`Variant SKU "${sku}" must start with ${hint}`);
        }
      }
    }
    if (!sku) {
      const suffix = variantSuffixFromRecord(v) || `V${idx + 1}`;
      sku = autoBase ? `${autoBase}-${suffix}` : suffix;
    }
    return { ...v, sku };
  });

  const seen = new Set<string>();
  const seenBarcodes = new Set<string>();
  for (const row of normalized) {
    const key = row.sku.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate variant SKU "${row.sku}"`);
    }
    seen.add(key);
    const barcode = ((row as Record<string, string>).barcode ?? "").trim();
    if (barcode) {
      const barcodeKey = barcode.toLowerCase();
      if (seenBarcodes.has(barcodeKey)) {
        throw new Error(`Duplicate variant barcode "${barcode}"`);
      }
      seenBarcodes.add(barcodeKey);
    }
  }

  return normalized;
}
