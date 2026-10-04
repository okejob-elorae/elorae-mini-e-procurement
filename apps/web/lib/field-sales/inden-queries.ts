import { prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { computeStorePrice } from "@elorae/db/pricing";
import { getPrimaryImagesBatch } from "@/lib/items/images/queries";
import { parseItemVariants, variantDetailForSku, variantSelectOptions } from "@/lib/items/variants";
import {
  BATAS_QTY_INDEN,
  keadaanJendela,
  ringkasPesananJendela,
  type KeadaanInden,
  type RingkasBarang,
} from "./inden";

/**
 * Bacaan pre-order (inden). Keadaan jendela selalu dihitung dari jam saat
 * dibaca (`keadaanJendela`), tidak pernah dari kolom.
 */

const SEMUA_STATUS_HIDUP = { not: "REJECTED" as const };

// ── Nama jendela untuk lencana pesanan ────────────────────────────────────

export type LencanaInden = { id: string; name: string; dirilis: boolean };

/** id jendela → nama + sudah dirilis atau belum. Satu kueri untuk satu halaman pesanan. */
export async function lencanaIndenById(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, LencanaInden>> {
  const unik = Array.from(new Set(ids.filter((v): v is string => typeof v === "string" && v !== "")));
  if (unik.length === 0) return new Map();
  const rows = await prisma.preorderWindow.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, releasedAt: true } });
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, dirilis: r.releasedAt !== null }]));
}

// ── Daftar jendela (kantor) ───────────────────────────────────────────────

export type BarisDaftarInden = {
  id: string;
  name: string;
  keadaan: KeadaanInden;
  opensAt: Date;
  closesAt: Date;
  shipFrom: Date | null;
  shipTo: Date | null;
  releasedAt: Date | null;
  jumlahBarang: number;
  rencana: number | null;
  dipesan: number;
  jumlahPesanan: number;
  menungguPersetujuan: number;
};

/**
 * Semua jendela, terbaru dulu. Tabelnya kecil (beberapa jendela per musim),
 * jadi disaring keadaan di sini setelah dihitung — keadaan bukan kolom.
 */
export async function daftarJendelaInden(opsi: { keadaan?: KeadaanInden; cari?: string } = {}): Promise<BarisDaftarInden[]> {
  const cari = opsi.cari?.trim();
  const jendela = await prisma.preorderWindow.findMany({
    where: cari ? { name: cariTeks(cari) } : {},
    orderBy: [{ opensAt: "desc" }, { createdAt: "desc" }],
  });
  if (jendela.length === 0) return [];
  const ids = jendela.map((j) => j.id);
  const [barang, pesanan] = await Promise.all([
    prisma.preorderWindowItem.findMany({ where: { windowId: { in: ids } }, select: { windowId: true, itemId: true, plannedQty: true } }),
    prisma.fieldSalesOrder.findMany({
      where: { preorderWindowId: { in: ids }, status: SEMUA_STATUS_HIDUP },
      select: {
        preorderWindowId: true,
        status: true,
        lines: { select: { itemId: true, variantSku: true, qty: true, cancelledQty: true } },
      },
    }),
  ]);

  const now = new Date();
  return jendela
    .map((j) => {
      const barangJ = barang.filter((b) => b.windowId === j.id);
      const pesananJ = pesanan.filter((p) => p.preorderWindowId === j.id);
      const ringkas = ringkasPesananJendela(
        barangJ,
        pesananJ.flatMap((p) => p.lines.map((l) => ({ ...l, status: p.status }))),
      );
      return {
        id: j.id,
        name: j.name,
        keadaan: keadaanJendela(j, now),
        opensAt: j.opensAt,
        closesAt: j.closesAt,
        shipFrom: j.shipFrom,
        shipTo: j.shipTo,
        releasedAt: j.releasedAt,
        jumlahBarang: barangJ.length,
        rencana: ringkas.total.rencana,
        dipesan: ringkas.total.dipesan,
        jumlahPesanan: pesananJ.length,
        menungguPersetujuan: pesananJ.filter((p) => p.status === "PENDING_APPROVAL").length,
      };
    })
    .filter((r) => !opsi.keadaan || r.keadaan === opsi.keadaan);
}

// ── Rincian jendela (kantor) ──────────────────────────────────────────────

export type BarangRincianInden = RingkasBarang & {
  sku: string;
  nameId: string;
  categoryName: string | null;
  isActive: boolean;
  perVarianBerlabel: Array<RingkasBarang["perVarian"][number] & { label: string | null }>;
};

export type PesananRincianInden = {
  id: string;
  orderNo: string;
  storeName: string;
  salesmanName: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  deliveryStatus: "PENDING" | "PARTIAL" | "DELIVERED" | "CLOSED";
  total: number;
  pcs: number;
  createdAt: Date;
};

