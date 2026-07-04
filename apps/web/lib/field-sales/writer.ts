import { randomUUID } from "node:crypto";
import { prisma, Prisma, reserveFieldSalesOrder, consumeFieldSalesOrder, releaseFieldSalesOrder, type OversellAlert } from "@elorae/db";
import { effectiveMinQty, validateMinQtyLines, buildOfflineSalesHistoryRows } from "@elorae/db/field-sales";
import { NoActiveVisitError, MinQtyViolationError, InvalidOrderTransitionError } from "./errors";

const SER = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

type CreateLine = { itemId: string; variantSku: string; productName: string; qty: number; unitPrice: number };

/**
 * `generateDocNumber` (@/lib/docNumber) can't be reused here: its `type` param is the
 * Prisma `DocType` enum, which is a native MySQL ENUM column (DocNumberConfig/DocumentNumber)
 * and does not include "PUTUS". Extending that enum is a packages/db schema + migration
 * change outside this writer's scope, so putus order numbers get their own self-contained,
 * collision-safe generator instead of going through DocNumberConfig.
 */
function generatePutusOrderNo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `PUTUS/${y}${m}${d}/${suffix}`;
}

export async function createFieldSalesOrder(input: {
  storeId: string;
  salesmanId: string;
  visitId?: string;
  lines: CreateLine[];
  note?: string;
}): Promise<{ orderId: string; orderNo: string; oversell: OversellAlert[] }> {
  if (input.lines.length === 0) throw new MinQtyViolationError("", 1, 0);
  return prisma.$transaction(async (tx) => {
    const active = await tx.storeVisit.findFirst({
      where: { storeId: input.storeId, userId: input.salesmanId, checkoutAt: null },
      select: { id: true },
    });
    if (!active) throw new NoActiveVisitError(input.storeId, input.salesmanId);

    const itemIds = Array.from(new Set(input.lines.map((l) => l.itemId)));
    const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, minOrderQty: true } });
    const globalRow = await tx.systemSetting.findUnique({ where: { key: "putus.minOrderQty" } });
    const globalMin = globalRow ? Number(globalRow.value) : 6;
    const minByItemId = new Map(items.map((i) => [i.id, effectiveMinQty(i.minOrderQty, globalMin)]));
    const violation = validateMinQtyLines(input.lines, minByItemId);
    if (violation) throw new MinQtyViolationError(violation.itemId, violation.requiredMin, violation.actualQty);

    const orderNo = generatePutusOrderNo();
    const linesData = input.lines.map((l) => ({ ...l, lineTotal: l.qty * l.unitPrice }));
    const subtotal = linesData.reduce((s, l) => s + l.lineTotal, 0);

    const order = await tx.fieldSalesOrder.create({
      data: {
        orderNo,
        storeId: input.storeId,
        salesmanId: input.salesmanId,
        visitId: input.visitId ?? active.id,
        status: "PENDING_APPROVAL",
        subtotal,
        total: subtotal,
        note: input.note,
        lines: {
          create: linesData.map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku,
            productName: l.productName,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: { lines: true },
    });

    const { oversell } = await reserveFieldSalesOrder(tx, {
      orderNo,
      lines: order.lines.map((l) => ({ fieldSalesLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
    });

    await tx.adminNotification.create({
      data: {
        category: "PENDING_ORDER_APPROVAL",
        severity: "INFO",
        title: `Putus order ${orderNo} awaiting approval`,
        message: `New putus order ${orderNo} (total ${subtotal}) is pending approval.`,
        metadata: { orderId: order.id, orderNo, storeId: input.storeId, salesmanId: input.salesmanId, total: subtotal },
      },
    });

    return { orderId: order.id, orderNo, oversell };
  }, SER);
}

export async function approveFieldSalesOrder(input: { orderId: string; approvedById: string }): Promise<{ ok: true }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: { lines: { include: { item: { select: { sku: true, category: { select: { name: true } } } } } } },
    });
    if (!order) throw new InvalidOrderTransitionError("MISSING", "APPROVED");
    if (order.status === "APPROVED") return { ok: true };
    if (order.status !== "PENDING_APPROVAL") throw new InvalidOrderTransitionError(order.status, "APPROVED");

    await consumeFieldSalesOrder(tx, { orderNo: order.orderNo, fieldSalesLineIds: order.lines.map((l) => l.id) });

    const now = new Date();
    const rows = buildOfflineSalesHistoryRows({
      orderNo: order.orderNo,
      orderTotal: Number(order.total),
      lines: order.lines.map((l) => ({
        itemId: l.itemId,
        variantSku: l.variantSku,
        parentSku: l.item.sku,
        productName: l.productName,
        qty: l.qty,
        unitPrice: Number(l.unitPrice),
        lineTotal: Number(l.lineTotal),
        productCategory: l.item.category?.name ?? null,
      })),
    }).map((row) => ({ ...row, orderDate: now, completedDate: now }));
    await tx.salesHistory.createMany({ data: rows });

    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: input.approvedById },
    });
    return { ok: true };
  }, SER);
}

export async function rejectFieldSalesOrder(input: { orderId: string; rejectedById: string; reason?: string }): Promise<{ ok: true }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.fieldSalesOrder.findUnique({ where: { id: input.orderId }, include: { lines: { select: { id: true } } } });
    if (!order) throw new InvalidOrderTransitionError("MISSING", "REJECTED");
    if (order.status === "REJECTED") return { ok: true };
    if (order.status !== "PENDING_APPROVAL") throw new InvalidOrderTransitionError(order.status, "REJECTED");

    await releaseFieldSalesOrder(tx, { fieldSalesLineIds: order.lines.map((l) => l.id) });
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: input.rejectedById, rejectReason: input.reason },
    });
    return { ok: true };
  }, SER);
}
