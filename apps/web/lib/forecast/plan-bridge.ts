export const PLAN_TOLERANCE_PERCENT = 5;

export interface CategoryGroupable {
  itemCategoryId: string | null;
}

export interface PlanBridgeChild {
  id: string;
  itemId: string | null;
  parentSharePercent: number;
  code?: string | null;
}

export interface PlanBridgeRoot {
  id: string;
  targetQty: number | null;
}

export interface SelectedApplyItem {
  itemId: string;
  parentSku: string;
  adjustedQty: number;
  action: "CREATE" | "UPDATE" | "SKIP";
  code: string;
  name: string;
}

export interface ChildUpsertPlan {
  itemId: string;
  parentSku: string;
  parentSharePercent: number;
  action: "CREATE" | "UPDATE";
  existingChildId: string | null;
  code: string;
  name: string;
}

export interface CategoryApplyPlan {
  itemCategoryId: string;
  parentTargetQty: number;
  parentAction: "CREATE" | "UPDATE";
  existingParentId: string | null;
  childUpserts: ChildUpsertPlan[];
  skipped: boolean;
  error?: string;
}

export function groupSuggestionsByCategory<T extends CategoryGroupable>(
  suggestions: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of suggestions) {
    if (!item.itemCategoryId) continue;
    const list = grouped.get(item.itemCategoryId) ?? [];
    list.push(item);
    grouped.set(item.itemCategoryId, list);
  }
  return grouped;
}

export function computeCategoryTotalQty(
  items: Array<{ adjustedQty: number }>
): number {
  return items.reduce((sum, item) => sum + Math.round(item.adjustedQty), 0);
}

export function computeForecastChildShares(
  quantities: number[],
  sharePool: number
): number[] {
  if (quantities.length === 0) return [];
  if (sharePool <= 0) return quantities.map(() => 0);

  const totalQty = quantities.reduce((sum, q) => sum + q, 0);
  if (totalQty === 0) {
    const even = Math.floor((sharePool / quantities.length) * 100) / 100;
    const shares = quantities.map(() => even);
    const remainder = Math.round((sharePool - even * quantities.length) * 100) / 100;
    if (shares.length > 0) {
      shares[shares.length - 1] =
        Math.round((shares[shares.length - 1]! + remainder) * 100) / 100;
    }
    return shares;
  }

  const shares: number[] = [];
  let allocated = 0;
  for (let i = 0; i < quantities.length; i++) {
    if (i === quantities.length - 1) {
      shares.push(Math.round((sharePool - allocated) * 100) / 100);
    } else {
      const raw = (quantities[i]! / totalQty) * sharePool;
      const rounded = Math.round(raw * 100) / 100;
      shares.push(rounded);
      allocated += rounded;
    }
  }
  return shares;
}

export function computeManualSharePercent(
  children: PlanBridgeChild[],
  selectedItemIds: Set<string>
): number {
  return children
    .filter((child) => child.itemId != null && !selectedItemIds.has(child.itemId))
    .reduce((sum, child) => sum + child.parentSharePercent, 0);
}

export function suggestItemAction(
  forecastQty: number,
  existingEffectiveQty: number | null,
  tolerancePct: number = PLAN_TOLERANCE_PERCENT
): "CREATE" | "UPDATE" | "SKIP" {
  if (existingEffectiveQty == null) return "CREATE";
  if (existingEffectiveQty === 0) return "UPDATE";
  const deltaPct =
    (Math.abs(forecastQty - existingEffectiveQty) / existingEffectiveQty) * 100;
  return deltaPct <= tolerancePct ? "SKIP" : "UPDATE";
}

export function buildCategoryApplyPlan(input: {
  itemCategoryId: string;
  selectedItems: SelectedApplyItem[];
  existingRoot: PlanBridgeRoot | null;
  existingChildren: PlanBridgeChild[];
}): CategoryApplyPlan {
  const { itemCategoryId, selectedItems, existingRoot, existingChildren } =
    input;

  const applicable = selectedItems.filter(
    (item) => item.action !== "SKIP" && item.adjustedQty > 0
  );
  const parentTargetQty = computeCategoryTotalQty(applicable);

  if (parentTargetQty === 0) {
    return {
      itemCategoryId,
      parentTargetQty: 0,
      parentAction: existingRoot ? "UPDATE" : "CREATE",
      existingParentId: existingRoot?.id ?? null,
      childUpserts: [],
      skipped: true,
      error: "Category total is zero; skipped",
    };
  }

  const selectedItemIds = new Set(applicable.map((item) => item.itemId));
  const manualShare = computeManualSharePercent(
    existingChildren,
    selectedItemIds
  );

  if (manualShare >= 100) {
    return {
      itemCategoryId,
      parentTargetQty,
      parentAction: existingRoot ? "UPDATE" : "CREATE",
      existingParentId: existingRoot?.id ?? null,
      childUpserts: [],
      skipped: true,
      error: "Manual children consume 100% share; category skipped",
    };
  }

  const sharePool = 100 - manualShare;
  const quantities = applicable.map((item) => item.adjustedQty);
  const shares = computeForecastChildShares(quantities, sharePool);

  const childByItemId = new Map(
    existingChildren
      .filter((c) => c.itemId != null)
      .map((c) => [c.itemId!, c])
  );

  const usedCodes = new Set(
    existingChildren
      .map((c) => c.code?.trim())
      .filter((code): code is string => Boolean(code))
  );

  const childUpserts: ChildUpsertPlan[] = applicable.map((item, index) => {
    const existingChild = childByItemId.get(item.itemId) ?? null;
    let code = item.code;
    if (usedCodes.has(code)) {
      code = `${item.code}-${item.itemId.slice(-4)}`;
    }
    usedCodes.add(code);

    return {
      itemId: item.itemId,
      parentSku: item.parentSku,
      parentSharePercent: shares[index] ?? 0,
      action: existingChild ? "UPDATE" : "CREATE",
      existingChildId: existingChild?.id ?? null,
      code,
      name: item.name,
    };
  });

  return {
    itemCategoryId,
    parentTargetQty,
    parentAction: existingRoot ? "UPDATE" : "CREATE",
    existingParentId: existingRoot?.id ?? null,
    childUpserts,
    skipped: false,
  };
}
