/**
 * Finished-good variants have exactly two axes, colour and size (#437). `Item.variants` stores
 * them under the keys `Warna` and `Ukuran` — the labels most Jubelio products already use — and
 * every other spelling (`color`, `Size`, …) is folded onto those keys on ingest. A variant's
 * colour text is resolved to a `VariantColor` row by name or alias under `colorMatchKey`; the
 * text itself is never rewritten, so it keeps matching what Jubelio shows.
 */

export const COLOR_AXIS_KEY = "Warna";
export const SIZE_AXIS_KEY = "Ukuran";

const COLOR_KEY_SPELLINGS = new Set(["warna", "color", "colour"]);
const SIZE_KEY_SPELLINGS = new Set(["ukuran", "size"]);

/** `Warna` or `Ukuran` when the key is one of that axis's spellings, else null. */
export function canonicalAxisKey(key: string): string | null {
  const k = key.trim().toLowerCase();
  if (COLOR_KEY_SPELLINGS.has(k)) return COLOR_AXIS_KEY;
  if (SIZE_KEY_SPELLINGS.has(k)) return SIZE_AXIS_KEY;
  return null;
}

/** Renames colour/size label spellings to `Warna`/`Ukuran`; an existing canonical key wins. */
export function normalizeVariantAxisKeys<T extends Record<string, string>>(variant: T): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(variant)) {
    const canonical = canonicalAxisKey(key);
    if (canonical === null) {
      out[key] = value;
    } else if (key === canonical || !(canonical in variant)) {
      if (!(canonical in out)) out[canonical] = value;
    }
  }
  return out;
}

/** Comparison key for colour names and aliases: case, spacing and punctuation are ignored. */
export function colorMatchKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Comparison key for size text (`all size` = `ALL SIZE` = `AllSize`). */
export function sizeMatchKey(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type ColorIndexEntry = { id: string; name: string; aliases: string[] };
export type ColorIndex = Map<string, string>;

/** matchKey → colour id, from each colour's name and aliases. A key claimed twice keeps the first. */
export function buildColorIndex(colors: ColorIndexEntry[]): ColorIndex {
  const index: ColorIndex = new Map();
  for (const c of colors) {
    for (const text of [c.name, ...c.aliases]) {
      const key = colorMatchKey(text);
      if (key && !index.has(key)) index.set(key, c.id);
    }
  }
  return index;
}

export type VariantAxes = { colorId: string | null; colorLabel: string | null; size: string | null };

function axisValue(variant: Record<string, string>, canonical: string): string | null {
  for (const [key, value] of Object.entries(variant)) {
    if (canonicalAxisKey(key) === canonical && value != null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

/** The variant's colour (resolved against the master) and size; null where an axis is missing. */
export function resolveVariantAxes(variant: Record<string, string>, index: ColorIndex): VariantAxes {
  const normalized = normalizeVariantAxisKeys(variant);
  const colorLabel = axisValue(normalized, COLOR_AXIS_KEY);
  const size = axisValue(normalized, SIZE_AXIS_KEY);
  const colorId = colorLabel ? index.get(colorMatchKey(colorLabel)) ?? null : null;
  return { colorId, colorLabel, size };
}
