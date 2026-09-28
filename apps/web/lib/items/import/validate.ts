import { validateAndNormalizeVariants } from "@/lib/items/normalize-variants";
import {
  ITEM_IMPORT_MAX_LENGTH,
  ITEM_IMPORT_MAX_ROWS,
  importError,
  type ItemImportColumnKey,
  type ItemImportError,
  type ItemImportPlan,
  type ItemImportPlannedItem,
  type ItemImportPreviewItem,
  type ItemImportPreviewVariant,
  type ItemImportRow,
  type ItemImportValidatedResult,
} from "./types";

export type ItemImportLookups = {
  uoms: Array<{ id: string; code: string }>;
  categories: Array<{ id: string; code: string | null; name: string }>;
  /* All three hold `trim().toLowerCase()` values: `Item.sku`'s unique index folds case, and variant SKUs and barcodes are compared by the app's own case-folding rule. */
  existingItemSkus: Set<string>;
  existingVariantSkus: Set<string>;
  existingBarcodes: Set<string>;
};

const MAX_ITEM_PRICE = 999_999_999_999;
const norm = (s: string): string => s.trim().toLowerCase();

type ParsedPrice = { ok: true; value: number | null } | { ok: false; code: "INVALID_NUMBER" | "NEGATIVE_NUMBER" };

function parsePrice(raw: string | number | null): ParsedPrice {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw > MAX_ITEM_PRICE) return { ok: false, code: "INVALID_NUMBER" };
    if (raw < 0) return { ok: false, code: "NEGATIVE_NUMBER" };
    return { ok: true, value: raw };
  }
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };
  if (/^-\d+$/.test(text)) return { ok: false, code: "NEGATIVE_NUMBER" };
  if (!/^\d+$/.test(text) || Number(text) > MAX_ITEM_PRICE) return { ok: false, code: "INVALID_NUMBER" };
  return { ok: true, value: Number(text) };
}

const isVariantRow = (r: ItemImportRow): boolean => r.warna !== "" || r.ukuran !== "" || r.skuVarian !== "";

/**
 * Deliberately narrower than ItemImportColumnKey[]: with that broader type, `r[column]` also
 * covers hargaJual (string | number | null), and `.length` on a possibly-numeric value is a
 * tsc error. These five columns are the only ones that are always plain strings.
 */
const LENGTH_CHECKED: Array<"artikel" | "nama" | "namaEn" | "deskripsi" | "skuVarian"> = [
  "artikel",
  "nama",
  "namaEn",
  "deskripsi",
  "skuVarian",
];

/**
 * Pure: used by the preview AND the commit, so the two can never disagree. Groups rows by the
 * normalised artikel (the unique index is case-insensitive, so `KMJ-01` and `kmj-01 ` are one
 * item), validates every row and group, and returns a plan only when the file has no errors.
 */
