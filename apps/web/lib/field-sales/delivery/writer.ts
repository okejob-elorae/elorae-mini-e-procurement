import {
  consumeFieldSalesOrderPartial,
  releaseFieldSalesOrder,
  PartialConsumeError,
  type Prisma,
  type PrismaClient,
} from "@elorae/db";
import { buildOfflineSalesHistoryRows } from "@elorae/db/field-sales";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { DeliveryError, type DeliveryErrorCode, type DeliveryReplayDetail } from "../errors";
import { outstandingQty, nextDeliveryStatus, allocateDeliveryDiscounts } from "./plan";

/**
 * Every `PartialConsumeError` code mapped by construction: a code added to that union without an
 * entry here is a type error, never a silent fallback onto some unrelated delivery code.
 * `OVER_CONSUME` is not a quantity error — see the consume call below.
 */
const PARTIAL_CONSUME_CODE: Record<PartialConsumeError["code"], DeliveryErrorCode> = {
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  OVER_CONSUME: "RESERVATION_MISMATCH",
};

/**
 * The delivery already recorded under `idempotencyKey`, as the `REPLAY_MISMATCH` detail carries
 * it: lines summed per `orderLineId`. Shared by `recordFieldSalesDelivery`'s replay compare and by
 * `completeDeliveryShipment`'s all-zero retry, which never reaches that compare, so both refuse
 * with the same recorded values.
 */
export async function findRecordedDelivery(
  client: PrismaClient | Prisma.TransactionClient,
  idempotencyKey: string,
  orderId: string,
): Promise<DeliveryReplayDetail | null> {
  const existing = await client.fieldSalesDelivery.findUnique({
    where: { idempotencyKey },
    select: {
      id: true,
      orderId: true,
      docNo: true,
      invoiceDate: true,
      dueDate: true,
      lines: { select: { orderLineId: true, qty: true } },
    },
  });
  if (!existing) return null;
  /* A key is only a replay of THIS order's delivery; another order's must never hand back its values or post its journals. */
  if (existing.orderId !== orderId) throw new DeliveryError("INVALID_STATE");
  const recorded = new Map<string, number>();
  for (const l of existing.lines) recorded.set(l.orderLineId, (recorded.get(l.orderLineId) ?? 0) + l.qty);
  return {
    deliveryId: existing.id,
    docNo: existing.docNo,
    invoiceDate: existing.invoiceDate,
    dueDate: existing.dueDate,
    lines: Array.from(recorded, ([orderLineId, qty]) => ({ orderLineId, qty })),
  };
}

/**
 * `idempotencyKey` is kept across a failed submit on purpose, so a genuine retry — including one
 * after a lost success response — cannot ship twice. A matching key therefore returns the
 * recorded delivery, but only when the retry asks for the SAME thing: same per-`orderLineId`
 * quantity totals and, under the default `replayCompare`, the same invoice/due dates (exact
 * instants). A retry that differs is REFUSED with `REPLAY_MISMATCH` carrying the recorded values,
 * because returning the original would report success while silently discarding the operator's
 * correction. The key is never rotated to get around this: after a lost-response success a fresh
 * key would ship the order twice. Checked before any write, so the refusal leaves nothing behind.
 *
 * `replayCompare: "linesOnly"` is for `completeDeliveryShipment`, whose `shipment-<id>` key is
 * replayed with dates the caller does not own: a `SALESMAN_CARRY` completion always sends the
 * frozen shipment row's dates, so once Edit nota dates corrected the recorded delivery in the crash
 * window, a dates compare would refuse every retry forever. There the recorded delivery's dates
 * are the accounting truth, corrected only through Edit nota dates, and the quantities are what
 * desync the shipment from it. A hand-entered delivery keeps the strict default: its operator
 * typed the dates, so a changed date is a correction the replay must not swallow.
 */
