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
   * `updateShipmentTracking` or `reassignShipmentCarrier` was given a `carriedById` that names no
   * user, or a user who is not an eligible carrier (a non-system role holding both `deliveries:pod`
   * and `pwa:access`). `reassignShipmentCarrier` also refuses an empty id here, where
   * `updateShipmentTracking` reads an empty string as "clear the carrier".
   */
  | "INVALID_CARRIER"
  /**
   * A PUTUS shipment is created without a due date. The nota tagihan is issued when the shipment
   * is CREATED (owner putus answer 2026-11-02), so its invoice date is the WIB day of creation and
   * only the due date is asked (P17: it counts from that day).
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
  | "GPS_OUT_OF_RADIUS"
  /** SALESMAN_CARRY completion with no photo of the signed physical nota. */
  | "MISSING_NOTA_PHOTO"
  /** SALESMAN_CARRY completion with no (or blank, after trimming) typed receiver name. */
  | "MISSING_SIGNED_BY"
  /**
   * A KONSI shipment whose order line holds no RESERVED reservation with enough headroom when the
   * shipment is CREATED (stock moves into transit at creation, Q1). Close remainder is refused
   * while a shipment is in flight, so what remains is an order the previous release approved after
   * the migration ran (its reservation was consumed at approve). The whole creation rolls back, so
   * its stock cannot move twice.
   */
  | "KONSI_NOT_RESERVED"
  /**
   * Packing a shipment for an OLD konsi order whose reservation is still held — approved before
   * the per-shipment flow reached production (`bacaPesananKonsiCadanganLama`). Such an order is
   * settled by the store confirming what arrived; the office may only close the rest as "tidak jadi
   * dikirim". Refused before anything is written.
   */
  | "KONSI_PESANAN_LAMA"
  /**
   * A KONSI completion whose line has no main-warehouse InventoryValue row to move stock out of.
   * Approve's reservation needed that row too, so in practice it was removed after approve. The
   * whole completion rolls back.
   */
  | "NO_INVENTORY_ROW"
  /** "Tidak jadi dikirim" without a reason (1–1000 characters after trimming). */
  | "REASON_REQUIRED"
  /**
   * The store already received this shipment (its `StoreReceipt` exists, or Max's bukti terima was
   * recorded on the nota) — it can no longer be cancelled or changed.
   */
  | "ALREADY_RECEIVED"
  /**
   * The putus nota already has a payment, or ANY payment report (BKM/setoran/pelunasan toko),
   * checked or not (P16 + P33a). `detail` names the report numbers.
   */
  | "RECEIVABLE_PAID"
  /** The putus nota sits in a running kontrabon (`detail` = its number) — kept refused (no void). */
  | "RECEIVABLE_IN_USE"
  /** A field return was already priced from this nota (`detail` = the return number). */
  | "RETURN_PRICED"
  /** A pre-order shipment created before its window was released (no reservation to consume). */
  | "INDEN_BELUM_RILIS"
  /** The nota number is already held by another receivable (`detail` = the number). */
  | "NOMOR_NOTA_DIPAKAI"
  /** An expedition shipment leaves without its weight in kg (P35). */
  | "MISSING_WEIGHT"
  /** The weight is not a number above 0 with at most two decimals (≤ 99999.99). */
  | "INVALID_WEIGHT"
  /** An expedition shipment leaves without the handover-to-courier photo showing the weight (P43). */
  | "MISSING_HANDOVER_PHOTO"
  /** A door refusal or cancel cannot find the consume it reverses (no audit adjustment for the line). */
  | "CONSUME_RECORD_MISSING"
  /**
   * At a store without an SPG the POD is the store receipt: on every line delivered + retur
   * langsung + hilang must equal the planned quantity.
   */
  | "LINE_UNACCOUNTED"
  /** The store has an SPG: refused and lost pieces are recorded by the SPG on her receive form (P40). */
  | "DICATAT_SPG"
  /** Nothing was handed to the store: use "Tidak jadi dikirim" (carried back) or let the SPG record the loss. */
  | "POD_KOSONG"
  /** The store receipt written at the POD refused (`detail` = its reason); the whole completion rolled back. */
  | "TERIMA_GAGAL";

export class DeliveryShipmentError extends Error {
  constructor(
    readonly code: DeliveryShipmentErrorCode,
    readonly detail?: string,
  ) {
    super(`Delivery shipment rejected: ${code}${detail ? ` (${detail})` : ""}`);
    this.name = "DeliveryShipmentError";
  }
}
