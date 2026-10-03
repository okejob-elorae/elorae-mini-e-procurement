import type { CartLine } from '@/lib/field-sales/cart';

/**
 * "Ulangi pesanan terakhir": baris pesanan lama → isi keranjang katalog.
 *
 * Dibatasi stok yang tersedia SEKARANG; baris yang habis, variannya hilang,
 * atau barangnya sudah tidak ada di katalog dilewati dan DIHITUNG, supaya
 * layar bisa menyebut jumlahnya. Konsinyasi tidak pernah membawa harga —
 * salesman konsi tidak melihat harga sama sekali.
 */

type BarangKatalog = {
  itemId: string;
  sku: string;
  nameId: string;
  price: number | null;
  available: number;
  variants: { variantSku: string; variantLabel: string; available: number }[];
};

export function susunIsiUlang(
  katalog: readonly BarangKatalog[],
  baris: readonly { itemId: string; variantSku: string; qty: number }[],
  konsi: boolean,
): { baris: CartLine[]; dilewati: number } {
  const hasil: CartLine[] = [];
  let dilewati = 0;
  for (const b of baris) {
    const it = katalog.find((x) => x.itemId === b.itemId);
    const varian = it && b.variantSku ? it.variants.find((v) => v.variantSku === b.variantSku) : null;
    const available = !it ? 0 : b.variantSku ? (varian?.available ?? 0) : it.available;
    const qty = Math.min(b.qty, available);
    if (!it || qty <= 0) {
      dilewati += 1;
      continue;
    }
    hasil.push({
      itemId: it.itemId,
      variantSku: b.variantSku,
      variantLabel: varian?.variantLabel ?? null,
      sku: it.sku,
      nameId: it.nameId,
      unitPrice: konsi ? 0 : (it.price ?? 0),
      available,
      qty,
      requestedUnitPrice: null,
      appealReason: null,
    });
  }
  return { baris: hasil, dilewati };
}