export async function recordFieldSalesDelivery(input: {
  orderId: string;
  deliveredById: string;
  lines: Array<{ orderLineId: string; qty: number }>;
  note?: string;
  invoiceDate: Date;
  dueDate: Date;
  idempotencyKey?: string;
  replayCompare?: "datesAndLines" | "linesOnly";
  deliveredAt?: Date;
}): Promise<{ deliveryId: string; docNo: string }> {
  if (input.lines.length === 0) throw new DeliveryError("NO_LINES");

  if (input.dueDate.getTime() < input.invoiceDate.getTime()) {
    throw new DeliveryError("INVALID_DATES");
  }

  return runSerializable(async (tx) => {
    if (input.idempotencyKey) {
      const recorded = await findRecordedDelivery(tx, input.idempotencyKey, input.orderId);
      if (recorded) {
        const recordedQty = new Map(recorded.lines.map((l) => [l.orderLineId, l.qty]));
        const asked = new Map<string, number>();
        for (const l of input.lines) asked.set(l.orderLineId, (asked.get(l.orderLineId) ?? 0) + l.qty);
        const sameLines =
          Array.from(recordedQty.keys()).every((id) => asked.get(id) === recordedQty.get(id)) &&
          Array.from(asked.keys()).every((id) => recordedQty.get(id) === asked.get(id));
        const sameDates =
          input.replayCompare === "linesOnly" ||
          (recorded.invoiceDate.getTime() === input.invoiceDate.getTime() &&
            recorded.dueDate.getTime() === input.dueDate.getTime());
        if (!sameLines || !sameDates) throw new DeliveryError("REPLAY_MISMATCH", [], recorded);
        return { deliveryId: recorded.deliveryId, docNo: recorded.docNo };
      }
    }

    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: {
        lines: { include: { item: { select: { sku: true, category: { select: { name: true } } } } } },
        deliveries: { select: { discountAmount: true, lines: { select: { orderLineId: true, discountAmount: true } } } },
      },
    });
    if (!order) throw new DeliveryError("NOT_FOUND");
    if (order.status !== "APPROVED" || order.orderType !== "PUTUS") throw new DeliveryError("INVALID_STATE");

    const lineById = new Map(order.lines.map((l) => [l.id, l]));
    const requested = new Map<string, number>();
    for (const l of input.lines) {
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new DeliveryError("OVER_DELIVER");
      const orderLine = lineById.get(l.orderLineId);
      if (!orderLine) throw new DeliveryError("NOT_FOUND");
      const outstanding = outstandingQty({
        orderLineId: orderLine.id,
        qty: orderLine.qty,
        deliveredQty: orderLine.deliveredQty,
        cancelledQty: orderLine.cancelledQty,
      });
      const total = (requested.get(l.orderLineId) ?? 0) + l.qty;
      if (total > outstanding) throw new DeliveryError("OVER_DELIVER");
      requested.set(l.orderLineId, total);
    }

    const closesOrder = order.lines.every((ol) => {
      const delivered = ol.deliveredQty + (requested.get(ol.id) ?? 0);
      return ol.qty - delivered - ol.cancelledQty === 0;
    });

    const lineDiscountAllocated = new Map<string, number>();
    for (const d of order.deliveries) {
      for (const dl of d.lines) {
        lineDiscountAllocated.set(dl.orderLineId, (lineDiscountAllocated.get(dl.orderLineId) ?? 0) + Number(dl.discountAmount));
      }
    }
    const orderDiscountAllocated = order.deliveries.reduce((s, d) => s + Number(d.discountAmount), 0);

    const deliveredLines = Array.from(requested, ([orderLineId, qty]) => {
      const ol = lineById.get(orderLineId)!;
      return { ol, qty, deliveredSubtotal: qty * Number(ol.unitPrice) };
    });

    const allocation = allocateDeliveryDiscounts({
      closesOrder,
      orderSubtotal: Number(order.subtotal),
      orderDiscount: Number(order.orderDiscountAmount),
      orderDiscountAllocated,
      /**
       * Every order line, not just the ones in this delivery: a line that finished in an earlier
       * delivery can still be holding rounding residue that only the closing delivery can absorb.
       */
      lines: order.lines.map((ol) => {
        const qty = requested.get(ol.id) ?? 0;
        return {
          orderLineId: ol.id,
          lineDiscount: Number(ol.discountAmount),
          orderedQty: ol.qty,
          deliveredQty: qty,
          lineDiscountAllocated: lineDiscountAllocated.get(ol.id) ?? 0,
          deliveredSubtotal: qty * Number(ol.unitPrice),
        };
      }),
    });
    const lineDiscountByOrderLine = new Map(allocation.lineDiscounts.map((l) => [l.orderLineId, l.discountAmount]));

    const subtotal = deliveredLines.reduce((s, d) => s + d.deliveredSubtotal, 0);
    const lineDiscountTotal = allocation.lineDiscounts.reduce((s, l) => s + l.discountAmount, 0);
    const total = subtotal - lineDiscountTotal - allocation.orderDiscountAmount;

    const docNo = await generateDocNumber("DELIVERY", tx);
    const now = input.deliveredAt ?? new Date();

    const delivery = await tx.fieldSalesDelivery.create({
      data: {
        docNo,
        orderId: order.id,
        deliveredAt: now,
        deliveredById: input.deliveredById,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        subtotal,
        discountAmount: allocation.orderDiscountAmount,
        total,
        note: input.note,
        idempotencyKey: input.idempotencyKey ?? null,
        lines: {
          create: deliveredLines.map((d) => ({
            orderLineId: d.ol.id,
            itemId: d.ol.itemId,
            variantSku: d.ol.variantSku,
            productName: d.ol.productName,
            qty: d.qty,
            unitPrice: Number(d.ol.unitPrice),
            discountAmount: lineDiscountByOrderLine.get(d.ol.id) ?? 0,
            lineTotal: d.deliveredSubtotal,
          })),
        },
      },
      select: { id: true, docNo: true },
    });

    await tx.taxInvoice.create({
      data: { deliveryId: delivery.id },
    });

    await tx.receivable.create({
      data: {
        deliveryId: delivery.id,
        storeId: order.storeId,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        originalAmount: total,
        outstandingAmount: total,
      },
    });

    /**
     * `OVER_CONSUME` is not a quantity error — the quantities were checked against the order lines
     * above. It means a line's `StockReservation` is missing, no longer `RESERVED` (released, or
     * already consumed), or would be over-consumed, i.e. the reservation disagrees with the
     * deliveries recorded against it. The most likely cause is the delivery-rollout deploy race: an
     * order the OLD image approved after the backfill migration ran was consumed with no backfilled
     * delivery. It surfaces as `RESERVATION_MISMATCH`; the remedy is an admin repair of the order
     * (for the deploy race, the per-order hand-run of that migration's statements,
     * `20260809130000_backfill_field_sales_deliveries`), never a retry.
     *
     * Consume AFTER the delivery row exists so the audit adjustment can key on the real delivery
     * id. Everything here is one serializable transaction, so a short-stock throw rolls the
     * delivery back with it.
     */
    let consumeResult: Awaited<ReturnType<typeof consumeFieldSalesOrderPartial>>;
    try {
      consumeResult = await consumeFieldSalesOrderPartial(tx, {
        orderNo: order.orderNo,
        deliveryId: delivery.id,
        lines: deliveredLines.map((d) => ({
          fieldSalesLineId: d.ol.id,
          itemId: d.ol.itemId,
          variantSku: d.ol.variantSku,
          qty: d.qty,
        })),
      });
    } catch (e) {
      if (e instanceof PartialConsumeError) {
        throw new DeliveryError(
          PARTIAL_CONSUME_CODE[e.code],
          e.shortLines.map((s) => ({ orderLineId: s.fieldSalesLineId, requested: s.requested, onHand: s.onHand })),
        );
      }
      throw e;
    }

    const cogsAmount = consumeResult.lines.reduce((s, l) => s + l.qty * l.avgCost, 0);
    await tx.fieldSalesDelivery.update({
      where: { id: delivery.id },
      data: { cogsAmount },
    });

    for (const d of deliveredLines) {
      await tx.fieldSalesOrderLine.update({
        where: { id: d.ol.id },
        data: { deliveredQty: { increment: d.qty } },
      });
    }

    const settled = order.lines.map((ol) => ({
      orderLineId: ol.id,
      qty: ol.qty,
      deliveredQty: ol.deliveredQty + (requested.get(ol.id) ?? 0),
      cancelledQty: ol.cancelledQty,
    }));
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: { deliveryStatus: nextDeliveryStatus(settled) },
    });

    /**
     * SalesHistory is keyed (channel, orderId, variantSku), so each delivery files under its own
     * docNo — an order number would collide on the second delivery of the same variant.
     */
    const rows = buildOfflineSalesHistoryRows({
      orderNo: delivery.docNo,
      orderTotal: total,
      lines: deliveredLines.map((d) => {
        const disc = lineDiscountByOrderLine.get(d.ol.id) ?? 0;
        const net = d.deliveredSubtotal - disc;
        return {
          itemId: d.ol.itemId,
          variantSku: d.ol.variantSku,
          parentSku: d.ol.item.sku,
          productName: d.ol.productName,
          qty: d.qty,
          unitPrice: d.qty > 0 ? net / d.qty : 0,
          lineTotal: net,
          productCategory: d.ol.item.category?.name ?? null,
        };
      }),
    }).map((row) => ({ ...row, orderDate: now, completedDate: now }));
    await tx.salesHistory.createMany({ data: rows });

    return { deliveryId: delivery.id, docNo: delivery.docNo };
  });
}

