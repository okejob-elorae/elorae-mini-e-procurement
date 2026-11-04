import { variantDetailForSku } from "@/lib/items/variants";
import type { POPrintLine } from "@/lib/print/po-html";
import { jumlahRoll } from "./rincian-warna";
import { labelWarna, warnaVarian } from "./varian-warna";

/*
 * Baris PO (rincian PO) → baris cetak PO. Bahan (bukan barang jadi) yang
 * variannya warna mendapat kolom Warna ("HITAM · 19-4005 TCX") alih-alih
 * rincian atribut varian; bahan kg dengan kg per roll mendapat kolom Roll.
 * Murni, aman di klien.
 */

export type BarisPoCetak = {
  variantSku: string | null;
  notes: string | null;
  qty: number;
  price: number;
  item: {
    sku: string;
    nameId: string;
    nameEn?: string | null;
    type?: string | null;
    variants?: unknown;
    kgPerRoll?: number | null;
    uom?: { code: string } | null;
  } | null;
};

export function barisCetakPo(baris: readonly BarisPoCetak[]): POPrintLine[] {
  return baris.map((b) => {
    const item = b.item;
    const variantSku = b.variantSku?.trim() || null;
    const bahan = !!item?.type && item.type !== "FINISHED_GOOD";
    const warna = bahan ? warnaVarian(item?.variants, variantSku) : null;
    const uomCode = item?.uom?.code ?? "";
    const qty = Number(b.qty ?? 0);
    const price = Number(b.price ?? 0);
    return {
      itemName: item?.nameId || item?.nameEn || item?.sku || "",
      itemSku: item?.sku,
      variantSku,
      variantDetail: warna ? null : variantDetailForSku(item?.variants, variantSku),
      lineNotes: b.notes?.trim() ? b.notes.trim() : null,
      qty,
      uomCode,
      price,
      amount: qty * price,
      warna: warna ? labelWarna(warna) : null,
      roll: bahan ? jumlahRoll(qty, item?.kgPerRoll, uomCode) : null,
    };
  });
}
