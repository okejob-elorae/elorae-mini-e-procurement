import { prisma, type Prisma } from "@elorae/db";

/**
 * Kiriman barang ke toko, dari tiga sumber, dalam satu bentuk.
 *
 * - PUTUS_DELIVERY  : pengiriman pesanan putus (`FieldSalesDelivery`).
 * - KONSI_ORDER     : pesanan konsinyasi yang disetujui — transfernya tercatat
 *                     saat disetujui (`FieldSalesOrder` KONSI APPROVED).
 * - KONSI_SHIPMENT  : kiriman modul konsinyasi (`ConsignmentShipment`); barisnya
 *                     boleh tanpa `itemId` (diketik nama saja).
 * - MUTASI          : mutasi dari toko lain (`StoreTransfer`) yang sudah DIKIRIM
 *                     ke toko ini.
 * - MUTASI_KEMBALI  : mutasi toko ini yang dibatalkan kantor sesudah dikirim
 *                     (DIKEMBALIKAN) — barangnya kembali dan diterima toko asal.
 *
 * Jumlah yang DIKIRIM selalu dibaca dari dokumen sumbernya di server — layar
 * SPG hanya mengirim jumlah yang DITERIMA.
 */

export type JenisKiriman = "PUTUS_DELIVERY" | "KONSI_ORDER" | "KONSI_SHIPMENT" | "MUTASI" | "MUTASI_KEMBALI";
export const JENIS_KIRIMAN: JenisKiriman[] = ["PUTUS_DELIVERY", "KONSI_ORDER", "KONSI_SHIPMENT", "MUTASI", "MUTASI_KEMBALI"];

/** Kiriman dari mutasi antar toko: stoknya bergerak sebagai MUTASI_MASUK, bukan TERIMA. */
export function dariMutasi(jenis: JenisKiriman): jenis is "MUTASI" | "MUTASI_KEMBALI" {
  return jenis === "MUTASI" || jenis === "MUTASI_KEMBALI";
}

export type BarisKiriman = {
  /** id baris di dokumen sumber — kunci jawaban jumlah diterima. */
  lineId: string;
  itemId: string | null;
  variantSku: string;
  productName: string;
  qty: number;
};

export type Kiriman = {
  sourceType: JenisKiriman;
  sourceId: string;
  docNo: string;
  tanggal: Date;
  lines: BarisKiriman[];
};

type Klien = Prisma.TransactionClient | typeof prisma;

/** Satu kiriman untuk toko ini, atau null kalau tidak ada / bukan milik toko ini. */
export async function muatKiriman(
  klien: Klien,
  storeId: string,
  sourceType: JenisKiriman,
  sourceId: string,
): Promise<Kiriman | null> {
  if (sourceType === "PUTUS_DELIVERY") {
    const d = await klien.fieldSalesDelivery.findFirst({
      where: { id: sourceId, order: { storeId } },
      select: {
        id: true,
        docNo: true,
        deliveredAt: true,
        lines: { select: { id: true, itemId: true, variantSku: true, productName: true, qty: true } },
      },
    });
    if (!d) return null;
    return {
      sourceType,
      sourceId: d.id,
      docNo: d.docNo,
      tanggal: d.deliveredAt,
      lines: d.lines.map((l) => ({ lineId: l.id, itemId: l.itemId, variantSku: l.variantSku ?? "", productName: l.productName, qty: l.qty })),
    };
  }
  if (sourceType === "KONSI_ORDER") {
    const o = await klien.fieldSalesOrder.findFirst({
      where: { id: sourceId, storeId, orderType: "KONSI", status: "APPROVED" },
      select: {
        id: true,
        orderNo: true,
        approvedAt: true,
        createdAt: true,
        lines: { select: { id: true, itemId: true, variantSku: true, productName: true, qty: true, cancelledQty: true } },
      },
    });
    if (!o) return null;
    return {
      sourceType,
      sourceId: o.id,
      docNo: o.orderNo,
      tanggal: o.approvedAt ?? o.createdAt,
      lines: o.lines
        .map((l) => ({ lineId: l.id, itemId: l.itemId, variantSku: l.variantSku ?? "", productName: l.productName, qty: l.qty - l.cancelledQty }))
        .filter((l) => l.qty > 0),
    };
  }
  if (dariMutasi(sourceType)) {
    // Status dibaca di sini juga: mutasi yang dibatalkan, dialihkan ke toko
    // lain, atau sudah diterima tidak bisa dibuka sebagai kiriman.
    const m = await klien.storeTransfer.findFirst({
      where:
        sourceType === "MUTASI"
          ? { id: sourceId, toStoreId: storeId, status: "DIKIRIM" }
          : { id: sourceId, fromStoreId: storeId, status: "DIKEMBALIKAN", shippedAt: { not: null } },
      select: {
        id: true,
        docNo: true,
        shippedAt: true,
        createdAt: true,
        lines: { orderBy: { productName: "asc" }, select: { id: true, itemId: true, variantSku: true, productName: true, qty: true } },
      },
    });
    if (!m) return null;
    return {
      sourceType,
      sourceId: m.id,
      docNo: m.docNo,
      tanggal: m.shippedAt ?? m.createdAt,
      lines: m.lines.map((l) => ({ lineId: l.id, itemId: l.itemId, variantSku: l.variantSku ?? "", productName: l.productName, qty: l.qty })),
    };
  }
  const k = await klien.consignmentShipment.findFirst({
    where: { id: sourceId, storeId },
    select: {
      id: true,
      noKirim: true,
      shippedAt: true,
      items: { select: { id: true, itemId: true, itemName: true, qty: true } },
    },
  });
  if (!k) return null;
  return {
    sourceType,
    sourceId: k.id,
    docNo: k.noKirim,
    tanggal: k.shippedAt,
    lines: k.items.map((l) => ({ lineId: l.id, itemId: l.itemId, variantSku: "", productName: l.itemName, qty: l.qty })),
  };
}

