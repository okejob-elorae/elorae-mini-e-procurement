import { prisma } from "@elorae/db";
import { parseItemVariants } from "@/lib/items/variants";
import { bahanSaranTawar } from "@/lib/salesman/saran-tawar-queries";
import { HARI_AREA } from "@/lib/salesman/saran-tawar";
import { ALASAN_SARAN, HARI_SERING, susunSaranMinta, type AlasanSaran, type KirimanToko, type SaranMinta } from "./saran-minta";

/**
 * Kueri "Saran untuk diminta" di formulir minta kiriman SPG. Aturannya murni di
 * `saran-minta.ts`; bahannya sebagian besar SAMA dengan saran tawar salesman
 * (`bahanSaranTawar`: laku di toko sejenis, pesanan toko ini, stok gudang,
 * umur barang baru) ditambah buku stok toko dan kiriman modul konsinyasi.
 *
 * Yang sampai ke HP hanya barang, alasan, dan jumlah POTONG: tidak ada rupiah,
 * tidak ada nama toko lain (hanya berapa toko), tidak ada angka stok gudang
 * (hanya ukuran mana yang tersedia).
 */

const HARI_MS = 86_400_000;

type Info =
  | { alasan: "LAKU_DI_TOKO_LAIN"; pcs: number; toko: number; sisa: number | null }
  | { alasan: "SERING_DIKIRIM"; kali: number; pcs: number; sisa: number | null; hariSejak: number }
  | { alasan: "BARANG_BARU"; umurHari: number };

export type SaranMintaBaris = Info & {
  itemId: string;
  nama: string;
  sku: string;
  /** SKU varian yang tersedia di gudang; `[""]` untuk barang tanpa varian. */
  varian: string[];
};

export type HasilSaranMinta = {
  /** Pembanding "toko lain": se-area, atau semua toko sejenis bila toko tanpa area. */
  pembanding: "AREA" | "JENIS";
  hariArea: number;
  hariSering: number;
  hariBaru: number;
  /** Toko belum punya buku stok — "sisa di rak" tidak diketahui. */
  tanpaBuku: boolean;
  kelompok: Record<AlasanSaran, SaranMintaBaris[]>;
};

const angka = (v: unknown) => Number(v ?? 0);

/**
 * Ukuran yang bisa dikirim: varian dengan stok tersedia gudang > 0. Stok yang
 * tercatat pada baris tanpa varian (GRN/produksi menulis baris gabungan untuk
 * barang bervarian) membuat semua ukurannya dianggap tersedia — gudang yang
 * memilihkan ukurannya.
 */
export function varianTersedia(
  variants: unknown,
  stok: { variantSku: string | null; qtyOnHand: unknown; reservedQty: unknown }[],
): string[] {
  const sku = parseItemVariants(variants)
    .map((v) => String(v.sku ?? "").trim())
    .filter(Boolean);
  const tersedia = (s: { qtyOnHand: unknown; reservedQty: unknown }) => angka(s.qtyOnHand) - angka(s.reservedQty);
  const gabungan = stok.filter((s) => !s.variantSku).reduce((n, s) => n + tersedia(s), 0);
  if (sku.length === 0) return stok.reduce((n, s) => n + tersedia(s), 0) > 0 ? [""] : [];
  if (gabungan > 0) return sku;
  const per = new Map<string, number>();
  for (const s of stok) if (s.variantSku) per.set(s.variantSku, (per.get(s.variantSku) ?? 0) + tersedia(s));
  return sku.filter((v) => (per.get(v) ?? 0) > 0);
}

export async function saranMintaToko(storeId: string, hariIni: Date): Promise<HasilSaranMinta | null> {
  const b = await bahanSaranTawar(storeId, hariIni);
  if (!b) return null;

  const sejakKonsi = new Date(hariIni.getTime() - Math.max(HARI_SERING, b.bahan.hariBaru) * HARI_MS);
  const [buku, konsi] = await Promise.all([
    prisma.storeStockMovement.groupBy({ by: ["itemId", "variantSku"], where: { storeId }, _sum: { qty: true } }),
    // Kiriman modul konsinyasi tidak ikut di `beliTokoIni` (yang membaca pesanan lapangan).
    prisma.consignmentShipmentItem.findMany({
      where: { itemId: { not: null }, shipment: { storeId, shippedAt: { gte: sejakKonsi } } },
      select: { itemId: true, qty: true, shipmentId: true, shipment: { select: { shippedAt: true } } },
    }),
  ]);

  const saldo = new Map<string, number>();
  for (const g of buku) saldo.set(g.itemId, (saldo.get(g.itemId) ?? 0) + Math.max(0, g._sum.qty ?? 0));
  // Satu kiriman konsinyasi satu peristiwa per barang, seperti satu pesanan di `beliTokoIni`.
  const perKirim = new Map<string, KirimanToko>();
  for (const k of konsi) {
    const kunci = `${k.shipmentId}|${k.itemId}`;
    const ada = perKirim.get(kunci);
    if (ada) ada.pcs += k.qty;
    else perKirim.set(kunci, { itemId: k.itemId as string, tanggal: k.shipment.shippedAt, pcs: k.qty });
  }

  const s = susunSaranMinta(
    {
      jualSejenis: b.bahan.jualSejenis,
      kiriman: [...b.bahan.beliToko, ...perKirim.values()],
      saldo: buku.length > 0 ? saldo : null,
      pernahDiBuku: new Set(buku.map((g) => g.itemId)),
      barang: b.bahan.barang,
      hariBaru: b.bahan.hariBaru,
    },
    hariIni,
  );

  const ids = [...new Set(ALASAN_SARAN.flatMap((a) => s[a].map((x) => x.itemId)))];
  const items = ids.length
    ? await prisma.item.findMany({
        where: { id: { in: ids } },
        select: { id: true, variants: true, inventoryValues: { select: { variantSku: true, qtyOnHand: true, reservedQty: true } } },
      })
    : [];
  const varian = new Map(items.map((it) => [it.id, varianTersedia(it.variants, it.inventoryValues)]));

  const tampil = (x: SaranMinta): SaranMintaBaris | null => {
    const v = varian.get(x.itemId) ?? [];
    // Barang tersedia secara keseluruhan tapi tanpa satu ukuran pun yang bisa dikirim: tidak disarankan.
    if (v.length === 0) return null;
    const info = b.infoBarang.get(x.itemId);
    const dasar = { itemId: x.itemId, nama: info?.nama ?? "—", sku: info?.sku ?? "—", varian: v };
    if (x.alasan === "LAKU_DI_TOKO_LAIN") return { ...dasar, alasan: x.alasan, pcs: x.pcs, toko: x.toko, sisa: x.sisa };
    if (x.alasan === "SERING_DIKIRIM") return { ...dasar, alasan: x.alasan, kali: x.kali, pcs: x.pcs, sisa: x.sisa, hariSejak: x.hariSejak };
    return { ...dasar, alasan: x.alasan, umurHari: x.umurHari };
  };
  const kelompok = Object.fromEntries(
    ALASAN_SARAN.map((a) => [a, s[a].map(tampil).filter((x): x is SaranMintaBaris => x !== null)]),
  ) as Record<AlasanSaran, SaranMintaBaris[]>;

  return {
    pembanding: b.pembanding.jenis,
    hariArea: HARI_AREA,
    hariSering: HARI_SERING,
    hariBaru: b.bahan.hariBaru,
    tanpaBuku: buku.length === 0,
    kelompok,
  };
}
