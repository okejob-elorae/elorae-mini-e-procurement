import type { SalesChannel, SalesOrderStatus } from "@/lib/constants/enums";

const MARKETPLACE_CHANNELS: ReadonlySet<SalesChannel> = new Set(["SHOPEE", "TIKTOK", "TOKOPEDIA"]);
const AWAITING_STATUSES: ReadonlySet<SalesOrderStatus> = new Set(["NEW", "PROCESSING"]);

export type ResiPendingOrder = {
  channel: SalesChannel;
  status: SalesOrderStatus;
  isCanceled: boolean;
  trackingNumber: string | null;
};

/**
 * True only when a marketplace order can still plausibly get a resi from Jubelio: a
 * SHOPEE/TIKTOK/TOKOPEDIA order that is NEW or PROCESSING, not cancelled, and has no
 * non-blank trackingNumber yet. An OTHER/OFFLINE-channel order, a SHIPPED/COMPLETED/
 * CANCELLED/RETURNED order, or a cancelled order never shows the pending state —
 * Jubelio was never going to generate a resi for it, so a "Cek resi" button could
 * never change anything.
 */
export function isAwaitingResi(order: ResiPendingOrder): boolean {
  if (order.isCanceled) return false;
  if (!MARKETPLACE_CHANNELS.has(order.channel)) return false;
  if (!AWAITING_STATUSES.has(order.status)) return false;
  return !hasStoredResi(order.trackingNumber);
}

/** True when the order carries a non-blank trackingNumber, i.e. the Jubelio webhook has stored its resi. */
export function hasStoredResi(trackingNumber: string | null | undefined): boolean {
  return trackingNumber !== null && trackingNumber !== undefined && trackingNumber.trim() !== "";
}