const HARI_MS = 86_400_000;
/** Toko yang belum mulai dilacak: kiriman sebulan terakhir yang ditawarkan. */
export const HARI_KIRIMAN_AWAL = 30;

/**
 * Kiriman ke toko yang belum diterima SPG.
 *
 * Sejak awal pelacakan toko (gerakan stok pertama) — kiriman sebelum itu sudah
 * lama ada di rak dan masuk lewat opname, bukan lewat penerimaan. Toko yang
 * belum mulai dilacak melihat kiriman 30 hari terakhir.
 */
export async function kirimanMenunggu(storeId: string, sekarang = new Date()): Promise<Kiriman[]> {
  const pertama = await prisma.storeStockMovement.findFirst({
    where: { storeId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const sejak = pertama?.createdAt ?? new Date(sekarang.getTime() - HARI_KIRIMAN_AWAL * HARI_MS);

  const [putus, konsi, kirim, diterima, mutasi] = await Promise.all([
    prisma.fieldSalesDelivery.findMany({
      where: { order: { storeId }, deliveredAt: { gte: sejak } },
      select: { id: true },
    }),
    prisma.fieldSalesOrder.findMany({
      where: { storeId, orderType: "KONSI", status: "APPROVED", approvedAt: { gte: sejak } },
      select: { id: true },
    }),
    prisma.consignmentShipment.findMany({
      where: { storeId, shippedAt: { gte: sejak } },
      select: { id: true },
    }),
    prisma.storeReceipt.findMany({ where: { storeId }, select: { sourceType: true, sourceId: true } }),
    // Mutasi TANPA jendela tanggal: kiriman antar toko selalu sesudah buku toko
    // asal dimulai, dan yang sedang di jalan harus diterima berapa pun umurnya.
    prisma.storeTransfer.findMany({
      where: {
        OR: [
          { toStoreId: storeId, status: "DIKIRIM" },
          { fromStoreId: storeId, status: "DIKEMBALIKAN", shippedAt: { not: null } },
        ],
      },
      select: { id: true, toStoreId: true },
    }),
  ]);

  const sudah = new Set(diterima.map((r) => `${r.sourceType}:${r.sourceId}`));
  const calon: { sourceType: JenisKiriman; sourceId: string }[] = [
    ...putus.map((d) => ({ sourceType: "PUTUS_DELIVERY" as const, sourceId: d.id })),
    ...konsi.map((o) => ({ sourceType: "KONSI_ORDER" as const, sourceId: o.id })),
    ...kirim.map((k) => ({ sourceType: "KONSI_SHIPMENT" as const, sourceId: k.id })),
    ...mutasi.map((m) => ({ sourceType: m.toStoreId === storeId ? ("MUTASI" as const) : ("MUTASI_KEMBALI" as const), sourceId: m.id })),
  ].filter((c) => !sudah.has(`${c.sourceType}:${c.sourceId}`));

  const hasil = await Promise.all(calon.map((c) => muatKiriman(prisma, storeId, c.sourceType, c.sourceId)));
  return hasil
    .filter((k): k is Kiriman => k !== null && k.lines.length > 0)
    .sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime());
}
