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