export type RincianJendelaInden = {
  id: string;
  name: string;
  note: string | null;
  keadaan: KeadaanInden;
  opensAt: Date;
  closesAt: Date;
  shipFrom: Date | null;
  shipTo: Date | null;
  isActive: boolean;
  releasedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
  barang: BarangRincianInden[];
  total: { rencana: number | null; dipesan: number };
  pesanan: PesananRincianInden[];
};

export async function rincianJendelaInden(id: string): Promise<RincianJendelaInden | null> {
  const j = await prisma.preorderWindow.findUnique({ where: { id } });
  if (!j) return null;
  const [barangJ, pesanan, pembuat] = await Promise.all([
    prisma.preorderWindowItem.findMany({ where: { windowId: id }, select: { itemId: true, plannedQty: true } }),
    prisma.fieldSalesOrder.findMany({
      where: { preorderWindowId: id },
      orderBy: [{ createdAt: "desc" }, { orderNo: "desc" }],
      select: {
        id: true,
        orderNo: true,
        status: true,
        deliveryStatus: true,
        total: true,
        createdAt: true,
        store: { select: { name: true } },
        salesman: { select: { name: true } },
        lines: { select: { itemId: true, variantSku: true, qty: true, cancelledQty: true } },
      },
    }),
    prisma.user.findUnique({ where: { id: j.createdById }, select: { name: true } }),
  ]);
  const items = await prisma.item.findMany({
    where: { id: { in: barangJ.map((b) => b.itemId) } },
    select: { id: true, sku: true, nameId: true, isActive: true, variants: true, category: { select: { name: true } } },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  // Urut SKU supaya tabel stabil antara dua pembukaan halaman.
  const barangUrut = [...barangJ].sort((a, b) => (itemById.get(a.itemId)?.sku ?? "").localeCompare(itemById.get(b.itemId)?.sku ?? ""));
  const ringkas = ringkasPesananJendela(
    barangUrut,
    pesanan.flatMap((p) => p.lines.map((l) => ({ ...l, status: p.status }))),
  );

  return {
    id: j.id,
    name: j.name,
    note: j.note,
    keadaan: keadaanJendela(j, new Date()),
    opensAt: j.opensAt,
    closesAt: j.closesAt,
    shipFrom: j.shipFrom,
    shipTo: j.shipTo,
    isActive: j.isActive,
    releasedAt: j.releasedAt,
    createdAt: j.createdAt,
    createdByName: pembuat?.name ?? null,
    barang: ringkas.perBarang.map((r) => {
      const it = itemById.get(r.itemId);
      return {
        ...r,
        sku: it?.sku ?? "—",
        nameId: it?.nameId ?? "—",
        categoryName: it?.category?.name ?? null,
        isActive: it?.isActive ?? false,
        perVarianBerlabel: r.perVarian.map((v) => ({ ...v, label: v.variantSku ? variantDetailForSku(it?.variants, v.variantSku) : null })),
      };
    }),
    total: ringkas.total,
    pesanan: pesanan.map((p) => ({
      id: p.id,
      orderNo: p.orderNo,
      storeName: p.store.name,
      salesmanName: p.salesman.name ?? "—",
      status: p.status,
      deliveryStatus: p.deliveryStatus,
      total: Number(p.total),
      pcs: p.lines.reduce((s, l) => s + l.qty - l.cancelledQty, 0),
      createdAt: p.createdAt,
    })),
  };
}

/** Barang yang boleh dimasukkan ke jendela: barang jadi yang aktif. */
export async function pilihanBarangInden(): Promise<Array<{ id: string; sku: string; nameId: string; categoryName: string | null }>> {
  const rows = await prisma.item.findMany({
    where: { isActive: true, type: "FINISHED_GOOD" },
    orderBy: { sku: "asc" },
    select: { id: true, sku: true, nameId: true, category: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, sku: r.sku, nameId: r.nameId, categoryName: r.category?.name ?? null }));
}

// ── Untuk aplikasi salesman ───────────────────────────────────────────────

export type JendelaTerbuka = {
  id: string;
  name: string;
  closesAt: Date;
  shipFrom: Date | null;
  shipTo: Date | null;
  itemIds: string[];
};

/**
 * Jendela yang sedang BUKA, tutup paling cepat dulu. Satu daftar untuk semua
 * toko PUTUS — jendela tidak dicakup per toko.
 */
export async function jendelaIndenTerbuka(now: Date = new Date()): Promise<JendelaTerbuka[]> {
  const rows = await prisma.preorderWindow.findMany({
    where: { isActive: true, releasedAt: null, opensAt: { lte: now }, closesAt: { gt: now } },
    orderBy: [{ closesAt: "asc" }, { name: "asc" }],
    select: { id: true, name: true, opensAt: true, closesAt: true, isActive: true, releasedAt: true, shipFrom: true, shipTo: true },
  });
  // Dinilai ulang dengan aturan murni yang sama — saringan SQL di atas hanya mempersempit.
  const buka = rows.filter((r) => keadaanJendela(r, now) === "BUKA");
  if (buka.length === 0) return [];
  const barang = await prisma.preorderWindowItem.findMany({ where: { windowId: { in: buka.map((b) => b.id) } }, select: { windowId: true, itemId: true } });
  return buka.map((r) => ({
    id: r.id,
    name: r.name,
    closesAt: r.closesAt,
    shipFrom: r.shipFrom,
    shipTo: r.shipTo,
    itemIds: barang.filter((b) => b.windowId === r.id).map((b) => b.itemId),
  }));
}

/** Bentuk barang katalog HP — sama dengan `CatalogItem` di CatalogShell. */
export type ItemKatalogInden = {
  itemId: string;
  sku: string;
  nameId: string;
  categoryId: string | null;
  categoryName: string | null;
  primaryImageUrl: string | null;
  available: number;
  price: number | null;
  priceLabel: string | null;
  neverSent: boolean;
  minOrderQty: number;
  variants: Array<{ variantSku: string; variantLabel: string; available: number }>;
};

export type JendelaKatalog = {
  id: string;
  name: string;
  keadaan: KeadaanInden;
  closesAt: Date;
  shipFrom: Date | null;
  shipTo: Date | null;
  items: ItemKatalogInden[];
};

/**
 * Isi katalog pre-order untuk satu toko PUTUS. Harga sama dengan katalog biasa
 * (harga toko PUTUS). Varian diambil dari definisi barang (`Item.variants`)
 * DITAMBAH varian yang sudah punya baris persediaan — barang pre-order sering
 * belum punya stok sama sekali, jadi daftar varian dari stok saja akan kosong.
 * `available` diisi batas langkah, bukan stok: pre-order tidak dibatasi stok.
 *
 * Hanya dipanggil untuk toko PUTUS — harga konsinyasi tidak pernah dikirim ke HP.
 */
export async function jendelaUntukKatalog(
  windowId: string,
  store: { termsType: "PUTUS" | "KONSI"; marginPercent: number | null },
): Promise<JendelaKatalog | null> {
  if (store.termsType !== "PUTUS") return null;
  const j = await prisma.preorderWindow.findUnique({ where: { id: windowId } });
  if (!j) return null;
  const barang = await prisma.preorderWindowItem.findMany({ where: { windowId }, select: { itemId: true } });
  const [rows, g] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: barang.map((b) => b.itemId) }, isActive: true, type: "FINISHED_GOOD" },
      orderBy: { nameId: "asc" },
      select: {
        id: true,
        sku: true,
        nameId: true,
        categoryId: true,
        category: { select: { name: true } },
        sellingPrice: true,
        minOrderQty: true,
        variants: true,
        inventoryValues: { select: { variantSku: true } },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: "putus.minOrderQty" } }),
  ]);
  const globalMin = g ? Number(g.value) : 6;
  const images = await getPrimaryImagesBatch(rows.map((r) => ({ itemId: r.id, variantSku: null })));

  const items = rows.map((r): ItemKatalogInden => {
    const { price, label } = computeStorePrice({
      sellingPrice: r.sellingPrice === null ? null : Number(r.sellingPrice),
      termsType: "PUTUS",
      marginPercent: store.marginPercent,
    });
    const definisi = variantSelectOptions(parseItemVariants(r.variants));
    const labelBySku = new Map(definisi.map((o) => [o.sku, o.label]));
    const skus = new Set(definisi.map((o) => o.sku));
    for (const iv of r.inventoryValues) if (iv.variantSku) skus.add(iv.variantSku);
    const variants = Array.from(skus)
      .map((variantSku) => ({ variantSku, variantLabel: labelBySku.get(variantSku) ?? variantSku, available: BATAS_QTY_INDEN }))
      .sort((a, b) => a.variantLabel.localeCompare(b.variantLabel));
    return {
      itemId: r.id,
      sku: r.sku,
      nameId: r.nameId,
      categoryId: r.categoryId,
      categoryName: r.category?.name ?? null,
      primaryImageUrl: images.get(`${r.id}|`) ?? null,
      available: BATAS_QTY_INDEN,
      price,
      priceLabel: label,
      neverSent: false,
      minOrderQty: r.minOrderQty ?? globalMin,
      variants,
    };
  });

  return {
    id: j.id,
    name: j.name,
    keadaan: keadaanJendela(j, new Date()),
    closesAt: j.closesAt,
    shipFrom: j.shipFrom,
    shipTo: j.shipTo,
    items,
  };
}