export function validateItemImport(
  rows: ItemImportRow[],
  lookups: ItemImportLookups,
): ItemImportValidatedResult & { plan: ItemImportPlan | null } {
  const empty = { preview: [], artikelCount: 0, variantCount: 0, plan: null };
  if (rows.length === 0) return { errors: [importError("EMPTY_FILE")], ...empty };
  if (rows.length > ITEM_IMPORT_MAX_ROWS) {
    return { errors: [importError("TOO_MANY_ROWS", { detail: String(ITEM_IMPORT_MAX_ROWS) })], ...empty };
  }

  const errors: ItemImportError[] = [];
  const groups = new Map<string, ItemImportRow[]>();
  for (const r of rows) {
    if (r.artikel === "") {
      errors.push(importError("REQUIRED", { row: r.row, column: "artikel" }));
      continue;
    }
    const key = norm(r.artikel);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const artikelKeys = new Set(groups.keys());
  const fileVariantSkus = new Map<string, number>();
  const fileBarcodes = new Map<string, number>();
  const preview: ItemImportPreviewItem[] = [];
  const planned: ItemImportPlannedItem[] = [];
  let variantCount = 0;

  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    const artikel = first.artikel.trim();
    const groupErrors: ItemImportError[] = [];
    const push = (
      code: ItemImportError["code"],
      r: ItemImportRow | null,
      column: ItemImportColumnKey | null = null,
      detail: string | null = null,
    ) => groupErrors.push(importError(code, { row: r?.row ?? null, column, artikel, detail }));

    for (const r of groupRows) {
      if (r.nama === "") push("REQUIRED", r, "nama");
      if (r.satuan === "") push("REQUIRED", r, "satuan");
      for (const column of LENGTH_CHECKED) {
        if (r[column].length > ITEM_IMPORT_MAX_LENGTH) push("TOO_LONG", r, column, String(ITEM_IMPORT_MAX_LENGTH));
      }
      const price = parsePrice(r.hargaJual);
      if (!price.ok) push(price.code, r, "hargaJual");
    }

    const itemLevel: Array<{ column: ItemImportColumnKey; value: (r: ItemImportRow) => string }> = [
      { column: "nama", value: (r) => r.nama },
      { column: "namaEn", value: (r) => r.namaEn },
      { column: "kategori", value: (r) => norm(r.kategori) },
      { column: "satuan", value: (r) => norm(r.satuan) },
      {
        column: "hargaJual",
        value: (r) => {
          const p = parsePrice(r.hargaJual);
          return p.ok ? String(p.value) : "invalid";
        },
      },
      { column: "deskripsi", value: (r) => r.deskripsi },
    ];
    for (const { column, value } of itemLevel) {
      for (const r of groupRows.slice(1)) {
        if (value(r) !== value(first)) push("INCONSISTENT_ARTIKEL", r, column, String(first.row));
      }
    }

    const uom = first.satuan === "" ? undefined : lookups.uoms.find((u) => norm(u.code) === norm(first.satuan));
    if (first.satuan !== "" && !uom) push("UNKNOWN_UOM", first, "satuan");

    let categoryId: string | null = null;
    let categoryCode: string | null = null;
    if (first.kategori !== "") {
      const byCode = lookups.categories.find((c) => c.code !== null && norm(c.code) === norm(first.kategori));
      const byName = lookups.categories.filter((c) => norm(c.name) === norm(first.kategori));
      const category = byCode ?? (byName.length === 1 ? byName[0] : undefined);
      if (category) {
        categoryId = category.id;
        categoryCode = category.code;
      } else if (byName.length > 1) {
        push("AMBIGUOUS_CATEGORY", first, "kategori");
      } else {
        push("UNKNOWN_CATEGORY", first, "kategori");
      }
    }

    if (lookups.existingItemSkus.has(norm(artikel))) push("ARTIKEL_EXISTS", first, "artikel");
    if (lookups.existingVariantSkus.has(norm(artikel))) push("SKU_NAMESPACE_TAKEN", first, "artikel", artikel);

    const variantRows = groupRows.filter(isVariantRow);
    const variantlessRows = groupRows.filter((r) => !isVariantRow(r));
    if (variantRows.length > 0) {
      for (const r of variantlessRows) push("MIXED_VARIANTLESS", r);
    } else {
      for (const r of variantlessRows.slice(1)) push("MIXED_VARIANTLESS", r);
      for (const r of variantlessRows) if (r.barcode !== "") push("VARIANTLESS_BARCODE", r, "barcode");
    }

    /**
     * The item form rebuilds an item's variants as the full Warna x Ukuran product of its value
     * sets and drops any variant outside it, so the import only creates shapes that form can load
     * and save back unchanged: every variant row names an attribute, each attribute is filled on
     * all rows or none, no pair repeats, and a two-attribute artikel lists the whole grid.
     */
    for (const r of variantRows) {
      if (r.warna === "" && r.ukuran === "") push("VARIANT_NEEDS_ATTRIBUTE", r, "warna");
    }
    const attributed = variantRows.filter((r) => r.warna !== "" || r.ukuran !== "");
    const pattern = attributed[0];
    let attributesConsistent = true;
    for (const r of attributed.slice(1)) {
      if ((r.warna !== "") !== (pattern.warna !== "")) {
        push("INCONSISTENT_ATTRIBUTES", r, "warna", String(pattern.row));
        attributesConsistent = false;
      }
      if ((r.ukuran !== "") !== (pattern.ukuran !== "")) {
        push("INCONSISTENT_ATTRIBUTES", r, "ukuran", String(pattern.row));
        attributesConsistent = false;
      }
    }

    const seenPairs = new Set<string>();
    const duplicatePairRows = new Set<number>();
    for (const r of attributed) {
      const pair = `${norm(r.warna)}|${norm(r.ukuran)}`;
      if (seenPairs.has(pair)) {
        push("DUPLICATE_VARIANT", r);
        duplicatePairRows.add(r.row);
      }
      seenPairs.add(pair);
    }

    if (attributesConsistent && pattern && pattern.warna !== "" && pattern.ukuran !== "") {
      const warnas = new Map<string, string>();
      const ukurans = new Map<string, string>();
      for (const r of attributed) {
        if (!warnas.has(norm(r.warna))) warnas.set(norm(r.warna), r.warna);
        if (!ukurans.has(norm(r.ukuran))) ukurans.set(norm(r.ukuran), r.ukuran);
      }
      const missing: string[] = [];
      for (const [warnaKey, warna] of warnas) {
        for (const [ukuranKey, ukuran] of ukurans) {
          if (!seenPairs.has(`${warnaKey}|${ukuranKey}`)) missing.push(`${warna}/${ukuran}`);
        }
      }
      if (missing.length > 0) push("INCOMPLETE_VARIANT_GRID", first, null, missing.join(", "));
    }

    /**
     * Normalised one record at a time so every refusal lands on its own row with a SKU as its
     * detail. A row repeating an earlier pair is skipped: it is already refused, and its SKU would
     * only report the same problem twice. The file-wide map below also holds this artikel's own
     * earlier SKUs, so two rows of one artikel typing the same SKU are caught on the later row.
     */
    const normalized: Array<Record<string, string>> = [];
    const previewVariants: ItemImportPreviewVariant[] = variantRows.map((r) => {
      let finalSku: string | null = null;
      if (!duplicatePairRows.has(r.row)) {
        const record = {
          ...(r.warna !== "" ? { Warna: r.warna } : {}),
          ...(r.ukuran !== "" ? { Ukuran: r.ukuran } : {}),
          sku: r.skuVarian,
          ...(r.barcode !== "" ? { barcode: r.barcode } : {}),
        };
        const variant = validateAndNormalizeVariants(artikel, [record], { categoryCode, generateFrom: "parent" })[0];
        normalized.push(variant);
        finalSku = variant.sku;
        const key = norm(finalSku);
        if (finalSku.length > ITEM_IMPORT_MAX_LENGTH) push("TOO_LONG", r, "skuVarian", String(ITEM_IMPORT_MAX_LENGTH));
        if (lookups.existingVariantSkus.has(key)) push("VARIANT_SKU_TAKEN", r, "skuVarian", finalSku);
        if (lookups.existingItemSkus.has(key)) push("SKU_NAMESPACE_TAKEN", r, "skuVarian", finalSku);
        if (fileVariantSkus.has(key) || (artikelKeys.has(key) && key !== norm(artikel))) {
          push("DUPLICATE_IN_FILE", r, "skuVarian", finalSku);
        }
        fileVariantSkus.set(key, r.row);
      }
      if (r.barcode !== "") {
        const key = norm(r.barcode);
        if (lookups.existingBarcodes.has(key)) push("BARCODE_TAKEN", r, "barcode", r.barcode);
        if (fileBarcodes.has(key)) push("DUPLICATE_IN_FILE", r, "barcode", r.barcode);
        fileBarcodes.set(key, r.row);
      }
      return {
        row: r.row,
        warna: r.warna,
        ukuran: r.ukuran,
        barcode: r.barcode === "" ? null : r.barcode,
        typedSku: r.skuVarian === "" ? null : r.skuVarian,
        finalSku,
      };
    });

    variantCount += variantRows.length;
    errors.push(...groupErrors);
    preview.push({
      artikel,
      nameId: first.nama,
      rows: groupRows.map((r) => r.row),
      variantless: variantRows.length === 0,
      variants: previewVariants,
      hasErrors: groupErrors.length > 0,
    });

    const price = parsePrice(first.hargaJual);
    if (groupErrors.length === 0 && uom) {
      planned.push({
        sku: artikel,
        nameId: first.nama,
        nameEn: first.namaEn === "" ? first.nama : first.namaEn,
        uomId: uom.id,
        categoryId,
        sellingPrice: price.ok ? price.value : null,
        description: first.deskripsi === "" ? null : first.deskripsi,
        variants: normalized,
      });
    }
  }

  errors.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  return {
    errors,
    preview,
    artikelCount: groups.size,
    variantCount,
    plan: errors.length === 0 ? { items: planned } : null,
  };
}

