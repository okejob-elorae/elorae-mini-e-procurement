import { normalizeScanCode, pickBestTrackingMatch, trackingCodesMatch } from "@/lib/packer/barcode";

/** Pool row sourced from SalesOrder.trackingNumber (server). */
export type PackerPoolItem = {
  id: string;
  salesorderNo: string;
  channelOrderNo: string | null;
  customerName: string | null;
  trackingNumber: string;
  courier: string | null;
  transactionDate: string;
  channel: string;
};

export function poolTrackingKey(trackingNumber: string): string {
  return normalizeScanCode(trackingNumber);
}

/** Match scan to pool — exact or LIKE (barcode digits vs prefixed resi). */
export function findPoolItemByTracking(
  items: PackerPoolItem[],
  rawCode: string,
): PackerPoolItem | null {
  return pickBestTrackingMatch(items, rawCode, (item) => item.trackingNumber);
}

export function poolItemIsRecording(
  item: PackerPoolItem,
  recordingCode: string | null,
): boolean {
  if (!recordingCode) return false;
  return trackingCodesMatch(item.trackingNumber, recordingCode);
}
