import type { BonusLineResult } from "@elorae/db/promo";

/**
 * Membatasi pcs gratis promo bonus ke stok yang ada — murni.
 *
 * Aturan pemilik: bonus TIDAK PERNAH menahan pesanan. Kalau stok barang hadiah
 * kurang, diberikan sebanyak yang ada dan kekurangannya dicatat; pesanan tetap
 * jalan. Karena itu hitungan ini tidak pernah melempar.
 */

/** Stok satu varian barang hadiah. `variantSku` "" = barang tanpa varian. */
export type StokBonus = { variantSku: string; available: number };

export type BarisBonus = {
  promoId: string;
  itemId: string;
  /** Varian yang diberikan ("" = barang tanpa varian, atau hadiah tanpa stok sama sekali). */
  variantSku: string;
  /** Pcs yang benar-benar diberikan (bisa 0). */
  qty: number;
  /** Pcs yang menjadi hak toko menurut promo. */
  diminta: number;
  /** diminta − qty. */
  kurang: number;
};

/**
 * Varian untuk barang hadiah yang TIDAK ada di pesanan (promo tidak bisa
 * menurunkan variannya dari pesanan): varian nyata dengan stok tersedia terbesar,
 * seri → SKU terkecil. Barang yang hanya punya baris tanpa varian → "". Tanpa baris
 * stok sama sekali → null (tidak ada yang bisa dicadangkan).
 */
export function pilihVarianHadiah(rows: StokBonus[]): string | null {
  const nyata = rows.filter((r) => r.variantSku !== "");
  if (nyata.length === 0) return rows.length > 0 ? "" : null;
  const urut = [...nyata].sort((a, b) => b.available - a.available || a.variantSku.localeCompare(b.variantSku));
  return urut[0].variantSku;
}

const kunci = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;

/**
 * `stok` per barang hadiah. Stok yang terpakai satu baris bonus dikurangkan
 * sebelum baris berikutnya dinilai, supaya dua promo yang memberi varian yang
 * sama tidak memakai stok yang sama dua kali.
 */
export function alokasikanBonus(calon: BonusLineResult[], stok: Map<string, StokBonus[]>): BarisBonus[] {
  const sisa = new Map<string, number>();
  for (const [itemId, rows] of stok) {
    for (const r of rows) sisa.set(kunci(itemId, r.variantSku), r.available);
  }
  return calon.map((c) => {
    const variantSku = c.variantSku ?? pilihVarianHadiah(stok.get(c.itemId) ?? []);
    if (variantSku === null) {
      return { promoId: c.promoId, itemId: c.itemId, variantSku: "", qty: 0, diminta: c.qty, kurang: c.qty };
    }
    const k = kunci(c.itemId, variantSku);
    const ada = Math.max(0, Math.floor(sisa.get(k) ?? 0));
    const qty = Math.min(c.qty, ada);
    sisa.set(k, (sisa.get(k) ?? 0) - qty);
    return { promoId: c.promoId, itemId: c.itemId, variantSku, qty, diminta: c.qty, kurang: c.qty - qty };
  });
}

/**
 * Kalimat kekurangan bonus untuk catatan pesanan — dibaca kantor saat
 * menyetujui. Disimpan sebagai data (bahasa kantor), bukan teks antarmuka.
 */
export function catatanKurangBonus(baris: Array<{ kurang: number; productName: string; promoName: string }>): string | null {
  const kurang = baris.filter((b) => b.kurang > 0);
  if (kurang.length === 0) return null;
  return kurang
    .map((b) => `[Bonus] Kurang ${b.kurang} pcs ${b.productName} (promo ${b.promoName}) — stok tidak cukup.`)
    .join("\n");
}
