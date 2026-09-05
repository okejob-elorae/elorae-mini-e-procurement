import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { recordFieldSalesDelivery } from "@/lib/field-sales/delivery/writer";
import { evaluateCheckinRadius, resolveEffectiveRadius, parseRadiusSetting } from "@/lib/pwa/checkin-radius";
import { DeliveryShipmentError } from "./errors";

export async function createDeliveryShipment(input: {
  orderId: string;
  method: "EXPEDITION" | "SALESMAN_CARRY";
  lines: Array<{ orderLineId: string; qty: number }>;
  packedById: string;
}): Promise<{ shipmentId: string; docNo: string }> {
  if (input.lines.length === 0) throw new DeliveryShipmentError("NO_LINES");
  for (const line of input.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new DeliveryShipmentError("INVALID_QTY");
    }
  }

  return runSerializable(async (tx) => {
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: { lines: true },
    });
    if (!order) throw new DeliveryShipmentError("NOT_FOUND");

    const packer = await tx.user.findUnique({
      where: { id: input.packedById },
      select: { id: true },
    });
    if (!packer) throw new DeliveryShipmentError("NOT_FOUND");

    const orderLineById = new Map(order.lines.map((l) => [l.id, l]));

    /* Aggregate qty by orderLineId to catch duplicate entries that together exceed remaining qty */
    const qtyByOrderLineId = new Map<string, number>();
    for (const line of input.lines) {
      const current = qtyByOrderLineId.get(line.orderLineId) ?? 0;
      qtyByOrderLineId.set(line.orderLineId, current + line.qty);
    }

    /**
     * Quantity already claimed by OTHER still-open shipments on the same order line.
     * `orderLine.deliveredQty` only moves at COMPLETION, so without this two shipments packed
     * back to back against one line each see the full remaining figure and both pass — the second
     * to complete then dies inside `recordFieldSalesDelivery` with OVER_DELIVER, after the goods
     * have physically left. PACKED and IN_TRANSIT are exactly the statuses holding an unconsumed
     * claim: DELIVERED/PARTIALLY_DELIVERED already moved `deliveredQty`, and CANCELLED holds
     * nothing. Scoped by `orderId` rather than filtering on the line relation, which keeps this a
     * plain query on one table under `relationMode = "prisma"`.
     */
    const openShipments = await tx.deliveryShipment.findMany({
      where: { orderId: input.orderId, status: { in: ["PACKED", "IN_TRANSIT"] } },
      select: { lines: { select: { orderLineId: true, plannedQty: true } } },
    });
    const inFlightByOrderLineId = new Map<string, number>();
    for (const openShipment of openShipments) {
      for (const openLine of openShipment.lines) {
        const current = inFlightByOrderLineId.get(openLine.orderLineId) ?? 0;
        inFlightByOrderLineId.set(openLine.orderLineId, current + openLine.plannedQty);
      }
    }

    /* Validate aggregate quantities against remaining */
    for (const [orderLineId, totalQty] of qtyByOrderLineId) {
      const orderLine = orderLineById.get(orderLineId);
      if (!orderLine) throw new DeliveryShipmentError("NOT_FOUND");
      const inFlight = inFlightByOrderLineId.get(orderLineId) ?? 0;
      const remaining = orderLine.qty - orderLine.deliveredQty - orderLine.cancelledQty - inFlight;
      if (totalQty > remaining) throw new DeliveryShipmentError("OVER_PLANNED");
    }

    const docNo = await generateDocNumber("DELIVERY", tx);
    const shipment = await tx.deliveryShipment.create({
      data: {
        docNo,
        orderId: input.orderId,
        method: input.method,
        packedById: input.packedById,
        lines: {
          create: input.lines.map((line) => {
            const orderLine = orderLineById.get(line.orderLineId)!;
            return {
              orderLineId: line.orderLineId,
              itemId: orderLine.itemId,
              variantSku: orderLine.variantSku,
              plannedQty: line.qty,
            };
          }),
        },
      },
    });

    return { shipmentId: shipment.id, docNo: shipment.docNo };
  });
}

