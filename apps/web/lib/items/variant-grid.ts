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
 * Rebuilds the attribute set from a saved item's free-text variant JSON:
 * one attribute per non-reserved key, in first-seen order, with values
 * de-duplicated case-insensitively (trim + lowercase) and keeping the FIRST
 * spelling seen for each distinct value — so "Merah" and "merah" across two
 * saved variants collapse to one value instead of producing two combinations
 * that both match the same saved row.
 */
export function attributesFromSavedVariants(
  savedVariants: Array<Record<string, string>>
): AttributeDef[] {
  const attributeValues = new Map<string, Map<string, string>>();
  savedVariants.forEach((variant) => {
    Object.entries(variant).forEach(([key, value]) => {
      if (RESERVED_VARIANT_KEYS.has(key)) return;
      if (!attributeValues.has(key)) attributeValues.set(key, new Map());
      const values = attributeValues.get(key)!;
      const normalized = value.trim().toLowerCase();
      if (!values.has(normalized)) values.set(normalized, value);
    });
  });
  return Array.from(attributeValues.entries()).map(([key, values]) => ({
    key,
    values: Array.from(values.values()),
  }));
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
 * in `combo` must match, trimmed and case-insensitive. `sku`/`barcode` are
 * skipped even when `combo` itself carries them — they are not attribute
 * values and must never gate the match.
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
 * The attribute values to submit for a combination: when it matches a saved
 * variant, use THAT variant's own spelling for every key `combo` carries, so
 * an already-saved value (e.g. "merah") round-trips unchanged instead of
 * being replaced by whatever spelling the de-duplicated attribute list
 * happened to keep. Falls back to the combo's own values when there is no
 * saved match (a genuinely new combination).
 */
export function overlaySavedSpelling(
  combo: Record<string, string>,
  savedVariants: Array<Record<string, string>>
): Record<string, string> {
  const match = findSavedVariant(combo, savedVariants);
  if (!match) return combo;
  const resolved: Record<string, string> = {};
  Object.keys(combo).forEach((key) => {
    resolved[key] = match[key] ?? combo[key];
  });
  return resolved;
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

/**
 * Carries row values (SKU or barcode) from a previous set of combinations to
 * a next one, by combination IDENTITY (`comboKey`) rather than row index —
 * so a value added or removed elsewhere in an attribute's value list, which
 * shifts every later row's position, does not hand one combination's saved
 * code to a different one. A combination absent from `nextCombos` simply
 * drops its carried value; one with no match in `prevCombos` gets `""`.
 */
export function carryRowValues(
  prevCombos: Array<Record<string, string>>,
  prevValues: string[],
  nextCombos: Array<Record<string, string>>,
  attributeKeys: string[]
): string[] {
  const byKey = new Map<string, string>();
  prevCombos.forEach((combo, i) => {
    const value = prevValues[i];
    if (value) byKey.set(comboKey(combo, attributeKeys), value);
  });
  return nextCombos.map((combo) => byKey.get(comboKey(combo, attributeKeys)) ?? "");
}