const STRING_FIELDS = ["artikel", "nama", "namaEn", "kategori", "satuan", "warna", "ukuran", "skuVarian", "barcode", "deskripsi"] as const;

/* Every `"use server"` export is independently callable, so the rows a client sends are re-shaped here, never trusted. */
export function parseItemImportPayload(raw: unknown): ItemImportRow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ItemImportRow[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.row !== "number" || !Number.isInteger(e.row) || e.row < 1) return null;
    const fields: Partial<Record<(typeof STRING_FIELDS)[number], string>> = {};
    for (const f of STRING_FIELDS) {
      const v = e[f];
      if (v === undefined || v === null) fields[f] = "";
      else if (typeof v === "string") fields[f] = v.trim();
      else if (typeof v === "number" && Number.isFinite(v)) fields[f] = String(v);
      else return null;
    }
    const price = e.hargaJual;
    if (price !== null && price !== undefined && typeof price !== "string" && typeof price !== "number") return null;
    out.push({
      row: e.row,
      artikel: fields.artikel ?? "",
      nama: fields.nama ?? "",
      namaEn: fields.namaEn ?? "",
      kategori: fields.kategori ?? "",
      satuan: fields.satuan ?? "",
      hargaJual: price ?? null,
      warna: fields.warna ?? "",
      ukuran: fields.ukuran ?? "",
      skuVarian: fields.skuVarian ?? "",
      barcode: fields.barcode ?? "",
      deskripsi: fields.deskripsi ?? "",
    });
  }
  return out;
}
