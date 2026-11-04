import { prisma, seededId, seededIds } from "@elorae/db";
import {
  createDeliveryShipment,
  shipDeliveryShipment,
  updateShipmentTracking,
} from "./shipment-writer";

/**
 * UNTUK TES SAJA — bahan basis data bersama untuk tes pengiriman gudang → toko (pengiriman putus
 * dan konsi, penerimaan toko, "tidak jadi dikirim"). Jangan dipanggil kode aplikasi.
 *
 * Satu pesanan APPROVED langsung ditulis (tanpa alur buat/setujui) dengan cadangan stoknya — yang
 * dibutuhkan pembuatan pengiriman: putus `FIELD_SALES`, konsi `FIELD_SALES_KONSI`, keduanya RESERVED
 * dan `reservedQty` gudang sebesar jumlah pesanan. `approvedAt` = sekarang, jadi pesanan konsi ini
 * bukan "pesanan konsi lama". Aktor = salesman bibit (`salesman@elorae.com`, tidak pernah dihapus);
 * SPG toko dibuat baru bila diminta dan dihapus di `bersihkan`.
 *
 * `bersihkan` menghapus semua yang ditulis tes di sekitar pesanan ini dengan id yang EKSPLISIT
 * (`seededId`/`seededIds`), urutannya mengikuti relasi: penerimaan & barang hilang, buku toko,
 * transfer konsi SEBELUM pengiriman, pengiriman SEBELUM nota, nota & piutang, stok, pesanan.
 */

export type PesananUji = {
  token: string;
  mulai: Date;
  uomId: string;
  itemId: string;
  invId: string;
  storeId: string;
  salesmanId: string;
  spgId: string;
  orderId: string;
  lineIds: string[];
};

