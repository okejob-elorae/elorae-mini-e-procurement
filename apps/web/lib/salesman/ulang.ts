import type { CartLine } from "@/lib/field-sales/cart";
import { hargaSah } from "@/lib/field-sales/harga-wajib";

/**
 * "Ulangi pesanan terakhir": baris pesanan lama → isi keranjang katalog.
 *
 * Dibatasi stok yang tersedia SEKARANG; baris yang habis, variannya hilang,
 * atau barangnya sudah tidak ada di katalog dilewati dan DIHITUNG (`dilewati`),
 * supaya layar bisa menyebut jumlahnya. Di toko PUTUS barang yang belum punya
 * harga (null atau 0) juga dilewati — dulu masuk sebagai Rp 0 — dan DISEBUT
 * namanya (`tanpaHarga`, sekali per barang) karena kantor harus menetapkan
 * harganya dulu. Konsinyasi tidak pernah membawa harga — salesman konsi tidak
 * melihat harga sama sekali, jadi aturan harga tidak berlaku di sana.
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
): { baris: CartLine[]; dilewati: number; tanpaHarga: string[] } {
  const hasil: CartLine[] = [];
  let dilewati = 0;
  const tanpaHarga = new Map<string, string>();
  for (const b of baris) {
    const it = katalog.find((x) => x.itemId === b.itemId);
    if (!it) {
      dilewati += 1;
      continue;
    }
    // Harga dinilai sebelum stok: barang tanpa harga tidak bisa dipesan berapa pun stoknya.
    if (!konsi && !hargaSah(it.price)) {
      tanpaHarga.set(it.itemId, it.nameId);
      continue;
    }
    const varian = b.variantSku ? it.variants.find((v) => v.variantSku === b.variantSku) : null;
    const available = b.variantSku ? (varian?.available ?? 0) : it.available;
    const qty = Math.min(b.qty, available);
    if (qty <= 0) {
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
  return { baris: hasil, dilewati, tanpaHarga: [...tanpaHarga.values()] };
}

/** Daftar nama untuk satu baris peringatan: paling banyak `maks` nama, sisanya dihitung. */
export function ringkasNama(nama: readonly string[], maks = 3): { nama: string; sisa: number } {
  return { nama: nama.slice(0, maks).join(", "), sisa: Math.max(0, nama.length - maks) };
}
