import { prisma, type Prisma } from "@elorae/db";
import { bacaPesananKonsiLama } from "./antaran-queries";

/**
 * Kiriman barang ke toko, dari beberapa sumber, dalam satu bentuk.
 *
 * - PUTUS_DELIVERY  : pengiriman pesanan putus (`FieldSalesDelivery`).
 * - KONSI_TRANSFER  : SATU ANTARAN pesanan konsinyasi — `KonsiTransfer` yang
 *                     dibuat saat pengiriman (`DeliveryShipment`) selesai, sebesar
 *                     yang diserahkan di antaran itu. Pesanan 100 pcs yang datang
 *                     60 lalu 40 = dua kiriman, diterima sendiri-sendiri.
 * - KONSI_ORDER     : HANYA pesanan konsinyasi LAMA, yang stoknya keluar saat
 *                     disetujui tanpa pengiriman (`bacaPesananKonsiLama`) — tetap
 *                     diterima sekali per pesanan. Pesanan aturan baru tidak
 *                     pernah terbuka di sini: persetujuan hanya mencadangkan.
 * - KONSI_SHIPMENT  : kiriman modul konsinyasi (`ConsignmentShipment`); barisnya
 *                     boleh tanpa `itemId` (diketik nama saja).
 * - MUTASI          : mutasi dari toko lain (`StoreTransfer`) yang sudah DIKIRIM
 *                     ke toko ini.
 * - MUTASI_KEMBALI  : mutasi toko ini yang dibatalkan kantor sesudah dikirim
 *                     (DIKEMBALIKAN) — barangnya kembali dan diterima toko asal.
 *
 * Jumlah yang DIKIRIM selalu dibaca dari dokumen sumbernya di server — layar
 * SPG hanya mengirim jumlah yang DITERIMA. Untuk antaran, "dikirim" adalah yang
 * diserahkan di antaran itu, bukan jumlah pesanan: sisa pesanan yang belum
 * dikirim gudang tidak pernah menjadi kekurangan.
 */

export type JenisKiriman = "PUTUS_DELIVERY" | "KONSI_TRANSFER" | "KONSI_ORDER" | "KONSI_SHIPMENT" | "MUTASI" | "MUTASI_KEMBALI";
export const JENIS_KIRIMAN: JenisKiriman[] = ["PUTUS_DELIVERY", "KONSI_TRANSFER", "KONSI_ORDER", "KONSI_SHIPMENT", "MUTASI", "MUTASI_KEMBALI"];

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
  /** Nomor pesanan asal (pengiriman putus, antaran konsinyasi); hanya untuk ditampilkan. */
  pesananNo?: string | null;
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
        order: { select: { orderNo: true } },
        lines: { select: { id: true, itemId: true, variantSku: true, productName: true, qty: true } },
      },
    });
    if (!d) return null;
    return {
      sourceType,
      sourceId: d.id,
      docNo: d.docNo,
      tanggal: d.deliveredAt,
      pesananNo: d.order.orderNo,
      lines: d.lines.map((l) => ({ lineId: l.id, itemId: l.itemId, variantSku: l.variantSku ?? "", productName: l.productName, qty: l.qty })),
    };
  }
  if (sourceType === "KONSI_TRANSFER") {
    // Hanya antaran yang lahir dari pengiriman. Transfer lama tanpa pengiriman
    // (stok keluar saat disetujui) diterima lewat pesanannya (`KONSI_ORDER`).
    const t = await klien.konsiTransfer.findFirst({
      where: { id: sourceId, storeId, shipmentId: { not: null } },
      select: {
        id: true,
        docNo: true,
        createdAt: true,
        order: { select: { orderNo: true } },
        shipment: { select: { docNo: true, deliveredAt: true } },
        lines: { select: { id: true, itemId: true, variantSku: true, productName: true, qty: true } },
      },
    });
    if (!t) return null;
    return {
      sourceType,
      sourceId: t.id,
      // Nomor pengiriman: itu yang tertulis di surat jalan yang dibawa pengantar.
      docNo: t.shipment?.docNo ?? t.docNo,
      tanggal: t.shipment?.deliveredAt ?? t.createdAt,
      pesananNo: t.order.orderNo,
      lines: t.lines
        .map((l) => ({ lineId: l.id, itemId: l.itemId, variantSku: l.variantSku ?? "", productName: l.productName, qty: Math.round(Number(l.qty)) }))
        .filter((l) => l.qty > 0),
    };
  }
  if (sourceType === "KONSI_ORDER") {
    // Pesanan aturan baru tidak pernah diterima per pesanan — antarannya yang diterima.
    if (!(await bacaPesananKonsiLama(klien, [sourceId])).lama.has(sourceId)) return null;
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
      items: { select: { id: true, itemId: true, variantSku: true, itemName: true, qty: true } },
    },
  });
  if (!k) return null;
  return {
    sourceType,
    sourceId: k.id,
    docNo: k.noKirim,
    tanggal: k.shippedAt,
    // Varian kiriman diteruskan ke tanda terima: stok titipan dan buku toko dihitung per ukuran.
    lines: k.items.map((l) => ({ lineId: l.id, itemId: l.itemId, variantSku: l.variantSku ?? "", productName: l.itemName, qty: l.qty })),
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

  const [putus, antaran, konsiCalon, kirim, diterima, mutasi] = await Promise.all([
    prisma.fieldSalesDelivery.findMany({
      where: { order: { storeId }, deliveredAt: { gte: sejak } },
      select: { id: true },
    }),
    // Antaran konsinyasi: satu per pengiriman yang selesai, sebesar yang diserahkan.
    prisma.konsiTransfer.findMany({
      where: { storeId, shipmentId: { not: null }, createdAt: { gte: sejak } },
      select: { id: true },
    }),
    // Calon pesanan konsi LAMA — disaring `bacaPesananKonsiLama` di bawah.
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

  const konsiLama = (await bacaPesananKonsiLama(prisma, konsiCalon.map((o) => o.id))).lama;
  const sudah = new Set(diterima.map((r) => `${r.sourceType}:${r.sourceId}`));
  const calon: { sourceType: JenisKiriman; sourceId: string }[] = [
    ...putus.map((d) => ({ sourceType: "PUTUS_DELIVERY" as const, sourceId: d.id })),
    ...antaran.map((t) => ({ sourceType: "KONSI_TRANSFER" as const, sourceId: t.id })),
    ...konsiCalon.filter((o) => konsiLama.has(o.id)).map((o) => ({ sourceType: "KONSI_ORDER" as const, sourceId: o.id })),
    ...kirim.map((k) => ({ sourceType: "KONSI_SHIPMENT" as const, sourceId: k.id })),
    ...mutasi.map((m) => ({ sourceType: m.toStoreId === storeId ? ("MUTASI" as const) : ("MUTASI_KEMBALI" as const), sourceId: m.id })),
  ].filter((c) => !sudah.has(`${c.sourceType}:${c.sourceId}`));

  const hasil = await Promise.all(calon.map((c) => muatKiriman(prisma, storeId, c.sourceType, c.sourceId)));
  return hasil
    .filter((k): k is Kiriman => k !== null && k.lines.length > 0)
    .sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime());
}
