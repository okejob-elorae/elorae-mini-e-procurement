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
  if (
    order.fulfillmentStatus === "SHIPPED" ||
    order.status === "SHIPPED" ||
    order.status === "COMPLETED" ||
    order.status === "RETURNED"
  ) {
    return { action: "mark-consumed" };
  }
  return { action: "reserve-and-restore" };
}

/**
 * Refuses --apply against the prod SSH tunnel (port 3307). Dry-run (applyFlag
 * false) is read-only and may run against any url. Run --apply against the
 * local test DB (port 3308) first.
 */
export function assertNotProdApply(url: string, applyFlag: boolean): void {
  if (applyFlag && url.includes("3307")) {
    throw new Error(
      "Refusing --apply: DATABASE_URL points at port 3307 (the prod SSH tunnel). " +
        'Run the backfill against the local test DB (port 3308): DATABASE_URL="mysql://elorae:elorae@127.0.0.1:3308/elorae" ... --apply',
    );
  }
}
