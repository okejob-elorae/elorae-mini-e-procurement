/**
 * Shared display maps for a `DeliveryShipment` status. Deliberately import-free: both the
 * register and the detail page are client components, and importing Prisma's enum here would
 * drag `@elorae/db` into the browser bundle. Keyed by plain string because the register's row
 * type carries `status` as `string`.
 */

export const SHIPMENT_STATUS_BADGE: Record<string, string> = {
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

export const SHIPMENT_STATUS_LABEL_KEY: Record<string, ShipmentStatusLabelKey> = {
  PACKED: "statusPacked",
  IN_TRANSIT: "statusInTransit",
  DELIVERED: "statusDelivered",
  PARTIALLY_DELIVERED: "statusPartiallyDelivered",
  CANCELLED: "statusCancelled",
};
