import { Prisma, normalizeVariantAxisKeys } from "@elorae/db";
import {
  isVariantlessItemCode,
  parseParentSku,
  parseVariantSku,
} from "./parse-item-code";
import type {
  CatalogItemDraft,
  JubelioItemGroup,
  JubelioItemsPayload,
  JubelioRawImage,
  JubelioRawVariantImages,
  JubelioVariantRow,
  VariantJson,
} from "./catalog.types";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mapVariationValues(row: JubelioVariantRow): VariantJson {
  const code = row.item_code.trim();
  const variant: VariantJson = { sku: parseVariantSku(code) };
  for (const vv of row.variation_values ?? []) {
    if (vv.label && vv.value != null && vv.value !== "") {
      variant[vv.label] = String(vv.value);
    }
  }
  const barcode = row.barcode?.trim();
  if (barcode) variant.barcode = barcode;
  // Variants have exactly two axes (#437): `color`/`Size`/… are stored as Warna/Ukuran.
  return normalizeVariantAxisKeys(variant) as VariantJson;
}

/** A Jubelio price as read: undefined/null/""/unreadable is UNKNOWN (null), never 0. */
function readJubelioPrice(value: string | number | null | undefined): Prisma.Decimal | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  try {
    const d = new Prisma.Decimal(typeof value === "string" ? value.trim() : value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * What Jubelio shows for one article (owner answer P1, 2026-11-02: one price per article; when the
 * variants differ, the HIGHEST is the Jubelio price).
 *
 * - A variant whose sell_price is missing or unreadable is UNKNOWN and skipped — never read as 0.
 * - An explicit number of 0 or less means that variant has "no price".
 * - highest = the highest positive variant price, or null when none is positive.
 * - lowest = the lowest known variant price, or "0" when any known variant has no price.
 * - When every variant is unknown, the group sell_price stands in for both, read the same way.
 * - When that is unknown too, nothing is known: null, and no observation is recorded.
 */
export function summarizeJubelioPrices(
  variants: ReadonlyArray<Pick<JubelioVariantRow, "sell_price">>,
  groupSellPrice: string | number | null | undefined,
): { highest: string | null; lowest: string } | null {
  let known = variants.map((v) => readJubelioPrice(v.sell_price)).filter((d): d is Prisma.Decimal => d !== null);
  if (known.length === 0) {
    const group = readJubelioPrice(groupSellPrice);
    known = group ? [group] : [];
  }
  if (known.length === 0) return null;
  const positive = known.filter((d) => d.greaterThan(0));
  const highest = positive.length > 0 ? positive.reduce((a, b) => (b.greaterThan(a) ? b : a)) : null;
  const lowest =
    positive.length < known.length ? "0" : positive.reduce((a, b) => (b.lessThan(a) ? b : a)).toString();
  return { highest: highest ? highest.toString() : null, lowest };
}

/**
 * How the ERP reads one variant of a Jubelio group: a bundle is skipped, and so is a variant
 * without an item_code or one whose item_code yields no family code; otherwise its trimmed code and
 * family. ONE rule for the three places that read Jubelio's catalog — the catalog ingest
 * (`buildCatalogDrafts`), the price observer and the product push's read-before-write
 * (`summarizeGroupsPrice`) — because a price read over a different set of variants than another
 * reading would move `jubelioObservedChangedAt` on every alternate read and cancel every price
 * decision (P75): the item would be held forever.
 */
export function readCatalogVariant(
  variant: JubelioVariantRow,
  groupId: number,
): { ok: true; code: string; family: string } | { ok: false; warning: string } {
  if (variant.is_bundle) return { ok: false, warning: `Skipped bundle variant ${variant.item_code} (group ${groupId})` };
  const code = variant.item_code?.trim();
  if (!code) return { ok: false, warning: `Empty item_code in group ${groupId}` };
  const family = parseParentSku(code);
  if (!family) return { ok: false, warning: `Could not derive parent SKU for ${code}` };
  return { ok: true, code, family };
}

/**
 * What Jubelio shows for an item, read from the catalog list rows of its group(s): the variants
 * `readCatalogVariant` accepts, one per item_id with its LAST listing winning (exactly as
 * `buildCatalogDrafts` keeps them), summarized by `summarizeJubelioPrices` with the first listed
 * group's sell_price as the fallback. Null when none of the groups is listed or none of their
 * variants is read — the ingest builds no item for such a group either, so nothing is recorded.
 *
 * Used by the price observer and the product push for an item, and equal to the price
 * `buildCatalogDrafts` puts on that group's draft (map-catalog.spec.ts pins the agreement).
 */
export function summarizeGroupsPrice(
  groups: ReadonlyArray<Pick<JubelioItemGroup, "item_group_id" | "sell_price" | "variants">>,
  groupIds: ReadonlySet<number>,
): { highest: string | null; lowest: string } | null {
  let groupSellPrice: string | number | undefined;
  let listed = false;
  const variants = new Map<number, JubelioVariantRow>();
  for (const group of groups) {
    if (!groupIds.has(group.item_group_id)) continue;
    if (!listed) {
      groupSellPrice = group.sell_price;
      listed = true;
    }
    for (const variant of group.variants ?? []) {
      if (!readCatalogVariant(variant, group.item_group_id).ok) continue;
      variants.set(variant.item_id, variant);
    }
  }
  if (variants.size === 0) return null;
  return summarizeJubelioPrices([...variants.values()], groupSellPrice);
}

function dedupeVariantsBySku(variants: VariantJson[]): VariantJson[] {
  const map = new Map<string, VariantJson>();
  for (const v of variants) {
    if (!v.sku) continue;
    map.set(v.sku.toLowerCase(), v);
  }
  return Array.from(map.values());
}

function parseLastModified(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

type GroupMeta = {
  item_group_id: number;
  item_name: string;
  item_category_id?: number;
  sell_price?: string | number;
  last_modified?: string;
  description?: string;
  images?: JubelioRawImage[];
  variation_images?: JubelioRawVariantImages[];
};

export function resolveItemSku(familyCode: string, itemGroupId: number, familyGroupCount: number): string {
  if (familyGroupCount <= 1) return familyCode;
  return `${familyCode}-G${itemGroupId}`;
}

export function buildCatalogDrafts(
  payload: JubelioItemsPayload,
  opts?: {
    itemGroupIds?: number[];
    descriptionsByGroupId?: Map<number, string>;
    categoryIdByJubelioId?: Map<number, string>;
  },
): { drafts: CatalogItemDraft[]; warnings: string[] } {
  const warnings: string[] = [];
  const filterIds = opts?.itemGroupIds?.length ? new Set(opts.itemGroupIds) : null;

  type Acc = {
    meta: GroupMeta;
    variants: JubelioVariantRow[];
    familyCode: string;
  };

  const byGroup = new Map<number, Acc>();
  const familyGroupCounts = new Map<string, number>();

  for (const group of payload.data) {
    if (filterIds && !filterIds.has(group.item_group_id)) continue;

    let acc = byGroup.get(group.item_group_id);
    if (!acc) {
      acc = {
        meta: {
          item_group_id: group.item_group_id,
          item_name: group.item_name,
          item_category_id: group.item_category_id,
          sell_price: group.sell_price,
          last_modified: group.last_modified,
          description: opts?.descriptionsByGroupId?.get(group.item_group_id),
          images: group.images,
          variation_images: group.variation_images,
        },
        variants: [],
        familyCode: "",
      };
      byGroup.set(group.item_group_id, acc);
    }

    for (const variant of group.variants ?? []) {
      const read = readCatalogVariant(variant, group.item_group_id);
      if (!read.ok) {
        warnings.push(read.warning);
        continue;
      }
      const { code, family } = read;

      if (!acc.familyCode) {
        acc.familyCode = family;
      } else if (acc.familyCode !== family) {
        warnings.push(`Group ${group.item_group_id}: mixed families ${acc.familyCode} and ${family} in ${code}`);
      }

      const existingIdx = acc.variants.findIndex((v) => v.item_id === variant.item_id);
      if (existingIdx >= 0) {
        acc.variants[existingIdx] = variant;
      } else {
        acc.variants.push(variant);
      }
    }
  }

  for (const acc of byGroup.values()) {
    if (acc.familyCode) {
      familyGroupCounts.set(acc.familyCode, (familyGroupCounts.get(acc.familyCode) ?? 0) + 1);
    }
  }

  const drafts: CatalogItemDraft[] = [];

  for (const acc of byGroup.values()) {
    if (!acc.variants.length || !acc.familyCode) continue;

    const itemSku = resolveItemSku(
      acc.familyCode,
      acc.meta.item_group_id,
      familyGroupCounts.get(acc.familyCode) ?? 1,
    );
    const variantless = acc.variants.length === 1 && isVariantlessItemCode(acc.variants[0].item_code);

    const variantJsonList: VariantJson[] = variantless
      ? []
      : dedupeVariantsBySku(acc.variants.map(mapVariationValues));

    /* Same variants and fallback as `summarizeGroupsPrice` over this one group (pinned by the spec). */
    const price = summarizeJubelioPrices(acc.variants, acc.meta.sell_price);

    const jubelioCategoryId = acc.meta.item_category_id;
    const categoryId =
      jubelioCategoryId != null ? (opts?.categoryIdByJubelioId?.get(jubelioCategoryId) ?? null) : null;

    drafts.push({
      parentSku: acc.familyCode,
      itemSku,
      nameId: acc.meta.item_name,
      nameEn: acc.meta.item_name,
      description: acc.meta.description ? stripHtml(acc.meta.description) : undefined,
      sellingPrice: price?.highest ?? null,
      lowestPrice: price?.lowest ?? null,
      priceKnown: price !== null,
      categoryId,
      jubelioItemGroupId: acc.meta.item_group_id,
      jubelioLastModified: parseLastModified(acc.meta.last_modified),
      variants: variantJsonList,
      variantless,
      sourceVariants: acc.variants.map((v) => {
        const jubelioItemCode = v.item_code.trim();
        return {
          jubelioItemId: v.item_id,
          jubelioItemCode,
          jubelioItemGroupId: v.item_group_id,
          erpVariantSku: parseVariantSku(jubelioItemCode),
        };
      }),
      rawImages: acc.meta.images ?? [],
      rawVariantImages: acc.meta.variation_images ?? [],
    });
  }

  drafts.sort((a, b) => a.itemSku.localeCompare(b.itemSku));
  return { drafts, warnings };
}

export function sellingPriceToDecimal(value: string | null): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  return new Prisma.Decimal(value);
}
