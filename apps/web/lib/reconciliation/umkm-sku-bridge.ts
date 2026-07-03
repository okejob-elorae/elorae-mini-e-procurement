import type { PrismaClient } from "@elorae/db";

export const EXCEL_SIZE_KEYS = ["S", "M", "L", "XL"] as const;
export type ExcelSizeKey = (typeof EXCEL_SIZE_KEYS)[number];

export type SizeQtyMap = Record<ExcelSizeKey, number>;

const ERP_SIZE_SUFFIXES = ["-XXL", "-XL", "-XS", "-L", "-M", "-S"] as const;

export type ErpVariantRef = {
  erpVariantSku: string;
  jubelioItemCode: string;
  jubelioItemId: number;
  itemId: string;
  parentItemSku: string;
  itemName: string;
  sizeSuffix: string | null;
};

export type ErpVariantIndex = {
  byErpVariantSku: Map<string, ErpVariantRef>;
  byParentKode: Map<string, ErpVariantRef[]>;
  byJubelioItemCode: Map<string, ErpVariantRef>;
};

export type NormalizedOtherSourceSku = {
  parentKode: string;
  size: string;
  erpVariantSku: string;
};

const EMBEDDED_SIZE_SUFFIXES = ["XXL", "XL", "XS", "L", "M", "S"] as const;

export function extractParentFromVariantSku(variantSku: string): {
  parent: string;
  sizeSuffix: string | null;
} {
  const trimmed = variantSku.trim();
  for (const suffix of ERP_SIZE_SUFFIXES) {
    if (trimmed.endsWith(suffix)) {
      return {
        parent: trimmed.slice(0, -suffix.length),
        sizeSuffix: suffix.slice(1).toUpperCase(),
      };
    }
  }
  return { parent: trimmed, sizeSuffix: null };
}

export function excelSizeToErpVariantSku(parentKode: string, size: ExcelSizeKey): string {
  return `${parentKode.trim()}-${size}`;
}

export function buildErpVariantIndex(rows: ErpVariantRef[]): ErpVariantIndex {
  const byErpVariantSku = new Map<string, ErpVariantRef>();
  const byParentKode = new Map<string, ErpVariantRef[]>();
  const byJubelioItemCode = new Map<string, ErpVariantRef>();

  for (const row of rows) {
    const sku = row.erpVariantSku.trim();
    if (!sku) continue;

    byErpVariantSku.set(sku, row);
    if (row.jubelioItemCode.trim()) {
      byJubelioItemCode.set(row.jubelioItemCode.trim(), row);
    }

    const { parent } = extractParentFromVariantSku(sku);
    const list = byParentKode.get(parent) ?? [];
    list.push(row);
    byParentKode.set(parent, list);
  }

  for (const list of byParentKode.values()) {
    list.sort((a, b) => a.erpVariantSku.localeCompare(b.erpVariantSku));
  }

  return { byErpVariantSku, byParentKode, byJubelioItemCode };
}

function isExcelSizeKey(size: string): size is ExcelSizeKey {
  return (EXCEL_SIZE_KEYS as readonly string[]).includes(size);
}

function resolveFsVariant(
  index: ErpVariantIndex,
  parentKode: string,
): NormalizedOtherSourceSku | null {
  const siblings = listErpVariantsForParent(index, parentKode);
  if (siblings.length === 1) {
    const ref = siblings[0]!;
    return {
      parentKode,
      size: ref.sizeSuffix ?? "FS",
      erpVariantSku: ref.erpVariantSku,
    };
  }

  const parentOnly = index.byErpVariantSku.get(parentKode);
  if (parentOnly) {
    return {
      parentKode,
      size: parentOnly.sizeSuffix ?? "FS",
      erpVariantSku: parentOnly.erpVariantSku,
    };
  }

  return null;
}

function tryEmbeddedSizeSuffix(rawSku: string): { parent: string; size: string } | null {
  for (const suffix of EMBEDDED_SIZE_SUFFIXES) {
    if (rawSku.endsWith(suffix) && rawSku.length > suffix.length) {
      const parent = rawSku.slice(0, -suffix.length);
      if (parent.length > 0) {
        return { parent, size: suffix };
      }
    }
  }
  return null;
}

function lookupSkuInIndex(
  index: ErpVariantIndex,
  rawSku: string,
): NormalizedOtherSourceSku | null {
  const direct = index.byErpVariantSku.get(rawSku);
  if (direct) {
    const { parent, sizeSuffix } = extractParentFromVariantSku(direct.erpVariantSku);
    return {
      parentKode: parent,
      size: sizeSuffix ?? "FS",
      erpVariantSku: direct.erpVariantSku,
    };
  }

  const byCode = index.byJubelioItemCode.get(rawSku);
  if (byCode) {
    const { parent, sizeSuffix } = extractParentFromVariantSku(byCode.erpVariantSku);
    return {
      parentKode: parent,
      size: sizeSuffix ?? "FS",
      erpVariantSku: byCode.erpVariantSku,
    };
  }

  return null;
}

