import { prisma } from "@elorae/db";
import { computeBonusLines, type PromoInput } from "@elorae/db/promo";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
import { alokasikanBonus, type BarisBonus, type StokBonus } from "./bonus-alokasi";

type Klien = {
  promo: Pick<typeof prisma.promo, "findMany">;
  inventoryValue: Pick<typeof prisma.inventoryValue, "findMany">;
  item: Pick<typeof prisma.item, "findMany">;
};

/**
 * Promo BONUS yang berlaku di toko ini sekarang — saringan yang sama dengan
 * `fetchActivePromosForStore` (aktif, PUTUS, jendela tanggal, cakupan toko),
 * ditambah kolom bonus dan nama promonya (untuk layar tinjau dan baris pesanan).
 */
export async function ambilPromoBonus(
  storeId: string,
  now: Date,
  client: Pick<Klien, "promo"> = prisma,
): Promise<{ promos: PromoInput[]; namaById: Map<string, string> }> {
  const rows = await client.promo.findMany({
    where: {
      isActive: true,
      termsType: "PUTUS",
      type: "BONUS",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        { OR: [{ allStores: true }, { stores: { some: { storeId } } }] },
      ],
    },
    select: {
      id: true,
      name: true,
      level: true,
      priority: true,
      bonusBuyQty: true,
      bonusFreeQty: true,
      bonusItemId: true,
      items: { select: { itemId: true } },
    },
  });
  return {
    promos: rows.map((p) => ({
      id: p.id,
      type: "BONUS" as const,
      level: p.level as PromoInput["level"],
      value: null,
      minQty: null,
      minOrderSubtotal: null,
      minOrderQty: null,
      priority: p.priority,
      itemIds: p.items.map((i) => i.itemId),
      tiers: [],
      bonusBuyQty: p.bonusBuyQty,
      bonusFreeQty: p.bonusFreeQty,
      bonusItemId: p.bonusItemId,
    })),
    namaById: new Map(rows.map((p) => [p.id, p.name])),
  };
}

export type BonusPesanan = BarisBonus & {
  promoName: string;
  /** Nama barang (+ varian), TANPA akhiran "(bonus)" — penulis yang menambahkannya. */
  productName: string;
  variantLabel: string | null;
};

/**
 * Baris gratis untuk satu pesanan PUTUS: promo → mesin bonus → dibatasi stok.
 * Dipakai penulis pesanan (dengan `tx`) dan pratinjau di layar tinjau, supaya
 * yang dilihat salesman sama dengan yang tercatat.
 *
 * `pesananBelumDicadangkan`: pratinjau belum mencadangkan apa pun, jadi pcs
 * keranjang pada varian yang sama harus dikurangkan dari stok tersedia. Penulis
 * memanggil ini SESUDAH mencadangkan baris pesanannya, jadi `false` — stok
 * tersedia sudah bersih dari pesanan itu sendiri.
 */
export async function susunBonusPesanan(
  client: Klien,
  input: {
    storeId: string;
    now: Date;
    lines: Array<{ itemId: string; variantSku: string; qty: number; productName?: string }>;
    pesananBelumDicadangkan: boolean;
  },
): Promise<BonusPesanan[]> {
  const { promos, namaById } = await ambilPromoBonus(input.storeId, input.now, client);
  if (promos.length === 0) return [];
  const calon = computeBonusLines({ lines: input.lines, activePromos: promos });
  if (calon.length === 0) return [];

  const itemIds = Array.from(new Set(calon.map((c) => c.itemId)));
  const invs = await client.inventoryValue.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true },
  });
  const items = await client.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true, variants: true } });
  const barangById = new Map(items.map((i) => [i.id, i]));

  const dipesan = new Map<string, number>();
  if (input.pesananBelumDicadangkan) {
    for (const l of input.lines) dipesan.set(`${l.itemId}::${l.variantSku}`, (dipesan.get(`${l.itemId}::${l.variantSku}`) ?? 0) + l.qty);
  }

  const stok = new Map<string, StokBonus[]>();
  for (const iv of invs) {
    // Barang hadiah yang sudah dihapus tidak bisa diberikan.
    if (!barangById.has(iv.itemId)) continue;
    const variantSku = iv.variantSku ?? "";
    const tersedia = Number(iv.qtyOnHand) - Number(iv.reservedQty) - (dipesan.get(`${iv.itemId}::${variantSku}`) ?? 0);
    const rows = stok.get(iv.itemId) ?? [];
    const ada = rows.find((r) => r.variantSku === variantSku);
    /*
     * Baris null dan "" untuk barang yang sama jatuh ke kunci yang sama. Pakai
     * yang TERKECIL: reservasi hanya memakai satu baris (findFirst), jadi angka
     * terkecil satu-satunya yang pasti bisa dipenuhi — sama dengan saran konsinyasi.
     */
    if (ada) ada.available = Math.min(ada.available, tersedia);
    else rows.push({ variantSku, available: tersedia });
    stok.set(iv.itemId, rows);
  }

  return alokasikanBonus(calon, stok).map((b) => {
    const barang = barangById.get(b.itemId);
    const label = b.variantSku
      ? (variantSelectOptions(parseItemVariants(barang?.variants)).find((o) => o.sku === b.variantSku)?.label ?? b.variantSku)
      : null;
    const dariPesanan = input.lines.find((l) => l.itemId === b.itemId && l.variantSku === b.variantSku && l.productName)?.productName;
    const nama = barang?.nameId ?? b.itemId;
    return {
      ...b,
      promoName: namaById.get(b.promoId) ?? "",
      productName: dariPesanan ?? (label ? `${nama} — ${label}` : nama),
      variantLabel: label,
    };
  });
}
