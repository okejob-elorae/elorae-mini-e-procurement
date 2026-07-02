export type BackfillDecision =
  | { action: "reserve-and-restore" }
  | { action: "mark-consumed" }
  | { action: "mark-released" };

export function classifyForBackfill(order: {
  isCanceled: boolean;
  fulfillmentStatus: string;
  status: string;
}): BackfillDecision {
  if (order.isCanceled || order.status === "CANCELLED") return { action: "mark-released" };
  if (order.fulfillmentStatus === "SHIPPED" || order.status === "SHIPPED" || order.status === "COMPLETED") {
    return { action: "mark-consumed" };
  }
  return { action: "reserve-and-restore" };
}