export async function closeFieldSalesOrderRemainder(input: {
  orderId: string;
  closedById: string;
  reason: string;
}): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: { lines: true },
    });
    if (!order) throw new DeliveryError("NOT_FOUND");
    if (order.status !== "APPROVED") throw new DeliveryError("INVALID_STATE");

    const openLines = order.lines.filter((l) => outstandingQty(l) > 0);
    if (openLines.length === 0) throw new DeliveryError("INVALID_STATE");

    /**
     * Refused, not netted, while a shipment is still PACKED or IN_TRANSIT. The release below flips
     * each line's whole reservation — a partial release per reservation is not expressible — so
     * the in-flight shipment would then complete against nothing, and netting its planned qty out
     * would still let the admin close units that are physically on a truck. Checked before any
     * write, for putus as well as konsi.
     */
    const inFlight = await tx.deliveryShipment.count({
      where: { orderId: order.id, status: { in: ["PACKED", "IN_TRANSIT"] } },
    });
    if (inFlight > 0) throw new DeliveryError("SHIPMENT_IN_FLIGHT");

    for (const l of openLines) {
      await tx.fieldSalesOrderLine.update({
        where: { id: l.id },
        data: { cancelledQty: { increment: outstandingQty(l) } },
      });
    }

    await releaseFieldSalesOrder(tx, { fieldSalesLineIds: openLines.map((l) => l.id) });

    const settled = order.lines.map((l) => ({
      orderLineId: l.id,
      qty: l.qty,
      deliveredQty: l.deliveredQty,
      cancelledQty: l.cancelledQty + outstandingQty(l),
    }));
    /**
     * The reason lands in its own column, never in `note` — that field is the salesman's PWA note
     * and is rendered as "Catatan" on the detail page, so appending to it would blend an admin's
     * cancellation reason into user-authored text with no way to separate them later.
     */
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: {
        deliveryStatus: nextDeliveryStatus(settled),
        closedAt: new Date(),
        closedById: input.closedById,
        closeReason: input.reason,
      },
    });

    return { ok: true };
  });
}
