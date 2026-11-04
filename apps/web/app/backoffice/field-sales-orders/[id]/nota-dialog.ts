import { parseDateOnly } from "@/lib/date-only";
import type { DeliveryActionResult } from "@/app/actions/field-sales-deliveries";

/**
 * What the order page needs to know about an order line to plan a shipment. The hand-entered
 * "Catat pengiriman" dialog that used to own these was removed (P44/P44a): a nota is issued only
 * when a shipment is created.
 */
export type DeliverableLine = {
  id: string;
  productName: string;
  variantLabel: string | null;
  variantSku: string;
  outstanding: number;
  onHand: number;
};

type DeliveryFailure = Extract<DeliveryActionResult, { ok: false }>;

/** Message path for a failed delivery action (close remainder, Edit tanggal nota). */
export function deliveryErrorKey(reason: DeliveryFailure["reason"]): string {
  return `delivery.err.${reason}`;
}

/**
 * Parses a date input's `YYYY-MM-DD` value at WIB midnight, matching how the server reads it.
 * Returns null on an empty or half-typed value so callers can simply do nothing.
 */
export function parseDateOnlyInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return parseDateOnly(value) ?? null;
}
