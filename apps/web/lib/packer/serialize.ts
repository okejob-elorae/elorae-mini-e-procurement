import type { PackingVideoListItem } from "./queries";

export type PackerListItem = {
  id: string;
  videoUrl: string;
  durationSec: number | null;
  recordedAt: string;
  salesOrder: {
    id: string;
    salesorderNo: string;
    channelOrderNo: string | null;
    customerName: string | null;
    transactionDate: string;
    trackingNumber: string | null;
    latestReturnAt: string | null;
  };
};

export function serializePackingVideos(
  items: PackingVideoListItem[],
): PackerListItem[] {
  return items.map((item) => ({
    id: item.id,
    videoUrl: item.videoUrl,
    durationSec: item.durationSec,
    recordedAt: item.recordedAt.toISOString(),
    salesOrder: {
      id: item.salesOrder.id,
      salesorderNo: item.salesOrder.salesorderNo,
      channelOrderNo: item.salesOrder.channelOrderNo,
      customerName: item.salesOrder.customerName,
      transactionDate: item.salesOrder.transactionDate.toISOString(),
      trackingNumber: item.salesOrder.trackingNumber,
      latestReturnAt: item.salesOrder.latestReturnAt?.toISOString() ?? null,
    },
  }));
}
