export type DeliveryShipmentErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "NO_LINES"
  | "OVER_PLANNED"
  | "MISSING_RESI"
  | "MISSING_PROOF"
  | "INVALID_QTY"
  /**
   * The completion payload does not name every line of the shipment exactly once — a duplicate
   * `shipmentLineId`, or fewer entries than the shipment has lines. Distinct from `NO_LINES`
   * (nothing at all was sent) because the remedy is different: the caller sent SOMETHING, just
   * not a faithful one-to-one picture of the shipment.
   */
  | "LINE_MISMATCH";

export class DeliveryShipmentError extends Error {
  constructor(readonly code: DeliveryShipmentErrorCode) {
    super(`Delivery shipment rejected: ${code}`);
    this.name = "DeliveryShipmentError";
  }
}
