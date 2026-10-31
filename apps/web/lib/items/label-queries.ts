import { prisma } from "@elorae/db";
import { cariTeks, samaTeks } from "@/lib/db/cari-teks";
import { computeStorePrice } from "@elorae/db/pricing";
import { bacaVarian } from "@/lib/salesman/analisa-toko";
import { barisVarianProduk } from "@/lib/spg/produk";
import {
  isiDariDokumen,
  kandidatSkuInduk,
  type BarangLabel,
  type BarisDokumenLabel,
  type DilewatiDokumen,
  type JumlahLabel,
  type SumberDokumenLabel,
  type TanpaUkuranDokumen,
} from "./label";

/**
 * Kueri layar label barcode kantor — server saja. Komponen klien hanya boleh
 * `import type` dari sini.
 *
 * Harga di label = harga eceran yang dipakai layar jual SPG
 * (`computeStorePrice` PUTUS = `Item.sellingPrice`). Varian dibaca dari
 * `Item.variants` yang bisa berupa larik atau TEKS JSON dengan kunci berhuruf
 * besar (`barisVarianProduk`, `bacaVarian`).
 */

const hargaEceran = (sellingPrice: unknown): number | null =>
  computeStorePrice({
    sellingPrice: sellingPrice === null || sellingPrice === undefined ? null : Number(sellingPrice),
    termsType: "PUTUS",
    markupPercent: null,
    priceDiscountPercent: null,
  }).price;

const angka = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export type HasilCariLabel = { itemId: string; nama: string; sku: string; jumlahVarian: number; harga: number | null };

/** Barang jadi aktif menurut nama/SKU (juga SKU varian lewat SKU induknya), paling banyak `batas`. */
export async function cariBarangLabel(q: string, batas = 20): Promise<HasilCariLabel[]> {
  const kata = q.trim().slice(0, 100);
  if (kata.length < 2) return [];
  const items = await prisma.item.findMany({
    where: {
      type: "FINISHED_GOOD",
      isActive: true,
      OR: [
        { nameId: cariTeks(kata) },
        { nameEn: cariTeks(kata) },
        { sku: cariTeks(kata) },
        ...kandidatSkuInduk(kata).map((sku) => ({ sku: samaTeks(sku) })),
      ],
    },
    orderBy: { nameId: "asc" },
    take: batas,
    select: { id: true, sku: true, nameId: true, variants: true, sellingPrice: true },
  });
  return items.map((i) => ({
    itemId: i.id,
    nama: i.nameId,
    sku: i.sku,
    jumlahVarian: barisVarianProduk(i.variants).length,
    harga: hargaEceran(i.sellingPrice),
  }));
}

/** Data label per barang, urut seperti `itemIds`; id yang tidak ada dilewati. */
export async function barangUntukLabel(itemIds: readonly string[]): Promise<BarangLabel[]> {
  const ids = [...new Set(itemIds.filter((x) => typeof x === "string" && x.length > 0))].slice(0, 200);
  if (ids.length === 0) return [];
  const [items, stok] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: ids } },
      select: { id: true, sku: true, nameId: true, variants: true, sellingPrice: true, isActive: true },
    }),
    prisma.inventoryValue.findMany({ where: { itemId: { in: ids } }, select: { itemId: true, variantSku: true, qtyOnHand: true } }),
  ]);
  const peta = new Map(items.map((i) => [i.id, i]));
  const hasil: BarangLabel[] = [];
  for (const id of ids) {
    const i = peta.get(id);
    if (!i) continue;
    const baris = stok.filter((s) => s.itemId === id);
    const master = barisVarianProduk(i.variants);
    const umum = { itemId: i.id, nama: i.nameId, sku: i.sku, harga: hargaEceran(i.sellingPrice), aktif: i.isActive };
    if (master.length === 0) {
      hasil.push({
        ...umum,
        bervarian: false,
        varian: [
          { variantSku: "", ukuran: null, warna: null, barcode: null, stokGudang: baris.reduce((n, s) => n + angka(s.qtyOnHand), 0) },
        ],
        stokTanpaUkuran: 0,
      });
      continue;
    }
    hasil.push({
      ...umum,
      bervarian: true,
      varian: master.map((m) => {
        const { ukuran, warna } = bacaVarian(i.variants, m.sku, i.sku);
        const stokGudang = baris
          .filter((s) => (s.variantSku ?? "").toLowerCase() === m.sku.toLowerCase())
          .reduce((n, s) => n + angka(s.qtyOnHand), 0);
        return { variantSku: m.sku, ukuran, warna, barcode: m.barcode, stokGudang };
      }),
      stokTanpaUkuran: baris.filter((s) => !s.variantSku).reduce((n, s) => n + angka(s.qtyOnHand), 0),
    });
  }
  return hasil;
}

