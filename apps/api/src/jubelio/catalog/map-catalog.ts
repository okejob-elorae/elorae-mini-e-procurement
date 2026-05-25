import { Prisma } from "@elorae/db";
import {
  isVariantlessItemCode,
  parseParentSku,
  parseVariantSku,
} from "./parse-item-code";
import type {
  CatalogItemDraft,
  JubelioItemGroup,
  JubelioItemsPayload,
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
  return variant;
}

function toSellingPriceString(sellPrice: string | number | undefined): string | null {
  if (sellPrice === undefined || sellPrice === null || sellPrice === "") return null;
  return String(sellPrice);
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
        },
        variants: [],
        familyCode: "",
      };
      byGroup.set(group.item_group_id, acc);
    }

    for (const variant of group.variants ?? []) {
      if (variant.is_bundle) {
        warnings.push(`Skipped bundle variant ${variant.item_code} (group ${group.item_group_id})`);
        continue;
      }

      const code = variant.item_code?.trim();
      if (!code) {
        warnings.push(`Empty item_code in group ${group.item_group_id}`);
        continue;
      }

      const family = parseParentSku(code);
      if (!family) {
        warnings.push(`Could not derive parent SKU for ${code}`);
        continue;
      }

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

    const jubelioCategoryId = acc.meta.item_category_id;
    const categoryId =
      jubelioCategoryId != null ? (opts?.categoryIdByJubelioId?.get(jubelioCategoryId) ?? null) : null;

    drafts.push({
      parentSku: acc.familyCode,
      itemSku,
      nameId: acc.meta.item_name,
      nameEn: acc.meta.item_name,
      description: acc.meta.description ? stripHtml(acc.meta.description) : undefined,
      sellingPrice: toSellingPriceString(acc.meta.sell_price),
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
    });
  }

  drafts.sort((a, b) => a.itemSku.localeCompare(b.itemSku));
  return { drafts, warnings };
}

export function sellingPriceToDecimal(value: string | null): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  return new Prisma.Decimal(value);
}
