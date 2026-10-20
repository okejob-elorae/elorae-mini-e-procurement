import { Decimal } from "decimal.js";
import {
  resolveVariantAxes,
  sizeMatchKey,
  type ColorIndex,
} from "@elorae/db/variant-axes";

/**
 * Colour/size-scoped BOM rules (#437). A rule with no colour and no size applies to every piece;
 * a scoped rule applies only to the pieces of the variants it covers, so planning one needs the
 * work order's variant mix. Rules of one material add up, and saveConsumptionRules refuses two
 * whose scopes overlap, so a piece never draws the same material twice.
 */
export type ScopedRule = {
  materialId: string;
  qtyRequired: Decimal.Value;
  wastePercent: Decimal.Value;
  colorId: string | null;
  size: string | null;
};

export type VariantShare = {
  variantSku: string;
  colorId: string | null;
  size: string | null;
  qty: Decimal;
};

/** The plan cannot be worked out from the BOM and variants as they are; the message says why. */
export class MaterialPlanBlockedError extends Error {}

export class ScopedBomNeedsVariantsError extends MaterialPlanBlockedError {
  constructor() {
    super("BOM ini punya aturan per warna/ukuran: pilih mode SKU dan rasio varian untuk menghitung bahannya");
    this.name = "ScopedBomNeedsVariantsError";
  }
}

export function isScopedRule(rule: Pick<ScopedRule, "colorId" | "size">): boolean {
  return rule.colorId != null || (rule.size != null && rule.size.trim() !== "");
}

function sizeOf(rule: Pick<ScopedRule, "size">): string | null {
  return rule.size != null && rule.size.trim() !== "" ? sizeMatchKey(rule.size) : null;
}

export function ruleCoversVariant(
  rule: Pick<ScopedRule, "colorId" | "size">,
  variant: Pick<VariantShare, "colorId" | "size">,
): boolean {
  if (rule.colorId != null && rule.colorId !== variant.colorId) return false;
  const size = sizeOf(rule);
  if (size != null && (variant.size == null || sizeMatchKey(variant.size) !== size)) return false;
  return true;
}

type SkuBreakdown =
  | { variantSku: string }
  | Array<{ variantSku: string; ratioPercent: number }>;

function share(variants: Array<Record<string, string>>, index: ColorIndex, variantSku: string, qty: Decimal): VariantShare {
  const row = variants.find((v) => (v.sku ?? "").trim() === variantSku.trim());
  const axes = row ? resolveVariantAxes(row, index) : { colorId: null, size: null };
  return { variantSku, colorId: axes.colorId, size: axes.size, qty };
}

/** The work order's pieces per variant, from its SKU breakdown; null when it has none (GENERIC). */
export function buildVariantMix(
  plannedOutput: Decimal,
  skuBreakdown: SkuBreakdown | null | undefined,
  variants: Array<Record<string, string>>,
  index: ColorIndex,
): VariantShare[] | null {
  if (skuBreakdown == null) return null;
  if (!Array.isArray(skuBreakdown)) {
    return [share(variants, index, skuBreakdown.variantSku, plannedOutput)];
  }
  return skuBreakdown.map((r) =>
    share(variants, index, r.variantSku, plannedOutput.mul(r.ratioPercent).div(100)),
  );
}

/** An even split over every variant — an estimate for callers with no ratio (production planning). */
export function equalVariantMix(
  plannedOutput: Decimal,
  variants: Array<Record<string, string>>,
  index: ColorIndex,
): VariantShare[] {
  const skus = variants.map((v) => (v.sku ?? "").trim()).filter(Boolean);
  if (skus.length === 0) return [];
  const each = plannedOutput.div(skus.length);
  return skus.map((sku) => share(variants, index, sku, each));
}

/** Variants in the mix that lack an axis some rule is scoped on, so scoped rules would miss them. */
export function unresolvedMixVariants(rules: ScopedRule[], mix: VariantShare[]): string[] {
  const needsColor = rules.some((r) => r.colorId != null);
  const needsSize = rules.some((r) => sizeOf(r) != null);
  return mix
    .filter((m) => (needsColor && m.colorId == null) || (needsSize && m.size == null))
    .map((m) => m.variantSku);
}

export type PlannedMaterial = { baseQty: Decimal; plannedQty: Decimal };

/**
 * Material quantities for `plannedOutput` pieces: base = pieces covered × qtyRequired, planned =
 * base × (1 + waste%). Keyed by material in rule order; a scoped rule no variant needs adds
 * nothing, and a material whose rules are all scoped and cover no piece is dropped.
 */
export function planMaterialQuantities(
  rules: ScopedRule[],
  plannedOutput: Decimal,
  mix: VariantShare[] | null,
): Map<string, PlannedMaterial> {
  if (mix == null && rules.some(isScopedRule)) throw new ScopedBomNeedsVariantsError();
  const out = new Map<string, PlannedMaterial>();
  const hasUnscoped = new Set<string>();
  for (const rule of rules) {
    if (!isScopedRule(rule)) hasUnscoped.add(rule.materialId);
    const pieces = isScopedRule(rule)
      ? (mix ?? []).filter((m) => ruleCoversVariant(rule, m)).reduce((s, m) => s.plus(m.qty), new Decimal(0))
      : plannedOutput;
    const base = pieces.mul(rule.qtyRequired);
    const planned = base.mul(new Decimal(1).plus(new Decimal(rule.wastePercent).div(100)));
    const prev = out.get(rule.materialId);
    out.set(rule.materialId, {
      baseQty: (prev?.baseQty ?? new Decimal(0)).plus(base),
      plannedQty: (prev?.plannedQty ?? new Decimal(0)).plus(planned),
    });
  }
  for (const [id, m] of out) if (!hasUnscoped.has(id) && m.baseQty.isZero()) out.delete(id);
  return out;
}

/**
 * The same quantities split by the colour of the pieces that draw them (#410), so a WO's rolls
 * can be picked per colour: material → colorId (null = a variant with no resolved colour) → qty.
 * Each colour's quantities add up to that material's line in planMaterialQuantities.
 */
export function planMaterialQuantitiesByColor(
  rules: ScopedRule[],
  mix: VariantShare[],
): Map<string, Map<string | null, PlannedMaterial>> {
  const groups = new Map<string | null, VariantShare[]>();
  for (const m of mix) groups.set(m.colorId, [...(groups.get(m.colorId) ?? []), m]);
  const out = new Map<string, Map<string | null, PlannedMaterial>>();
  for (const [colorId, group] of groups) {
    const pieces = group.reduce((s, m) => s.plus(m.qty), new Decimal(0));
    for (const [materialId, q] of planMaterialQuantities(rules, pieces, group)) {
      if (q.plannedQty.isZero()) continue;
      const byColor = out.get(materialId) ?? new Map<string | null, PlannedMaterial>();
      byColor.set(colorId, q);
      out.set(materialId, byColor);
    }
  }
  return out;
}

function scopesOverlap(a: ScopedRule, b: ScopedRule): boolean {
  if (a.colorId != null && b.colorId != null && a.colorId !== b.colorId) return false;
  const sa = sizeOf(a);
  const sb = sizeOf(b);
  if (sa != null && sb != null && sa !== sb) return false;
  return true;
}

/** Index pairs of rules on the same material whose scopes can both match one variant. */
export function findOverlappingRules(rules: ScopedRule[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (rules[i].materialId === rules[j].materialId && scopesOverlap(rules[i], rules[j])) pairs.push([i, j]);
    }
  }
  return pairs;
}
