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
  | "LINE_MISMATCH"
  /** SALESMAN_CARRY ship transition with no carriedById set — symmetric with MISSING_RESI. */
  | "MISSING_CARRIER"
  /**
   * A SALESMAN_CARRY shipment reaches either the ship transition or completion with
   * invoiceDate/dueDate still unset on the shipment row — the admin never entered them at
   * pack/ship time.
   */
  | "MISSING_DATES"
  /**
   * A SALESMAN_CARRY completion whose actor is not the salesman the shipment was assigned to.
   * The counterpart to MISSING_CARRIER: that one refuses to ship without naming a carrier, this
   * one refuses to close against anyone else — without it the column names a carrier that binds
   * nobody, and the GPS/photo evidence is tied to whoever happened to open the URL.
   */
  | "NOT_CARRIER"
  /** SALESMAN_CARRY completion with no gps coordinates supplied. */
  | "MISSING_GPS"
  /** The order's store has no lat/lng on record — refuses rather than passing the gate open. */
  | "STORE_NOT_GEOCODED"
  /** The supplied coordinates are further than the effective radius from the store. */
  | "GPS_OUT_OF_RADIUS";

export class DeliveryShipmentError extends Error {
  constructor(readonly code: DeliveryShipmentErrorCode) {
    super(`Delivery shipment rejected: ${code}`);
    this.name = "DeliveryShipmentError";
  }
}