export function normalizeOtherSourceSku(
  rawSku: string,
  rawSize: string,
  index: ErpVariantIndex,
): NormalizedOtherSourceSku | null {
  const sku = rawSku.trim();
  if (!sku) return null;

  const sizeUpper = rawSize.trim().toUpperCase();

  const dashed = extractParentFromVariantSku(sku);
  if (dashed.sizeSuffix) {
    return {
      parentKode: dashed.parent,
      size: dashed.sizeSuffix,
      erpVariantSku: sku,
    };
  }

  const indexed = lookupSkuInIndex(index, sku);
  if (indexed) return indexed;

  const lastChar = sku.slice(-1).toUpperCase();
  if (isExcelSizeKey(lastChar) && resolveErpVariant(index, sku, lastChar)) {
    return {
      parentKode: sku,
      size: lastChar,
      erpVariantSku: excelSizeToErpVariantSku(sku, lastChar),
    };
  }

  if (sizeUpper === "FS") {
    return resolveFsVariant(index, sku);
  }

  if (isExcelSizeKey(sizeUpper)) {
    const expected = excelSizeToErpVariantSku(sku, sizeUpper);
    if (index.byErpVariantSku.has(expected)) {
      return { parentKode: sku, size: sizeUpper, erpVariantSku: expected };
    }
    if (resolveErpVariant(index, sku, sizeUpper)) {
      return { parentKode: sku, size: sizeUpper, erpVariantSku: expected };
    }
  }

  const embedded = tryEmbeddedSizeSuffix(sku);
  if (embedded) {
    const expected = excelSizeToErpVariantSku(
      embedded.parent,
      embedded.size as ExcelSizeKey,
    );
    if (
      index.byErpVariantSku.has(expected) ||
      resolveErpVariant(index, embedded.parent, embedded.size as ExcelSizeKey)
    ) {
      return {
        parentKode: embedded.parent,
        size: embedded.size,
        erpVariantSku: expected,
      };
    }
    const embeddedIndexed = lookupSkuInIndex(index, sku);
    if (embeddedIndexed) return embeddedIndexed;
  }

  if (!sizeUpper && /^\d+$/.test(sku)) {
    return lookupSkuInIndex(index, sku);
  }

  if (isExcelSizeKey(sizeUpper)) {
    return {
      parentKode: sku,
      size: sizeUpper,
      erpVariantSku: excelSizeToErpVariantSku(sku, sizeUpper),
    };
  }

  return null;
}

export function listErpVariantsForParent(
  index: ErpVariantIndex,
  parentKode: string,
): ErpVariantRef[] {
  return index.byParentKode.get(parentKode.trim()) ?? [];
}

export function resolveErpVariant(
  index: ErpVariantIndex,
  parentKode: string,
  size: ExcelSizeKey,
): ErpVariantRef | null {
  const expected = excelSizeToErpVariantSku(parentKode, size);
  const direct = index.byErpVariantSku.get(expected);
  if (direct) return direct;

  const siblings = listErpVariantsForParent(index, parentKode);
  return siblings.find((v) => v.sizeSuffix === size) ?? null;
}

/** Split parent-level marketplace sales across sizes by excel mix (largest remainder). */
export function allocateParentSalesToSizes(
  parentSalesTotal: number,
  sizes: SizeQtyMap,
): SizeQtyMap {
  const result: SizeQtyMap = { S: 0, M: 0, L: 0, XL: 0 };
  if (parentSalesTotal <= 0) return result;

  const excelTotal = EXCEL_SIZE_KEYS.reduce((sum, k) => sum + sizes[k], 0);
  if (excelTotal <= 0) {
    return result;
  }

  const raw = EXCEL_SIZE_KEYS.map((k) => ({
    key: k,
    exact: (parentSalesTotal * sizes[k]) / excelTotal,
  }));

  let assigned = 0;
  const remainders = raw.map((r) => {
    const floor = Math.floor(r.exact);
    assigned += floor;
    return { key: r.key, floor, remainder: r.exact - floor };
  });

  let leftover = parentSalesTotal - assigned;
  remainders.sort((a, b) => b.remainder - a.remainder);
  for (const row of remainders) {
    if (leftover <= 0) break;
    row.floor += 1;
    leftover -= 1;
  }

  for (const row of remainders) {
    result[row.key] = row.floor;
  }

  return result;
}

export async function loadJubelioVariantIndex(prisma: PrismaClient): Promise<ErpVariantIndex> {
  const mappings = await prisma.jubelioProductMapping.findMany({
    select: {
      erpVariantSku: true,
      jubelioItemCode: true,
      jubelioItemId: true,
      itemId: true,
      item: { select: { sku: true, nameId: true } },
    },
  });

  return buildErpVariantIndex(
    mappings.map((m) => {
      const { sizeSuffix } = extractParentFromVariantSku(m.erpVariantSku);
      return {
        erpVariantSku: m.erpVariantSku,
        jubelioItemCode: m.jubelioItemCode,
        jubelioItemId: m.jubelioItemId,
        itemId: m.itemId,
        parentItemSku: m.item.sku,
        itemName: m.item.nameId,
        sizeSuffix,
      };
    }),
  );
}
