/**
 * Shared display maps for a `DeliveryShipment` status. Deliberately import-free: both the
 * register and the detail page are client components, and importing Prisma's enum here would
 * drag `@elorae/db` into the browser bundle. Keyed by plain string because the register's row
 * type carries `status` as `string`, so `toShipmentStatusValue` narrows it. The union is pinned to
 * Prisma's `DeliveryShipmentStatus` by a compile-time assignment in `shipment-queries.ts`.
 */

export type DeliveryShipmentStatusValue =
  | "PACKED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "PARTIALLY_DELIVERED"
  | "CANCELLED";

export const SHIPMENT_STATUS_BADGE: Record<DeliveryShipmentStatusValue, string> = {
  PACKED: "bg-slate-100 text-slate-700",
  IN_TRANSIT: "bg-blue-100 text-blue-700",
  DELIVERED: "bg-green-100 text-green-700",
  PARTIALLY_DELIVERED: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export type ShipmentStatusLabelKey =
  | "statusPacked"
  | "statusInTransit"
  | "statusDelivered"
  | "statusPartiallyDelivered"
  | "statusCancelled";

export const SHIPMENT_STATUS_LABEL_KEY: Record<DeliveryShipmentStatusValue, ShipmentStatusLabelKey> = {
  PACKED: "statusPacked",
  IN_TRANSIT: "statusInTransit",
  DELIVERED: "statusDelivered",
  PARTIALLY_DELIVERED: "statusPartiallyDelivered",
  CANCELLED: "statusCancelled",
};

/**
 * Narrows a raw `string` status into the union, falling back to `PACKED` for anything unknown — a
 * status added to the enum before this file learns it renders as the default label rather than
 * an unmapped key path.
 */
export function toShipmentStatusValue(value: string): DeliveryShipmentStatusValue {
  return Object.hasOwn(SHIPMENT_STATUS_LABEL_KEY, value) ? (value as DeliveryShipmentStatusValue) : "PACKED";
}