export async function buatPesananUji(opsi: {
  termsType: "PUTUS" | "KONSI";
  qty: number[];
  unitPrice?: number;
  onHand?: number;
  avgCost?: number;
  spg?: boolean;
  pemegang?: boolean;
  lokasi?: { lat: number; lng: number; radius: number };
}): Promise<PesananUji> {
  const token = Math.random().toString(36).slice(2, 10);
  const mulai = new Date(Date.now() - 1000);
  const unitPrice = opsi.unitPrice ?? 10000;
  const jumlah = opsi.qty.reduce((n, q) => n + q, 0);
  const salesman = await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } });

  const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-UP-${token}`, nameId: "pcs", nameEn: "pcs" } });
  const item = await prisma.item.create({
    data: { sku: `TEST-UP-${token}`, nameId: "Barang uji", nameEn: "Test item", type: "FINISHED_GOOD", isActive: true, uomId: uom.id, sellingPrice: unitPrice },
  });
  const avgCost = opsi.avgCost ?? 4000;
  const onHand = opsi.onHand ?? jumlah + 10;
  const inv = await prisma.inventoryValue.create({
    data: { itemId: item.id, variantSku: "", qtyOnHand: onHand, reservedQty: jumlah, avgCost, totalValue: onHand * avgCost },
  });
  const store = await prisma.store.create({
    data: {
      code: `TEST-UP-STORE-${token}`,
      name: `Toko uji ${token}`,
      address: "Alamat uji",
      termsType: opsi.termsType,
      paymentTempo: 30,
      isActive: true,
      ...(opsi.termsType === "KONSI" ? { markupPercent: 20 } : {}),
      ...(opsi.pemegang ? { salesmanId: salesman.id } : {}),
      ...(opsi.lokasi ? { lat: opsi.lokasi.lat, lng: opsi.lokasi.lng, checkinRadiusMeters: opsi.lokasi.radius } : {}),
    },
  });
  let spgId = "";
  if (opsi.spg) {
    const spg = await prisma.user.create({
      data: { email: `test-up-spg-${token}@example.com`, name: "SPG uji", assignedStoreId: store.id },
    });
    spgId = spg.id;
  }
  const order = await prisma.fieldSalesOrder.create({
    data: {
      orderNo: `${opsi.termsType}/TEST-UP-${token}`,
      storeId: store.id,
      salesmanId: salesman.id,
      status: "APPROVED",
      approvedAt: new Date(),
      orderType: opsi.termsType,
      subtotal: jumlah * unitPrice,
      total: jumlah * unitPrice,
      lines: {
        create: opsi.qty.map((q, i) => ({
          itemId: item.id,
          variantSku: "",
          productName: `Barang uji ${i + 1}`,
          qty: q,
          unitPrice,
          lineTotal: q * unitPrice,
        })),
      },
    },
    include: { lines: { orderBy: { productName: "asc" } } },
  });
  for (const l of order.lines) {
    await prisma.stockReservation.create({
      data: {
        source: opsi.termsType === "KONSI" ? "FIELD_SALES_KONSI" : "FIELD_SALES",
        fieldSalesLineId: l.id,
        itemId: item.id,
        variantSku: "",
        qty: l.qty,
        state: "RESERVED",
      },
    });
  }
  return {
    token,
    mulai,
    uomId: uom.id,
    itemId: item.id,
    invId: inv.id,
    storeId: store.id,
    salesmanId: salesman.id,
    spgId,
    orderId: order.id,
    lineIds: order.lines.map((l) => l.id),
  };
}

/** Jatuh tempo uji: jauh di depan, jadi tidak pernah sebelum tanggal nota (hari ini WIB). */
export const JATUH_TEMPO_UJI = new Date("2099-12-31T00:00:00.000+07:00");

/** Membuat satu pengiriman (dikemas) untuk pesanan uji. */
export async function kemasUji(
  p: PesananUji,
  opsi: { method?: "EXPEDITION" | "SALESMAN_CARRY"; lines?: Array<{ orderLineId: string; qty: number }>; kunci?: string } = {},
) {
  return createDeliveryShipment({
    orderId: p.orderId,
    method: opsi.method ?? "EXPEDITION",
    lines: opsi.lines ?? [{ orderLineId: p.lineIds[0], qty: 1 }],
    packedById: p.salesmanId,
    idempotencyKey: opsi.kunci ?? `uji-${p.token}-${Math.random().toString(36).slice(2, 10)}`,
    dueDate: JATUH_TEMPO_UJI,
  });
}

/** Melengkapi resi, berat, dan foto serah ke kurir sebuah pengiriman ekspedisi, lalu mengirimnya. */
export async function berangkatkanUji(p: PesananUji, shipmentId: string, opsi: { kirim?: boolean } = {}) {
  await updateShipmentTracking({
    shipmentId,
    carrierName: "JNE",
    resiNumber: `RESI-${p.token}`,
    weightKg: 2.5,
    handoverPhotoUrl: `https://r2.test/delivery-handover/${shipmentId}/1.jpg`,
    handoverPhotoR2Key: `delivery-handover/${shipmentId}/1.jpg`,
  });
  if (opsi.kirim !== false) await shipDeliveryShipment({ shipmentId, shippedById: p.salesmanId });
}

/** Isian konfirmasi ekspedisi untuk pengiriman ekspedisi uji. */
export function podEkspedisiUji(
  shipmentId: string,
  deliveredById: string,
  lines: Array<{ shipmentLineId: string; deliveredQty: number; returnedQty?: number; lostQty?: number }>,
) {
  return {
    shipmentId,
    deliveredById,
    proofPhotoUrl: `https://r2.test/delivery-proofs/${shipmentId}/1.jpg`,
    proofPhotoR2Key: `delivery-proofs/${shipmentId}/1.jpg`,
    lines,
  };
}

