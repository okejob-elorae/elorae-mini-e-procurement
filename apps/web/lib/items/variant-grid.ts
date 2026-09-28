export type AttributeDef = { key: string; values: string[] };

const COMBO_KEY_SEPARATOR = "\u0000";

const RESERVED_VARIANT_KEYS = new Set(["sku", "barcode"]);

/**
 * Full cartesian product of the given attributes' value sets, skipping any
 * attribute with an empty key or no values. Order matches attribute order,
 * then value order within each attribute.
 */
export function cartesianCombinations(
  attributes: AttributeDef[]
): Array<Record<string, string>> {
  if (attributes.length === 0) return [];
  return attributes.reduce<Array<Record<string, string>>>((acc, attr) => {
    if (!attr.key || attr.values.length === 0) return acc;
    if (acc.length === 0) {
      return attr.values.map((value) => ({ [attr.key]: value }));
    }
    const next: Array<Record<string, string>> = [];
    acc.forEach((combo) => {
      attr.values.forEach((value) => {
        next.push({ ...combo, [attr.key]: value });
      });
    });
    return next;
  }, []);
}

/**
 * Stable identity for a combination, keyed by its attribute VALUES
 * (normalized: trimmed, lowercased) in attribute order, not by row index —
 * so exclusions survive rows moving when values are added or removed.
 */
export function comboKey(
  combo: Record<string, string>,
  attributeKeys: string[]
): string {
  return attributeKeys
    .map((key) => (combo[key] ?? "").trim().toLowerCase())
    .join(COMBO_KEY_SEPARATOR);
}

/**
 * Finds the saved variant (free-text JSON) matching a combination: every key
 * in `combo` must match, trimmed and case-insensitive. `sku`/`barcode` on the
 * saved variant are ignored — they are not attribute values.
 */
export function findSavedVariant(
  combo: Record<string, string>,
  savedVariants: Array<Record<string, string>>
): Record<string, string> | undefined {
  return savedVariants.find((variant) =>
    Object.keys(combo).every((key) => {
      if (RESERVED_VARIANT_KEYS.has(key)) return true;
      const wanted = (combo[key] ?? "").trim().toLowerCase();
      const got = (variant[key] ?? "").trim().toLowerCase();
      return got === wanted;
    })
  );
}

/**
 * The set of combination keys that start EXCLUDED: those with no matching
 * saved variant. Empty when there are no saved variants (a new item starts
 * fully included).
 */
export function initialExcludedKeys(
  combinations: Array<Record<string, string>>,
  savedVariants: Array<Record<string, string>>,
  attributeKeys: string[]
): Set<string> {
  if (savedVariants.length === 0) return new Set();
  const excluded = new Set<string>();
  combinations.forEach((combo) => {
    if (!findSavedVariant(combo, savedVariants)) {
      excluded.add(comboKey(combo, attributeKeys));
    }
  });
  return excluded;
}
