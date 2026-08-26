/**
 * Stable hues for content categories — supplier types, item types, channels.
 *
 * Measured on the suppliers page before this existed: 98% of 288 coloured
 * elements sat inside a single 30-degree slice of the colour wheel. The cause
 * was `<Badge variant="default">`, which is `bg-primary`, so "Fabric",
 * "Accessories" and "Tailor/Production" all rendered in the same accent. Three
 * categories, one colour — the badge carried no information the text did not
 * already give.
 *
 * These eight tones are deliberately NOT derived from the Pantone accent. The
 * accent identifies the product; these identify the data. If they moved
 * together, changing the theme would rewrite what every badge means.
 *
 * Kept clear of the semantic set as far as possible: green means settled and
 * red means broken elsewhere in the app, so neither appears here.
 */
export const CATEGORY_TONES = [
  'bg-sky-500/12 text-sky-700 ring-sky-600/25 dark:text-sky-300 dark:ring-sky-400/25',
  'bg-violet-500/12 text-violet-700 ring-violet-600/25 dark:text-violet-300 dark:ring-violet-400/25',
  'bg-orange-500/12 text-orange-700 ring-orange-600/25 dark:text-orange-300 dark:ring-orange-400/25',
  'bg-cyan-500/12 text-cyan-700 ring-cyan-600/25 dark:text-cyan-300 dark:ring-cyan-400/25',
  'bg-fuchsia-500/12 text-fuchsia-700 ring-fuchsia-600/25 dark:text-fuchsia-300 dark:ring-fuchsia-400/25',
  'bg-indigo-500/12 text-indigo-700 ring-indigo-600/25 dark:text-indigo-300 dark:ring-indigo-400/25',
  'bg-teal-500/12 text-teal-700 ring-teal-600/25 dark:text-teal-300 dark:ring-teal-400/25',
  'bg-rose-500/12 text-rose-700 ring-rose-600/25 dark:text-rose-300 dark:ring-rose-400/25',
] as const;

/**
 * Well-known categories get a fixed slot so they never move between releases —
 * an operator learns "blue means fabric" and that has to stay true. Anything
 * user-created (supplier types are DB rows) falls through to the hash below.
 */
const PINNED: Record<string, number> = {
  fabric: 0,
  kain: 0,
  accessories: 2,
  aksesoris: 2,
  'tailor/production': 1,
  tailor: 1,
  penjahit: 1,
  cmt: 1,
  'finished good': 4,
  'barang jadi': 4,
  other: 5,
  lainnya: 5,
};

/**
 * Deterministic, so the same category is the same colour on every screen and
 * across reloads — a category whose colour changes per render is worse than no
 * colour at all.
 */
function hashSlot(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % CATEGORY_TONES.length;
}

export function categoryToneClass(label: string | null | undefined): string {
  if (!label) return 'bg-muted text-muted-foreground ring-border';
  const key = label.trim().toLowerCase();
  const slot = PINNED[key] ?? hashSlot(key);
  return CATEGORY_TONES[slot];
}
