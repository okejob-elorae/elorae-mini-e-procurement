import { consumeFieldSalesOrderPartial, releaseFieldSalesOrder, PartialConsumeError } from "@elorae/db";
import { buildOfflineSalesHistoryRows } from "@elorae/db/field-sales";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { DeliveryError } from "../errors";
import { outstandingQty, nextDeliveryStatus, allocateDeliveryDiscounts } from "./plan";

export async function recordFieldSalesDelivery(input: {
  orderId: string;
  deliveredById: string;
  lines: Array<{ orderLineId: string; qty: number }>;
  note?: string;
  invoiceDate: Date;
  dueDate: Date;
  idempotencyKey?: string;
}): Promise<{ deliveryId: string; docNo: string }> {
  if (input.lines.length === 0) throw new DeliveryError("NO_LINES");

  if (input.dueDate.getTime() < input.invoiceDate.getTime()) {
    throw new DeliveryError("INVALID_DATES");
  }

  return runSerializable(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.fieldSalesDelivery.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, docNo: true },
      });
      if (existing) return { deliveryId: existing.id, docNo: existing.docNo };
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
    const now = new Date();

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

    /**
     * Consume AFTER the delivery row exists so the audit adjustment can key on the real delivery
     * id. Everything here is one serializable transaction, so a short-stock throw rolls the
     * delivery back with it.
     */
    try {
      await consumeFieldSalesOrderPartial(tx, {
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
          e.code === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "OVER_DELIVER",
          e.shortLines.map((s) => ({ orderLineId: s.fieldSalesLineId, requested: s.requested, onHand: s.onHand })),
        );
      }
      throw e;
    }

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
    if (order.status !== "APPROVED" || order.orderType !== "PUTUS") throw new DeliveryError("INVALID_STATE");

    const openLines = order.lines.filter((l) => outstandingQty(l) > 0);
    if (openLines.length === 0) throw new DeliveryError("INVALID_STATE");

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
