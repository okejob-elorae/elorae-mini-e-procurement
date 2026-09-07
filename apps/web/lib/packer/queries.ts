import { prisma } from "@elorae/db";
import { pickBestTrackingMatch } from "@/lib/packer/barcode";

export type PackingVideoListItem = {
  id: string;
  videoUrl: string;
  durationSec: number | null;
  recordedAt: Date;
  contentType: string;
  salesOrder: {
    id: string;
    salesorderNo: string;
    channelOrderNo: string | null;
    customerName: string | null;
    transactionDate: Date;
    trackingNumber: string | null;
    latestReturnAt: Date | null;
  };
};

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function listPackingVideos(limit = 50): Promise<PackingVideoListItem[]> {
  const rows = await prisma.packingVideo.findMany({
    orderBy: { recordedAt: "desc" },
    take: limit,
    select: {
      id: true,
      videoUrl: true,
      durationSec: true,
      recordedAt: true,
      contentType: true,
      salesOrder: {
        select: {
          id: true,
          salesorderNo: true,
          channelOrderNo: true,
          customerName: true,
          transactionDate: true,
          trackingNumber: true,
          salesReturns: {
            select: { receivedAt: true },
            orderBy: { receivedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    videoUrl: row.videoUrl,
    durationSec: toNum(row.durationSec),
    recordedAt: row.recordedAt,
    contentType: row.contentType,
    salesOrder: {
      id: row.salesOrder.id,
      salesorderNo: row.salesOrder.salesorderNo,
      channelOrderNo: row.salesOrder.channelOrderNo,
      customerName: row.salesOrder.customerName,
      transactionDate: row.salesOrder.transactionDate,
      trackingNumber: row.salesOrder.trackingNumber,
      latestReturnAt: row.salesOrder.salesReturns[0]?.receivedAt ?? null,
    },
  }));
}

export type PackerOrderOption = {
  id: string;
  salesorderNo: string;
  channelOrderNo: string | null;
  customerName: string | null;
  transactionDate: Date;
  trackingNumber: string | null;
  channel: string;
  status: string;
  grandTotal: string;
  itemCount: number;
};

/** Orders waiting to be packed/recorded: have resi, not canceled, no packing video yet. */
export type PackerPoolOrder = {
  id: string;
  salesorderNo: string;
  channelOrderNo: string | null;
  customerName: string | null;
  trackingNumber: string;
  courier: string | null;
  transactionDate: Date;
  channel: string;
};

export async function listPackerPoolOrders(take = 200): Promise<PackerPoolOrder[]> {
  const rows = await prisma.salesOrder.findMany({
    where: {
      isCanceled: false,
      packingVideo: null,
      AND: [
        { trackingNumber: { not: null } },
        { NOT: { trackingNumber: "" } },
      ],
    },
    orderBy: { transactionDate: "desc" },
    take,
    select: {
      id: true,
      salesorderNo: true,
      channelOrderNo: true,
      customerName: true,
      trackingNumber: true,
      courier: true,
      transactionDate: true,
      channel: true,
    },
  });

  return rows
    .filter((r): r is typeof r & { trackingNumber: string } => Boolean(r.trackingNumber?.trim()))
    .map((r) => ({
      id: r.id,
      salesorderNo: r.salesorderNo,
      channelOrderNo: r.channelOrderNo,
      customerName: r.customerName,
      trackingNumber: r.trackingNumber.trim(),
      courier: r.courier,
      transactionDate: r.transactionDate,
      channel: String(r.channel),
    }));
}

/** Resolve order by scanned tracking / resi (exact or LIKE / contains). */
export async function findSalesOrderByTrackingNumber(
  trackingRaw: string,
): Promise<{ id: string; trackingNumber: string; salesorderNo: string } | null> {
  const key = trackingRaw.trim();
  if (!key) return null;

  const rows = await prisma.salesOrder.findMany({
    where: {
      isCanceled: false,
      AND: [
        { trackingNumber: { not: null } },
        { NOT: { trackingNumber: "" } },
      ],
    },
    select: {
      id: true,
      trackingNumber: true,
      salesorderNo: true,
    },
    take: 500,
  });

  const candidates = rows.filter(
    (r): r is typeof r & { trackingNumber: string } => Boolean(r.trackingNumber?.trim()),
  );
  const hit = pickBestTrackingMatch(candidates, key, (r) => r.trackingNumber);
  if (!hit) return null;
  return {
    id: hit.id,
    trackingNumber: hit.trackingNumber.trim(),
    salesorderNo: hit.salesorderNo,
  };
}

/** Orders that do not yet have a packing video. */
export async function listOrdersWithoutPackingVideo(
  take = 100,
): Promise<PackerOrderOption[]> {
  const rows = await prisma.salesOrder.findMany({
    where: {
      packingVideo: null,
      isCanceled: false,
    },
    orderBy: { transactionDate: "desc" },
    take,
    select: {
      id: true,
      salesorderNo: true,
      channelOrderNo: true,
      customerName: true,
      transactionDate: true,
      trackingNumber: true,
      channel: true,
      status: true,
      grandTotal: true,
      _count: { select: { items: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    salesorderNo: r.salesorderNo,
    channelOrderNo: r.channelOrderNo,
    customerName: r.customerName,
    transactionDate: r.transactionDate,
    trackingNumber: r.trackingNumber,
    channel: String(r.channel),
    status: String(r.status),
    grandTotal: r.grandTotal.toString(),
    itemCount: r._count.items,
  }));
}

export type PackerOrderDetail = PackerOrderOption & {
  items: Array<{
    id: string;
    productName: string;
    qty: string;
    jubelioItemCode: string;
  }>;
  hasPackingVideo: boolean;
};

/** Temporary: attach packing videos to any available sales order (demo: 1 row). */
export async function getFallbackSalesOrderId(): Promise<string | null> {
  const row = await prisma.salesOrder.findFirst({
    where: { isCanceled: false },
    orderBy: { transactionDate: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function getPackerOrderDetail(
  salesOrderId: string,
): Promise<PackerOrderDetail | null> {
  const row = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      id: true,
      salesorderNo: true,
      channelOrderNo: true,
      customerName: true,
      transactionDate: true,
      trackingNumber: true,
      channel: true,
      status: true,
      grandTotal: true,
      packingVideo: { select: { id: true } },
      items: {
        select: {
          id: true,
          productName: true,
          qty: true,
          jubelioItemCode: true,
        },
        orderBy: { productName: "asc" },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    salesorderNo: row.salesorderNo,
    channelOrderNo: row.channelOrderNo,
    customerName: row.customerName,
    transactionDate: row.transactionDate,
    trackingNumber: row.trackingNumber,
    channel: String(row.channel),
    status: String(row.status),
    grandTotal: row.grandTotal.toString(),
    itemCount: row.items.length,
    hasPackingVideo: !!row.packingVideo,
    items: row.items.map((i) => ({
      id: i.id,
      productName: i.productName,
      qty: i.qty.toString(),
      jubelioItemCode: i.jubelioItemCode,
    })),
  };
}
