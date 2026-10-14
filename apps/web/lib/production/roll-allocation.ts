/**
 * Roll allocation per material (#437). A work order's `rollBreakdown` (and an issue's) names each
 * roll's material, so a colour-scoped BOM with one fabric per colour — or an accessory bought in
 * rolls — gets its own rolls. An entry without `itemId` predates this and belongs to the WO's
 * consumption material (`consumptionMaterialId`), the only material rolls were picked for then.
 */
export type RollEntry = { itemId?: string; rollRef: string; qty: number; notes?: string };

const EPSILON = 1e-6;

/** Fills each entry's itemId, giving legacy entries to `legacyItemId`; drops them when it is null. */
export function withRollItemIds<T extends RollEntry>(
  entries: T[],
  legacyItemId: string | null,
): Array<T & { itemId: string }> {
  const out: Array<T & { itemId: string }> = [];
  for (const e of entries) {
    const itemId = e.itemId || legacyItemId;
    if (itemId) out.push({ ...e, itemId });
  }
  return out;
}

export function rollsForItem<T extends RollEntry>(entries: T[], itemId: string, legacyItemId: string | null): T[] {
  return entries.filter((e) => (e.itemId || legacyItemId) === itemId);
}

/** Materials that have rolls allocated but fewer than they need; a material with no rolls is not checked. */
export function rollShortfalls(
  required: Array<{ itemId: string; qty: number }>,
  entries: Array<RollEntry & { itemId: string }>,
): Array<{ itemId: string; required: number; allocated: number }> {
  const out: Array<{ itemId: string; required: number; allocated: number }> = [];
  for (const r of required) {
    const mine = entries.filter((e) => e.itemId === r.itemId);
    if (mine.length === 0) continue;
    const allocated = mine.reduce((s, e) => s + e.qty, 0);
    if (allocated + EPSILON < r.qty) out.push({ itemId: r.itemId, required: r.qty, allocated });
  }
  return out;
}
