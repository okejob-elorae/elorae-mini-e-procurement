import { prisma } from "@elorae/db";
import { resolveVariantAxes } from "@elorae/db/variant-axes";
import { parseItemVariants } from "@/lib/items/variants";
import type { PlanCandidate } from "./plan";

// Only the size axis is read here (`Ukuran`, or `size`/`Size` before #437 normalised them).
const NO_COLORS = new Map<string, string>();

/** Kandidat pesanan cepat / rencana kirim, plus yang dibutuhkan penyusun rencana. */
export type KandidatMuat = PlanCandidate & {
  nama: string;
  kategoriId: string;
  dibuat: Date;
  /** `Item.sellingPrice` mentah. Harga toko dihitung pemanggil — dan TIDAK PERNAH untuk toko konsinyasi. */
  hargaJual: number | null;
  /** `Item.variants` apa adanya, untuk label varian di layar. */
  variantsMentah: unknown;
};

/**
 * Varian bertanda ukuran dari `Item.variants`.
 *
 * Sebagian data lama menyimpan varian sebagai TEKS JSON, dan kuncinya tidak
 * selalu huruf kecil (`SKU`, `Size`, `ukuran`). Baris tanpa SKU dilewati: tanpa
 * SKU tidak ada baris stok yang bisa dipesan.
 */
export function bacaUkuranVarian(raw: unknown): Array<{ variantSku: string; size: string }> {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const hasil: Array<{ variantSku: string; size: string }> = [];
  for (const o of v) {
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    let sku = "";
    let size = "";
    for (const [k, val] of Object.entries(o as Record<string, unknown>)) {
      const kunci = k.toLowerCase();
      const s = val == null ? "" : String(val).trim();
      if (kunci === "sku" && !sku) sku = s;
      else if ((kunci === "size" || kunci === "ukuran") && !size) size = s;
    }
    if (sku) hasil.push({ variantSku: sku, size });
  }
  return hasil;
}

/**
 * Active finished goods in the given categories, shaped for the planner:
 * raw variants (variantSku + size) + main-WH available (qtyOnHand - reservedQty).
 * Items with no variant rows contribute a single null-sku bucket so a
 * ratio that names sizes will simply not match them (they drop MISSING_SIZE) —
 * expected for a sized pack; the "N pcs" mode of the delivery plan sends them as one bucket.
 *
 * A `null` and a `""` stock row for the same key are read as the SMALLER of the
 * two, like `listKonsiSuggestions`: the order writer reserves against one row,
 * so summing them would offer more than it can honour.
 */
export async function loadSmartRequestCandidates(categoryIds: string[]): Promise<Map<string, KandidatMuat[]>> {
  const items = await prisma.item.findMany({
    where: { isActive: true, type: "FINISHED_GOOD", categoryId: { in: categoryIds } },
    select: {
      id: true,
      sku: true,
      nameId: true,
      categoryId: true,
      createdAt: true,
      sellingPrice: true,
      variants: true,
      inventoryValues: { select: { variantSku: true, qtyOnHand: true, reservedQty: true } },
    },
  });

  const byCategory = new Map<string, KandidatMuat[]>();
  for (const it of items) {
    const availByVariant: Record<string, number> = {};
    for (const iv of it.inventoryValues) {
      const key = iv.variantSku ?? "";
      const ada = Number(iv.qtyOnHand) - Number(iv.reservedQty ?? 0);
      availByVariant[key] = key in availByVariant ? Math.min(availByVariant[key], ada) : ada;
    }
    const variants = parseItemVariants(it.variants)
      .map((v) => ({ variantSku: (v.sku ?? "").trim(), size: resolveVariantAxes(v, NO_COLORS).size ?? "" }))
      .filter((v) => v.variantSku !== "");
    const cat = it.categoryId ?? "";
    const candidate: KandidatMuat = {
      itemId: it.id,
      sku: it.sku,
      variants,
      available: availByVariant,
      nama: it.nameId,
      kategoriId: cat,
      dibuat: it.createdAt,
      hargaJual: it.sellingPrice == null ? null : Number(it.sellingPrice),
      variantsMentah: it.variants,
    };
    const list = byCategory.get(cat) ?? [];
    list.push(candidate);
    byCategory.set(cat, list);
  }
  return byCategory;
}