export type HasilDokumenLabel = {
  sumber: SumberDokumenLabel;
  nomor: string;
  /** Toko tujuan dokumen. */
  toko: string | null;
  /** Σ potong di dokumen, apa pun yang bisa dijadikan label. */
  totalDokumen: number;
  barang: BarangLabel[];
  jumlah: JumlahLabel;
  tanpaUkuran: TanpaUkuranDokumen[];
  dilewati: DilewatiDokumen[];
};

async function barisDokumen(
  sumber: SumberDokumenLabel,
): Promise<{ nomor: string; toko: string | null; baris: BarisDokumenLabel[] } | null> {
  if (sumber.jenis === "pengiriman") {
    const d = await prisma.fieldSalesDelivery.findUnique({
      where: { id: sumber.id },
      select: {
        docNo: true,
        order: { select: { store: { select: { name: true } } } },
        lines: { select: { itemId: true, variantSku: true, productName: true, qty: true } },
      },
    });
    if (!d) return null;
    return {
      nomor: d.docNo,
      toko: d.order.store.name,
      baris: d.lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, nama: l.productName, qty: l.qty })),
    };
  }
  if (sumber.jenis === "mutasi") {
    const m = await prisma.storeTransfer.findUnique({
      where: { id: sumber.id },
      select: {
        docNo: true,
        toStore: { select: { name: true } },
        lines: { select: { itemId: true, variantSku: true, productName: true, qty: true } },
      },
    });
    if (!m) return null;
    return {
      nomor: m.docNo,
      toko: m.toStore.name,
      baris: m.lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, nama: l.productName, qty: l.qty })),
    };
  }
  const k = await prisma.consignmentShipment.findUnique({
    where: { id: sumber.id },
    select: { noKirim: true, store: { select: { name: true } }, items: { select: { itemId: true, itemName: true, qty: true } } },
  });
  if (!k) return null;
  // Kiriman konsinyasi tidak mencatat ukuran: barang bervarian masuk `tanpaUkuran`.
  return {
    nomor: k.noKirim,
    toko: k.store.name,
    baris: k.items.map((l) => ({ itemId: l.itemId, variantSku: null, nama: l.itemName, qty: l.qty })),
  };
}

/** Isian awal layar label dari satu dokumen kiriman; null bila dokumennya tidak ada. */
export async function isiLabelDariDokumen(sumber: SumberDokumenLabel): Promise<HasilDokumenLabel | null> {
  const dok = await barisDokumen(sumber);
  if (!dok) return null;
  const barang = await barangUntukLabel(dok.baris.map((b) => b.itemId).filter((x): x is string => Boolean(x)));
  const { jumlah, tanpaUkuran, dilewati } = isiDariDokumen(barang, dok.baris);
  return {
    sumber,
    nomor: dok.nomor,
    toko: dok.toko,
    totalDokumen: dok.baris.reduce((n, b) => n + Math.max(0, b.qty), 0),
    barang,
    jumlah,
    tanpaUkuran,
    dilewati,
  };
}
