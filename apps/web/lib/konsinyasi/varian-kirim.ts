import { prisma } from "@elorae/db";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";

/**
 * Pilihan varian untuk satu baris "Kirim titipan".
 *
 * Kuncinya sama persis dengan penulis (`kirimTitipan`): satu kunci per baris
 * `InventoryValue`, null dan "" sama-sama "tanpa varian". Barang dengan lebih
 * dari satu kunci WAJIB menyebut variannya (`VARIAN_WAJIB`) — tanpa pemilih ini
 * barang bervarian (kebanyakan barang hasil Jubelio) tidak bisa dikirim sama sekali.
 *
 * Tidak ada harga di sini: yang dibaca hanya stok gudang untuk layar kantor.
 */

export type VarianKirim = { sku: string; label: string; tersedia: number };

export type PilihanVarianKirim = {
  /** Sama dengan penolakan `VARIAN_WAJIB` di penulis: lebih dari satu kunci stok. */
  perluVarian: boolean;
  /** Varian bernama yang punya baris stok gudang, urut katalog barang. */
  varian: VarianKirim[];
  /** Stok tersedia baris tanpa varian (null/""); null bila barisnya tidak ada. */
  tersediaTanpaVarian: number | null;
};

type BarisStok = { variantSku: string | null; qtyOnHand: unknown; reservedQty: unknown };

const tersedia = (b: BarisStok) => Number(b.qtyOnHand ?? 0) - Number(b.reservedQty ?? 0);

/** Murni: baris stok satu barang + `Item.variants` → pilihan varian. */
export function susunVarianKirim(baris: BarisStok[], variantsMentah: unknown): PilihanVarianKirim {
  const opsi = variantSelectOptions(parseItemVariants(variantsMentah));
  const urutan = new Map(opsi.map((o, i) => [o.sku, i]));
  const label = new Map(opsi.map((o) => [o.sku, o.label]));

  const kunci = new Set(baris.map((b) => b.variantSku ?? ""));

  // Baris kembar null + "": tampilkan yang TERKECIL. Penulis memotong satu baris saja,
  // jadi menjumlahkan keduanya menjanjikan lebih dari yang bisa dikirim.
  const tanpa = baris.filter((b) => (b.variantSku ?? "") === "");
  const tersediaTanpaVarian = tanpa.length > 0 ? Math.min(...tanpa.map(tersedia)) : null;

  const varian = baris
    .filter((b) => (b.variantSku ?? "") !== "")
    .map((b) => {
      const sku = b.variantSku as string;
      return { sku, label: label.get(sku) ?? sku, tersedia: tersedia(b) };
    })
    .sort((a, b) => {
      const ia = urutan.get(a.sku) ?? Number.MAX_SAFE_INTEGER;
      const ib = urutan.get(b.sku) ?? Number.MAX_SAFE_INTEGER;
      return ia !== ib ? ia - ib : a.sku.localeCompare(b.sku);
    });

  return { perluVarian: kunci.size > 1, varian, tersediaTanpaVarian };
}

/** Pilihan varian satu barang, dibaca langsung dari stok gudang. */
export async function pilihanVarianKirim(itemId: string): Promise<PilihanVarianKirim> {
  const [baris, barang] = await Promise.all([
    prisma.inventoryValue.findMany({
      where: { itemId },
      select: { variantSku: true, qtyOnHand: true, reservedQty: true },
    }),
    prisma.item.findUnique({ where: { id: itemId }, select: { variants: true } }),
  ]);
  return susunVarianKirim(baris, barang?.variants ?? null);
}

/** Label varian untuk rincian kurang stok; sku sendiri bila tidak ada di katalog barang. */
export function labelVarian(variantsMentah: unknown, sku: string): string | null {
  if (!sku) return null;
  const o = variantSelectOptions(parseItemVariants(variantsMentah)).find((x) => x.sku === sku);
  return o ? o.label : sku;
}
