export type DeliveryShipmentErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "NO_LINES"
  | "OVER_PLANNED"
  | "MISSING_RESI"
  | "MISSING_PROOF"
  | "INVALID_QTY";

export class DeliveryShipmentError extends Error {
  constructor(readonly code: DeliveryShipmentErrorCode) {
    super(`Delivery shipment rejected: ${code}`);
    this.name = "DeliveryShipmentError";
  }
}