export async function bersihkanPesananUji(p: PesananUji | null): Promise<void> {
  if (!p) return;
  const shipments = await prisma.deliveryShipment.findMany({ where: { orderId: seededId(p.orderId) }, select: { id: true } });
  const shipmentIds = shipments.map((s) => s.id);
  const deliveries = await prisma.fieldSalesDelivery.findMany({ where: { orderId: seededId(p.orderId) }, select: { id: true } });
  const deliveryIds = deliveries.map((d) => d.id);
  const transfers = await prisma.konsiTransfer.findMany({ where: { orderId: seededId(p.orderId) }, select: { id: true } });
  const transferIds = transfers.map((t) => t.id);
  const receivables = await prisma.receivable.findMany({ where: { storeId: seededId(p.storeId) }, select: { id: true } });
  const receivableIds = receivables.map((r) => r.id);
  const losses = await prisma.stockLoss.findMany({ where: { storeId: seededId(p.storeId) }, select: { id: true } });
  const lossIds = losses.map((l) => l.id);
  const receipts = await prisma.storeReceipt.findMany({ where: { storeId: seededId(p.storeId) }, select: { id: true } });
  const receiptIds = receipts.map((r) => r.id);

  /* Notifikasi yang ditulis tes ini: metadata JSON, jadi dicocokkan di JS lalu dihapus per id. */
  const kenal = [p.orderId, p.storeId, ...shipmentIds, ...deliveryIds, ...transferIds, ...lossIds].filter(Boolean);
  const notif = await prisma.adminNotification.findMany({ where: { createdAt: { gte: p.mulai } }, select: { id: true, metadata: true } });
  const notifIds = notif.filter((n) => kenal.some((id) => JSON.stringify(n.metadata ?? {}).includes(id))).map((n) => n.id);
  if (notifIds.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });

  await prisma.auditLog.deleteMany({
    where: {
      entityId: { in: seededIds([p.orderId, ...shipmentIds, ...deliveryIds, ...transferIds, ...receivableIds, ...lossIds, ...receiptIds].filter(Boolean)) },
    },
  });
  if (p.spgId) await prisma.auditLog.deleteMany({ where: { userId: seededId(p.spgId) } });

  const shares = await prisma.stockLossShare.findMany({ where: { lossId: { in: seededIds(lossIds) } }, select: { id: true } });
  await prisma.stockLossDeduction.deleteMany({ where: { shareId: { in: seededIds(shares.map((x) => x.id)) } } });
  await prisma.stockLossShare.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
  await prisma.stockLossLine.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
  await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(lossIds) } } });
  await prisma.storeReceiptLine.deleteMany({ where: { receiptId: { in: seededIds(receiptIds) } } });
  await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds(receiptIds) } } });
  await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(p.storeId) } });
  await prisma.storeStock.deleteMany({ where: { storeId: seededId(p.storeId) } });
  await prisma.salesHistory.deleteMany({ where: { itemId: seededId(p.itemId) } });

  await prisma.konsiTransferLine.deleteMany({ where: { transferId: { in: seededIds(transferIds) } } });
  await prisma.konsiTransfer.deleteMany({ where: { id: { in: seededIds(transferIds) } } });
  await prisma.deliveryShipmentLine.deleteMany({ where: { shipmentId: { in: seededIds(shipmentIds) } } });
  await prisma.deliveryShipment.deleteMany({ where: { id: { in: seededIds(shipmentIds) } } });
  /* Laporan pembayaran / kontrabon yang ditulis tes penolakan "tidak jadi dikirim". */
  await prisma.paymentClaimReceivable.deleteMany({ where: { receivableId: { in: seededIds(receivableIds) } } });
  await prisma.paymentClaim.deleteMany({ where: { storeId: seededId(p.storeId) } });
  await prisma.collectionNoteReceivable.deleteMany({ where: { receivableId: { in: seededIds(receivableIds) } } });
  await prisma.collectionNote.deleteMany({ where: { storeId: seededId(p.storeId) } });
  await prisma.taxInvoice.deleteMany({ where: { deliveryId: { in: seededIds(deliveryIds) } } });
  for (const id of receivableIds) await prisma.receivable.delete({ where: { id: seededId(id) } });
  await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: { in: seededIds(deliveryIds) } } });
  await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });

  await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(p.itemId) } });
  await prisma.stockReservation.deleteMany({ where: { itemId: seededId(p.itemId) } });
  await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(p.itemId) } });
  await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(p.itemId) } });
  await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(p.orderId) } });
  await prisma.fieldSalesOrder.delete({ where: { id: seededId(p.orderId) } });
  await prisma.storeVisit.deleteMany({ where: { storeId: seededId(p.storeId) } });
  await prisma.item.delete({ where: { id: seededId(p.itemId) } });
  await prisma.uOM.delete({ where: { id: seededId(p.uomId) } });
  await prisma.store.delete({ where: { id: seededId(p.storeId) } });
  if (p.spgId) await prisma.user.delete({ where: { id: seededId(p.spgId) } });
}
