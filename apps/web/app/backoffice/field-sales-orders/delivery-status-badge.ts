import type { FieldSalesDeliveryStatus } from "@/lib/field-sales/queries";

export const DELIVERY_BADGE_VARIANT: Record<FieldSalesDeliveryStatus, "secondary" | "default" | "outline"> = {
  PENDING: "secondary",
  PARTIAL: "outline",
  DELIVERED: "default",
  CLOSED: "outline",
};

/* PARTIAL is the only state still waiting on someone; CLOSED is a settled write-off, so it stays muted. */
export const DELIVERY_BADGE_CLASS: Record<FieldSalesDeliveryStatus, string> = {
  PENDING: "",
  PARTIAL: "border-amber-500/40 text-amber-700",
  DELIVERED: "",
  CLOSED: "text-muted-foreground",
};
