export type PodCompletionBlock = "NOT_FOUND" | "NOT_COMPLETABLE";

export function podCompletionBlock(
  shipment: { carriedById: string | null; status: string; method: string },
  userId: string,
): PodCompletionBlock | null {
  if (shipment.carriedById !== userId) return "NOT_FOUND";
  if (shipment.method !== "SALESMAN_CARRY" || shipment.status !== "IN_TRANSIT") {
    return "NOT_COMPLETABLE";
  }
  return null;
}

/**
 * The ONE definition of a same-actor replay of an already-completed delivery, shared by
 * `completeDeliveryShipment`'s replay guard and the POD upload route's replay branch.
 * Changing it changes both, which is the point: a route that hands back stored keys for a
 * shipment the writer would then refuse turns a lost-response replay into a terminal failure.
 */
export function isSameActorReplay(
  shipment: { status: string; deliveredById: string | null },
  actorId: string,
): boolean {
  return (
    (shipment.status === "DELIVERED" || shipment.status === "PARTIALLY_DELIVERED") &&
    shipment.deliveredById === actorId
  );
}
