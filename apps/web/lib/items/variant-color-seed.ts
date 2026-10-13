import { colorMatchKey } from "@elorae/db/variant-axes";

/** Misspellings seen in the Jubelio catalogue (#437), mapped to the colour they mean. */
export const KNOWN_COLOR_TYPOS: Record<string, string> = {
  Cappucino: "Cappuccino",
  Cppuccino: "Cappuccino",
  Khaky: "Khaki",
};

/**
 * Groups variant colour texts into colour-master rows. Texts equal under colorMatchKey, or a
 * known typo and its target, form one colour named after the typo target or else the most used
 * spelling; the other spellings become aliases (case-only variants need none — they already
 * resolve). Sorted by name.
 */
export function groupColorLabels(
  counts: Map<string, number>,
  typos: Record<string, string> = KNOWN_COLOR_TYPOS,
): Array<{ name: string; aliases: string[] }> {
  const typoTarget = new Map(Object.entries(typos).map(([from, to]) => [colorMatchKey(from), to]));
  const groups = new Map<string, { forced: string | null; labels: Map<string, number> }>();
  for (const [label, count] of counts) {
    const target = typoTarget.get(colorMatchKey(label)) ?? null;
    const key = colorMatchKey(target ?? label);
    const g = groups.get(key) ?? { forced: null, labels: new Map<string, number>() };
    if (target) g.forced = target;
    g.labels.set(label, (g.labels.get(label) ?? 0) + count);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const byUse = [...g.labels].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const name = g.forced ?? byUse[0][0];
      const nameKey = colorMatchKey(name);
      const aliases = [...new Set(byUse.map(([l]) => l).filter((l) => colorMatchKey(l) !== nameKey))].sort();
      return { name, aliases };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
