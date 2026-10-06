export type AttributeDef = { key: string; values: string[] };

const COMBO_KEY_SEPARATOR = "\u0000";

const RESERVED_VARIANT_KEYS = new Set(["sku", "barcode"]);

/**
 * The attributes `cartesianCombinations` actually uses: a trimmed, non-empty
 * key AND at least one value. This is the ONE shared rule for "does this
 * attribute row contribute to the grid" — `cartesianCombinations` and the
 * caller's own attribute-key list must always agree on it, or a row with a
 * name typed but no value yet (or vice versa) desyncs the combos built from
 * the grid from the key list used to identify them.
 */
export function contributingAttributes(attributes: AttributeDef[]): AttributeDef[] {
  return attributes.filter((attr) => attr.key.trim() !== "" && attr.values.length > 0);
}

/**
 * Full cartesian product of the given attributes' value sets, skipping any
 * non-contributing attribute (see `contributingAttributes`). Order matches
 * attribute order, then value order within each attribute.
 */
export function cartesianCombinations(
  attributes: AttributeDef[]
): Array<Record<string, string>> {
  const contributing = contributingAttributes(attributes);
  if (contributing.length === 0) return [];
  return contributing.reduce<Array<Record<string, string>>>((acc, attr) => {
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
 * The contributing attribute names that collide with another one under
 * `trim().toLowerCase()`, one entry per colliding name (its first spelling,
 * trimmed). Empty when every name is unique. Two such names build combos
 * where one attribute's value overwrites the other's.
 */
export function findCollidingAttributeNames(attributes: AttributeDef[]): string[] {
  const firstSpelling = new Map<string, string>();
  const colliding = new Set<string>();
  contributingAttributes(attributes).forEach((attr) => {
    const normalized = attr.key.trim().toLowerCase();
    if (firstSpelling.has(normalized)) colliding.add(normalized);
    else firstSpelling.set(normalized, attr.key.trim());
  });
  return Array.from(colliding).map((normalized) => firstSpelling.get(normalized) ?? normalized);
}

/**
 * A grid is COMPLETE when every row is either fully empty (no key, no
 * values — a freshly added row awaiting input) or fully filled (a trimmed
 * key AND at least one value), and every contributing key name is unique
 * case-insensitively (`findCollidingAttributeNames`). A row typed
 * key-first-then-value, or mid-rename, or momentarily colliding with another
 * attribute's name, is INCOMPLETE — the combos it would build are transient
 * and unsafe to snapshot for carrying.
 */
export function isGridComplete(attributes: AttributeDef[]): boolean {
  const rowsValid = attributes.every((attr) => {
    const keyEmpty = attr.key.trim() === "";
    const valuesEmpty = attr.values.length === 0;
    return (keyEmpty && valuesEmpty) || (!keyEmpty && !valuesEmpty);
  });
  if (!rowsValid) return false;
  return findCollidingAttributeNames(attributes).length === 0;
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
 * A record's attribute entries with names and values trimmed and lowercased,
 * `sku`/`barcode` left out.
 */
function normalizedAttributeEntries(record: Record<string, string>): Map<string, string> {
  const entries = new Map<string, string>();
  Object.entries(record).forEach(([key, value]) => {
    if (RESERVED_VARIANT_KEYS.has(key)) return;
    entries.set(key.trim().toLowerCase(), (value ?? "").trim().toLowerCase());
  });
  return entries;
}

/**
 * Finds the saved variant (free-text JSON) matching a combination: the saved
 * variant's attribute names must be EXACTLY the combo's, and every value must
 * match — names and values trimmed and case-insensitive. A saved variant with
 * an attribute the combo lacks does not match, so removing an attribute never
 * hands one saved variant's code to a combination it only partly describes.
 * `sku`/`barcode` are skipped on both sides — they are not attribute values
 * and must never gate the match.
 */
export function findSavedVariant(
  combo: Record<string, string>,
  savedVariants: Array<Record<string, string>>
): Record<string, string> | undefined {
  const wanted = normalizedAttributeEntries(combo);
  return savedVariants.find((variant) => {
    const got = normalizedAttributeEntries(variant);
    if (got.size !== wanted.size) return false;
    return Array.from(wanted).every(([key, value]) => got.get(key) === value);
  });
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
 * Groups indices by their `comboKey` projection under `keys`, for the
 * one-to-one check in the attribute-count-changed branch of
 * `carryRowValues` below.
 */
function groupIndicesByProjection(
  combos: Array<Record<string, string>>,
  keys: string[]
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  combos.forEach((combo, i) => {
    const key = comboKey(combo, keys);
    const indices = groups.get(key);
    if (indices) indices.push(i);
    else groups.set(key, [i]);
  });
  return groups;
}

/**
 * Carries row values (SKU or barcode) from a previous set of combinations to
 * a next one, by combination IDENTITY rather than row index — so a value
 * added, removed, or renamed elsewhere in the attribute list, which shifts
 * or relabels every later row, does not hand one combination's saved code to
 * a different one.
 *
 * `prevKeys`/`nextKeys` are the attribute key lists each side's combinations
 * were built with:
 * - Same attribute COUNT (an identical key list, or a rename — `comboKey`
 *   never embeds key names, only the values it looks up by them, so this
 *   also carries a plain rename correctly): match positionally, by each
 *   side's own `comboKey`.
 * - Attribute added or removed (count differs): project both sides onto the
 *   shared key NAMES only, and carry a value only when that projection is
 *   one-to-one on BOTH sides (exactly one prev combo and exactly one next
 *   combo share it) — otherwise the row is blank. This is deliberately
 *   conservative: it never hands the same SKU to two rows.
 */
export function carryRowValues(
  prevCombos: Array<Record<string, string>>,
  prevValues: string[],
  prevKeys: string[],
  nextCombos: Array<Record<string, string>>,
  nextKeys: string[]
): string[] {
  if (prevKeys.length === nextKeys.length) {
    const byKey = new Map<string, string>();
    prevCombos.forEach((combo, i) => {
      const value = prevValues[i];
      if (value) byKey.set(comboKey(combo, prevKeys), value);
    });
    return nextCombos.map((combo) => byKey.get(comboKey(combo, nextKeys)) ?? "");
  }

  const sharedKeys = nextKeys.filter((key) => prevKeys.includes(key));
  if (sharedKeys.length === 0) return nextCombos.map(() => "");

  const prevGroups = groupIndicesByProjection(prevCombos, sharedKeys);
  const nextGroups = groupIndicesByProjection(nextCombos, sharedKeys);

  return nextCombos.map((combo) => {
    const projection = comboKey(combo, sharedKeys);
    const prevIndices = prevGroups.get(projection);
    const nextIndices = nextGroups.get(projection);
    if (!prevIndices || prevIndices.length !== 1) return "";
    if (!nextIndices || nextIndices.length !== 1) return "";
    return prevValues[prevIndices[0]] ?? "";
  });
}

/**
 * The variant table's rows: the combinations, the attribute keys they were
 * built with, and each row's SKU and barcode, index-aligned to `combos`.
 * Held as ONE value so a code can never be paired with a combination from a
 * different layout.
 */
export type GridRows = {
  combos: Array<Record<string, string>>;
  keys: string[];
  skus: string[];
  barcodes: string[];
};

/**
 * `rows` is what the table shows now. `snapshot` is the last COMPLETE grid
 * (`isGridComplete`) with its values, plus any codes edited while the table
 * still showed that same grid, which `resolveGridRows` folds in. Which of
 * the two a structural change carries from is decided in `resolveGridRows`.
 */
export type GridState = { rows: GridRows; snapshot: GridRows };

export const EMPTY_GRID_ROWS: GridRows = { combos: [], keys: [], skus: [], barcodes: [] };

export type RowValueField = "skus" | "barcodes";

/**
 * True when two row sets describe the same grid: identical attribute keys in
 * the same order, and the same `comboKey` sequence row by row.
 */
export function isSameGrid(
  a: Pick<GridRows, "combos" | "keys">,
  b: Pick<GridRows, "combos" | "keys">
): boolean {
  if (a.keys.length !== b.keys.length) return false;
  if (a.keys.some((key, i) => key !== b.keys[i])) return false;
  if (a.combos.length !== b.combos.length) return false;
  return a.combos.every(
    (combo, i) => comboKey(combo, a.keys) === comboKey(b.combos[i], b.keys)
  );
}

/**
 * True when two attribute key lists name the same attributes in the same
 * order, trimmed and case-insensitive. `carryRowValues` then matches every
 * row by its full `comboKey`, so each value it carries comes from the
 * IDENTICAL combination; with different lists it carries by rename position
 * or by projection instead.
 */
function isSameKeyList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((key, i) => key.trim().toLowerCase() === b[i].trim().toLowerCase());
}

/**
 * One row's code by precedence: a code carried from the same combination
 * (what the user has in that exact row now), then the saved variant's code,
 * then a code carried by a rename or projection, then "".
 */
function resolveRowCode(
  carried: string,
  carriedFromSameCombination: boolean,
  saved: string | undefined
): string {
  if (carriedFromSameCombination && carried) return carried;
  return saved?.trim() || carried;
}

/**
 * Recomputes the table rows for a new attribute list.
 *
 * Carry source: the current rows when they still show the snapshot's own
 * grid, or when the new attribute list leaves the grid on screen unchanged
 * (both via `isSameGrid`) — so codes typed or generated since the snapshot
 * was taken are kept, whether an extra name-only attribute row made the grid
 * incomplete, or the rows show a transient layout (a cleared name or value
 * list) that the change keeps as is. Otherwise the snapshot, so a transient
 * layout never carries into a DIFFERENT grid.
 *
 * Each row resolves as (`resolveRowCode`): the code carried from the same
 * combination → the matching saved variant's code (`findSavedVariant`) → the
 * code carried by a rename or projection (`carryRowValues`) → "". So a code
 * the user typed over a saved one survives the next attribute edit. The new
 * rows become the snapshot when the new attribute list is complete;
 * otherwise the snapshot adopts the current rows only when they still show
 * its own grid, so a transient layout never becomes the snapshot.
 */
export function resolveGridRows(input: {
  attributes: AttributeDef[];
  savedVariants: Array<Record<string, string>>;
  rows: GridRows;
  snapshot: GridRows;
}): GridState {
  const { attributes, savedVariants, rows, snapshot } = input;
  const combos = cartesianCombinations(attributes);
  const keys = contributingAttributes(attributes).map((attr) => attr.key);
  const rowsShowSnapshot = isSameGrid(rows, snapshot);
  const source = rowsShowSnapshot || isSameGrid(rows, { combos, keys }) ? rows : snapshot;
  const carriedSkus = carryRowValues(source.combos, source.skus, source.keys, combos, keys);
  const carriedBarcodes = carryRowValues(source.combos, source.barcodes, source.keys, combos, keys);
  const carriedFromSameCombination = isSameKeyList(source.keys, keys);
  const skus: string[] = [];
  const barcodes: string[] = [];
  combos.forEach((combo, i) => {
    const match = findSavedVariant(combo, savedVariants);
    skus.push(resolveRowCode(carriedSkus[i], carriedFromSameCombination, match?.sku));
    barcodes.push(resolveRowCode(carriedBarcodes[i], carriedFromSameCombination, match?.barcode));
  });
  const nextRows: GridRows = { combos, keys, skus, barcodes };
  const nextSnapshot = rowsShowSnapshot ? rows : snapshot;
  return { rows: nextRows, snapshot: isGridComplete(attributes) ? nextRows : nextSnapshot };
}

/**
 * Rewrites one value column (SKU or barcode) of the current rows, each row
 * computed against the SAME state's combination, so a code can only land on
 * the combination it was built for. The snapshot is left as is:
 * `resolveGridRows` adopts these edits at the next attribute change whenever
 * the rows still show the snapshot's grid.
 */
export function mapRowValues(
  state: GridState,
  field: RowValueField,
  fn: (combo: Record<string, string>, value: string, index: number) => string
): GridState {
  const current = state.rows[field];
  const next = state.rows.combos.map((combo, i) => fn(combo, current[i] ?? "", i));
  const rows: GridRows =
    field === "skus" ? { ...state.rows, skus: next } : { ...state.rows, barcodes: next };
  return { rows, snapshot: state.snapshot };
}

/** Sets one row's SKU or barcode — the single-cell case of `mapRowValues`. */
export function setRowValueAt(
  state: GridState,
  field: RowValueField,
  index: number,
  value: string
): GridState {
  return mapRowValues(state, field, (_combo, current, i) => (i === index ? value : current));
}
