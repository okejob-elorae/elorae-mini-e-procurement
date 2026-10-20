/**
 * Roll allocation per material (#437). A work order's `rollBreakdown` (and an issue's) names each
 * roll's material, so a colour-scoped BOM with one fabric per colour — or an accessory bought in
 * rolls — gets its own rolls. An entry without `itemId` predates this and belongs to the WO's
 * consumption material (`consumptionMaterialId`), the only material rolls were picked for then.
 */
export type RollEntry = {
  itemId?: string;
  /** The finished-good colour the roll is cut for (#410); null = variants without a resolved colour. */
  colorId?: string | null;
  rollRef: string;
  qty: number;
  notes?: string;
};

/**
 * One roll section of a WO: a material, and — when the WO has a variant mix — the finished-good
 * colour it is needed for (#410). Ops keep one fabric item per colour, so a roll's colour is its
 * item's; the section only says which finished-good colour the rolls are cut for. `colorId`
 * undefined = the material as a whole (GENERIC, or the issue page, which issues per material).
 */
export type RollNeed = {
  itemId: string;
  itemName: string;
  itemType?: string;
  uomCode?: string;
  colorId?: string | null;
  colorName?: string | null;
  qty: number;
};

type PlanLineForRolls = {
  itemId: string;
  itemName: string;
  itemType?: string;
  uomCode?: string;
  plannedQty: number;
  byColor?: Array<{ colorId: string | null; colorName: string | null; plannedQty: number }>;
};

/** Roll sections for a plan: one per colour share of each line, or one per line without a mix. */
export function rollNeedsFromPlan(lines: PlanLineForRolls[]): RollNeed[] {
  return lines.flatMap((l) => {
    const base = { itemId: l.itemId, itemName: l.itemName, itemType: l.itemType, uomCode: l.uomCode };
    return l.byColor && l.byColor.length > 0
      ? l.byColor.map((c) => ({ ...base, colorId: c.colorId, colorName: c.colorName, qty: c.plannedQty }))
      : [{ ...base, qty: l.plannedQty }];
  });
}

export function entryMatchesNeed(entry: RollEntry, need: Pick<RollNeed, "itemId" | "colorId">): boolean {
  if (entry.itemId !== need.itemId) return false;
  return need.colorId === undefined || (entry.colorId ?? null) === need.colorId;
}

/** Gives entries saved before #410 (no colour) their material's first colour section. */
export function withRollColors<T extends RollEntry & { itemId: string }>(entries: T[], needs: RollNeed[]): T[] {
  return entries.map((e) => {
    if (e.colorId !== undefined) return e;
    const need = needs.find((n) => n.itemId === e.itemId && n.colorId !== undefined);
    return need ? { ...e, colorId: need.colorId } : e;
  });
}

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

/**
 * Sections that have rolls allocated but fewer than they need; a section with no rolls is not
 * checked. A requirement without colorId covers all of its material's rolls (the issue page).
 */
export function rollShortfalls(
  required: Array<{ itemId: string; colorId?: string | null; qty: number }>,
  entries: Array<RollEntry & { itemId: string }>,
): Array<{ itemId: string; colorId?: string | null; required: number; allocated: number }> {
  const out: Array<{ itemId: string; colorId?: string | null; required: number; allocated: number }> = [];
  for (const r of required) {
    const mine = entries.filter((e) => entryMatchesNeed(e, r));
    if (mine.length === 0) continue;
    const allocated = mine.reduce((s, e) => s + e.qty, 0);
    if (allocated + EPSILON < r.qty) {
      out.push({ itemId: r.itemId, ...(r.colorId !== undefined ? { colorId: r.colorId } : {}), required: r.qty, allocated });
    }
  }
  return out;
}