export async function updateShipmentTracking(input: {
  shipmentId: string;
  carrierName?: string;
  resiNumber?: string;
  carriedById?: string;
  invoiceDate?: Date;
  dueDate?: Date;
}): Promise<{ ok: true }> {
  const result = await prisma.deliveryShipment.updateMany({
    where: { id: input.shipmentId, status: "PACKED" },
    data: {
      ...(input.carrierName !== undefined ? { carrierName: input.carrierName } : {}),
      ...(input.resiNumber !== undefined ? { resiNumber: input.resiNumber } : {}),
      ...(input.carriedById !== undefined ? { carriedById: input.carriedById } : {}),
      ...(input.invoiceDate !== undefined ? { invoiceDate: input.invoiceDate } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    },
  });
  if (result.count === 0) throw new DeliveryShipmentError("INVALID_STATE");
  return { ok: true };
}

export async function shipDeliveryShipment(input: {
  shipmentId: string;
  shippedById: string;
}): Promise<{ ok: true }> {
  const shipment = await prisma.deliveryShipment.findUnique({ where: { id: input.shipmentId } });
  if (!shipment) throw new DeliveryShipmentError("NOT_FOUND");
  if (shipment.status !== "PACKED") throw new DeliveryShipmentError("INVALID_STATE");
  if (shipment.method === "EXPEDITION" && !shipment.resiNumber) {
    throw new DeliveryShipmentError("MISSING_RESI");
  }
  if (shipment.method === "SALESMAN_CARRY" && !shipment.carriedById) {
    throw new DeliveryShipmentError("MISSING_CARRIER");
  }
  if (shipment.method === "SALESMAN_CARRY" && (!shipment.invoiceDate || !shipment.dueDate)) {
    throw new DeliveryShipmentError("MISSING_DATES");
  }

  const result = await prisma.deliveryShipment.updateMany({
    where: { id: input.shipmentId, status: "PACKED" },
    data: { status: "IN_TRANSIT", shippedAt: new Date(), shippedById: input.shippedById },
  });
  if (result.count === 0) throw new DeliveryShipmentError("INVALID_STATE");
  return { ok: true };
}

export async function completeDeliveryShipment(input: {
  shipmentId: string;
  deliveredById: string;
  proofPhotoUrl: string;
  proofPhotoR2Key: string;
  /**
   * EXPEDITION only. A SALESMAN_CARRY completion IGNORES these and reads the dates the admin
   * committed to the shipment row at pack/ship time instead — the salesman in the field carries a
   * printed nota bearing those dates, so the accounting record must match the paper, not whatever
   * the phone happens to send at completion time. Optional in the type, still mandatory at
   * runtime for EXPEDITION (MISSING_DATES).
   */
  invoiceDate?: Date;
  dueDate?: Date;
  /** SALESMAN_CARRY only, and mandatory there — the delivery's proof-of-location. */
  gps?: { lat: number; lng: number };
  /** SALESMAN_CARRY only, and mandatory there — a photo of the signed physical nota. */
  signatureUrl?: string;
  signatureR2Key?: string;
  /** SALESMAN_CARRY only, and mandatory there — the receiver's typed name, trimmed and capped at 120 chars. */
  signedByName?: string;
  lines: Array<{ shipmentLineId: string; deliveredQty: number }>;
}): Promise<{ ok: true; deliveryId: string }> {
  if (input.lines.length === 0) throw new DeliveryShipmentError("NO_LINES");
  if (!input.proofPhotoUrl?.trim()) throw new DeliveryShipmentError("MISSING_PROOF");
  for (const line of input.lines) {
    if (!Number.isInteger(line.deliveredQty) || line.deliveredQty < 0) {
      throw new DeliveryShipmentError("INVALID_QTY");
    }
  }

  const shipment = await prisma.deliveryShipment.findUnique({
    where: { id: input.shipmentId },
    include: { lines: true, order: { select: { orderType: true, storeId: true } } },
  });
  if (!shipment) throw new DeliveryShipmentError("NOT_FOUND");
  if (shipment.status !== "IN_TRANSIT") throw new DeliveryShipmentError("INVALID_STATE");

  /**
   * Date source and location gate, branched on `method` — a precondition about WHO is completing
   * and WHERE, so it runs before any quantity validation: it is the cheaper check and failing fast
   * on the actor/location keeps a refused completion from having reasoned about quantities at all.
   *
   * Note this keys on `shipment.method` (`DeliveryShipment.method`), NOT on
   * `shipment.order.orderType` — two different fields on two different rows. A KONSI order shipped
   * by EXPEDITION skips this whole block; a KONSI order carried by a salesman passes through it and
   * then still skips the stock/accounting path below, the two being independent sections.
   */
  let effectiveInvoiceDate: Date;
  let effectiveDueDate: Date;
  let salesmanCarryGps: { lat: number; lng: number; distanceMeters: number } | undefined;
  let salesmanCarrySignature: { url: string; r2Key: string; signedByName: string } | undefined;

  if (shipment.method === "SALESMAN_CARRY") {
    /**
     * The feature's anti-fraud property, and the whole reason `carriedById` exists: the actor
     * closing the delivery must BE the salesman it was assigned to. `shipDeliveryShipment` only
     * checks the column is SET, and `listMyDeliveries` only scopes the PWA queue — neither binds
     * the completing actor, so without this check any `deliveries:pod` holder could open another
     * salesman's shipment URL and close it: consuming stock, raising a receivable, posting the AR
     * journals and stamping their own id as `deliveredById`, while the assigned carrier's queue
     * silently loses the row. GPS is a LOCATION check standing in for an IDENTITY check and is
     * trivially spoofed from a browser, so it is not a substitute. Enforced here rather than only
     * in the PWA page because every `"use server"` export is independently callable.
     *
     * `!==` on the nullable column is safe: a null `carriedById` cannot equal a session user id,
     * so an unassigned SALESMAN_CARRY shipment is refused here too (it should already have been
     * refused at ship time by MISSING_CARRIER).
     */
    if (shipment.carriedById !== input.deliveredById) {
      throw new DeliveryShipmentError("NOT_CARRIER");
    }

    /**
     * Defense in depth: `shipDeliveryShipment` already refuses to move a SALESMAN_CARRY shipment
     * to IN_TRANSIT without both dates, so this should be unreachable. It stays because every
     * write path here is independently callable and the alternative to refusing is passing
     * `undefined` into the accounting record.
     */
    if (!shipment.invoiceDate || !shipment.dueDate) {
      throw new DeliveryShipmentError("MISSING_DATES");
    }
    effectiveInvoiceDate = shipment.invoiceDate;
    effectiveDueDate = shipment.dueDate;

    if (!input.gps) throw new DeliveryShipmentError("MISSING_GPS");
    /**
     * The declared `number` type is not a runtime guarantee — this is a `"use server"`-reachable
     * writer, so the payload is network input. Unvalidated, `{ lat: null, lng: null }` OPENS the
     * gate instead of failing it: `null - null` coerces to `0` inside `haversineMeters`, which
     * returns a distance of 0, which then passes both `=== null` and `> radius` and completes the
     * delivery with a fabricated "0 metres from the store" audit record. `NaN` and a missing field
     * do the same, since `NaN === null` and `NaN > radius` are both false. Same stance the
     * `deliveredQty` check above takes on its own declared type, and the same range the check-in
     * action's zod schema enforces. `Number.isFinite`, NOT the global `isFinite`, which coerces
     * its argument — `isFinite(null)` is `true` and would make this guard a no-op.
     */
    if (
      !Number.isFinite(input.gps.lat) ||
      !Number.isFinite(input.gps.lng) ||
      Math.abs(input.gps.lat) > 90 ||
      Math.abs(input.gps.lng) > 180
    ) {
      throw new DeliveryShipmentError("MISSING_GPS");
    }

    const store = await prisma.store.findUnique({
      where: { id: shipment.order.storeId },
      select: { lat: true, lng: true, checkinRadiusMeters: true },
    });
    /**
     * Two distinct failures, two distinct codes: under `relationMode = "prisma"` there is no real
     * FK behind `FieldSalesOrder.storeId`, so a missing row is genuinely possible and is a
     * NOT_FOUND, not a geocoding gap the ops team could fix by entering coordinates.
     */
    if (!store) throw new DeliveryShipmentError("NOT_FOUND");
    if (store.lat === null || store.lng === null) {
      throw new DeliveryShipmentError("STORE_NOT_GEOCODED");
    }

    const globalRow = await prisma.systemSetting.findUnique({
      where: { key: "checkin.radiusMeters" },
    });
    const effectiveRadius = resolveEffectiveRadius(
      store.checkinRadiusMeters,
      parseRadiusSetting(globalRow?.value),
    );
    const gpsResult = evaluateCheckinRadius({
      checkin: input.gps,
      store: { lat: store.lat.toNumber(), lng: store.lng.toNumber() },
      effectiveRadiusMeters: effectiveRadius,
    });
    /**
     * `distanceMeters: null` is `evaluateCheckinRadius`'s "the store has no coordinates" return,
     * and it comes back paired with `outOfRadius: false`. The store check-in flow treats that as a
     * PASS (it only ever warns); here it is a REFUSAL — a deliberate divergence in interpretation,
     * not a bug, and the reason this gate must not be expressed as `if (outOfRadius)` alone. The
     * store null-check above already covers the same case; keeping both means a future change to
     * `evaluateCheckinRadius`'s null conditions cannot silently open the gate. Compare `=== null`
     * rather than falsiness: a legitimate 0-metre distance is falsy.
     */
    if (gpsResult.distanceMeters === null) throw new DeliveryShipmentError("STORE_NOT_GEOCODED");
    if (gpsResult.outOfRadius) throw new DeliveryShipmentError("GPS_OUT_OF_RADIUS");

    const signatureR2Key = input.signatureR2Key?.trim();
    const signedByName = input.signedByName?.trim();

    if (!signatureR2Key) throw new DeliveryShipmentError("MISSING_NOTA_PHOTO");
    if (!signedByName || signedByName.length > 120) {
      throw new DeliveryShipmentError("MISSING_SIGNED_BY");
    }

    salesmanCarryGps = {
      lat: input.gps.lat,
      lng: input.gps.lng,
      distanceMeters: gpsResult.distanceMeters,
    };
    salesmanCarrySignature = {
      url: input.signatureUrl ?? "",
      r2Key: signatureR2Key,
      signedByName,
    };
  } else {
    if (!input.invoiceDate || !input.dueDate) throw new DeliveryShipmentError("MISSING_DATES");
    effectiveInvoiceDate = input.invoiceDate;
    effectiveDueDate = input.dueDate;
  }

  const lineById = new Map(shipment.lines.map((l) => [l.id, l]));

  /**
   * The payload must name EVERY line on the shipment EXACTLY once. Both halves are load-bearing
   * and neither is enforced anywhere else, because this call is terminal — there is no state left
   * to correct from afterwards:
   *
   * - a DUPLICATE `shipmentLineId` would pass the per-entry OVER_PLANNED check below twice while
   *   `recordFieldSalesDelivery` aggregates by `orderLineId` internally and consumes/invoices the
   *   SUM, permanently desyncing this shipment's own `deliveredQty` from the accounting record;
   * - a MISSING entry would leave that line's `deliveredQty` null forever while `anyShort` — which
   *   only sees `input.lines` — still reads "nothing short" and moves the shipment to DELIVERED, a
   *   terminal status that can neither be completed nor cancelled again.
   *
   * Same aggregate-then-validate stance `createDeliveryShipment` takes on duplicate
   * `orderLineId`s, made stricter here for the reason above.
   */
  const seenLineIds = new Set<string>();
  for (const line of input.lines) {
    const shipmentLine = lineById.get(line.shipmentLineId);
    if (!shipmentLine) throw new DeliveryShipmentError("NOT_FOUND");
    if (seenLineIds.has(line.shipmentLineId)) throw new DeliveryShipmentError("LINE_MISMATCH");
    seenLineIds.add(line.shipmentLineId);
    if (line.deliveredQty > shipmentLine.plannedQty) throw new DeliveryShipmentError("OVER_PLANNED");
  }
  if (seenLineIds.size !== shipment.lines.length) throw new DeliveryShipmentError("LINE_MISMATCH");

  const anyShort = input.lines.some((line) => {
    const shipmentLine = lineById.get(line.shipmentLineId)!;
    return line.deliveredQty < shipmentLine.plannedQty;
  });
  const nextStatus = anyShort ? "PARTIALLY_DELIVERED" : "DELIVERED";

  const isKonsi = shipment.order.orderType === "KONSI";
  let deliveryId = "";

  if (!isKonsi) {
    const deliveredLines = input.lines
      .filter((line) => line.deliveredQty > 0)
      .map((line) => {
        const shipmentLine = lineById.get(line.shipmentLineId)!;
        return { orderLineId: shipmentLine.orderLineId, qty: line.deliveredQty };
      });
    if (deliveredLines.length > 0) {
      const delivery = await recordFieldSalesDelivery({
        orderId: shipment.orderId,
        deliveredById: input.deliveredById,
        lines: deliveredLines,
        invoiceDate: effectiveInvoiceDate,
        dueDate: effectiveDueDate,
        idempotencyKey: `shipment-${input.shipmentId}`,
      });
      deliveryId = delivery.deliveryId;
    }
  }

  await runSerializable(async (tx) => {
    const result = await tx.deliveryShipment.updateMany({
      where: { id: input.shipmentId, status: "IN_TRANSIT" },
      data: {
        status: nextStatus,
        deliveredAt: new Date(),
        deliveredById: input.deliveredById,
        proofPhotoUrl: input.proofPhotoUrl,
        proofPhotoR2Key: input.proofPhotoR2Key,
        ...(deliveryId ? { deliveryId } : {}),
        /* Same CAS-guarded write that moves the status — the GPS audit trail and the status it
         * justifies must land together or not at all, never as a second write. */
        ...(salesmanCarryGps
          ? {
              gpsLat: salesmanCarryGps.lat,
              gpsLng: salesmanCarryGps.lng,
              gpsDistanceMeters: salesmanCarryGps.distanceMeters,
            }
          : {}),
        ...(salesmanCarrySignature
          ? {
              signatureUrl: salesmanCarrySignature.url,
              signatureR2Key: salesmanCarrySignature.r2Key,
              signedByName: salesmanCarrySignature.signedByName,
            }
          : {}),
      },
    });
    if (result.count === 0) throw new DeliveryShipmentError("INVALID_STATE");

    for (const line of input.lines) {
      await tx.deliveryShipmentLine.update({
        where: { id: line.shipmentLineId },
        data: { deliveredQty: line.deliveredQty },
      });
    }
  });

  return { ok: true, deliveryId };
}

export async function cancelDeliveryShipment(input: {
  shipmentId: string;
  cancelledById: string;
}): Promise<{ ok: true }> {
  const result = await prisma.deliveryShipment.updateMany({
    where: { id: input.shipmentId, status: { in: ["PACKED", "IN_TRANSIT"] } },
    data: { status: "CANCELLED" },
  });
  if (result.count === 0) throw new DeliveryShipmentError("INVALID_STATE");
  return { ok: true };
}
