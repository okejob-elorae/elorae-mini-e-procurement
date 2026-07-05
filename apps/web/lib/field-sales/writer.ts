import { prisma, Prisma, reserveFieldSalesOrder, consumeFieldSalesOrder, releaseFieldSalesOrder, reserveKonsiFieldSalesOrder, type OversellAlert } from "@elorae/db";
import { effectiveMinQty, validateMinQtyLines, buildOfflineSalesHistoryRows } from "@elorae/db/field-sales";
import { computeStorePrice } from "@elorae/db/pricing";
import { generateDocNumber } from "@/lib/docNumber";
import { NoActiveVisitError, MinQtyViolationError, InvalidOrderTransitionError, InsufficientStockError } from "./errors";

const SER = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

type CreateLine = { itemId: string; variantSku: string; productName: string; qty: number; unitPrice: number };

export async function createFieldSalesOrder(input: {
  storeId: string;
  salesmanId: string;
  visitId?: string;
  lines: CreateLine[];
  note?: string;
}): Promise<{ orderId: string; orderNo: string; oversell: OversellAlert[] }> {
  if (input.lines.length === 0) throw new MinQtyViolationError([]);
  return prisma.$transaction(async (tx) => {
    const active = await tx.storeVisit.findFirst({
      where: { storeId: input.storeId, userId: input.salesmanId, checkoutAt: null },
      select: { id: true },
    });
    if (!active) throw new NoActiveVisitError(input.storeId, input.salesmanId);

    const store = await tx.store.findUniqueOrThrow({
      where: { id: input.storeId },
      select: { termsType: true },
    });
    const isKonsi = store.termsType === "KONSI";

    if (!isKonsi) {
      const itemIds = Array.from(new Set(input.lines.map((l) => l.itemId)));
      const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, minOrderQty: true } });
      const globalRow = await tx.systemSetting.findUnique({ where: { key: "putus.minOrderQty" } });
      const globalMin = globalRow ? Number(globalRow.value) : 6;
      const minByItemId = new Map(items.map((i) => [i.id, effectiveMinQty(i.minOrderQty, globalMin)]));
      const violations = validateMinQtyLines(input.lines, minByItemId);
      if (violations.length > 0) throw new MinQtyViolationError(violations);
    }

    const orderNo = await generateDocNumber(isKonsi ? "KONSI" : "PUTUS", tx);
    // Konsi lines carry no salesman price; gross-up is computed later at approve.
    const linesData = input.lines.map((l) => ({
      ...l,
      unitPrice: isKonsi ? 0 : l.unitPrice,
      lineTotal: isKonsi ? 0 : l.qty * l.unitPrice,
    }));
    const subtotal = linesData.reduce((s, l) => s + l.lineTotal, 0);

    const order = await tx.fieldSalesOrder.create({
      data: {
        orderNo,
        orderType: isKonsi ? "KONSI" : "PUTUS",
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

    // Putus reserves at create; konsi reserves at approve (see approveFieldSalesOrder).
    let oversell: OversellAlert[] = [];
    if (!isKonsi) {
      const r = await reserveFieldSalesOrder(tx, {
        orderNo,
        lines: order.lines.map((l) => ({ fieldSalesLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
      });
      oversell = r.oversell;
    }

    await tx.adminNotification.create({
      data: {
        category: "PENDING_ORDER_APPROVAL",
        severity: "INFO",
        title: `${isKonsi ? "Konsi transfer" : "Putus order"} ${orderNo} awaiting approval`,
        message: isKonsi
          ? `New konsi transfer request ${orderNo} is pending approval.`
          : `New putus order ${orderNo} (total ${subtotal}) is pending approval.`,
        metadata: { orderId: order.id, orderNo, orderType: isKonsi ? "KONSI" : "PUTUS", storeId: input.storeId, salesmanId: input.salesmanId, total: subtotal },
      },
    });

    return { orderId: order.id, orderNo, oversell };
  }, SER);
}

export async function approveFieldSalesOrder(input: { orderId: string; approvedById: string }): Promise<{ ok: true }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: {
        store: { select: { marginPercent: true } },
        lines: { include: { item: { select: { sku: true, sellingPrice: true, category: { select: { name: true } } } } } },
      },
    });
    if (!order) throw new InvalidOrderTransitionError("MISSING", "APPROVED");
    if (order.status === "APPROVED") return { ok: true };
    if (order.status !== "PENDING_APPROVAL") throw new InvalidOrderTransitionError(order.status, "APPROVED");

    if (order.orderType === "KONSI") {
      const { shortLines } = await reserveKonsiFieldSalesOrder(tx, {
        orderNo: order.orderNo,
        lines: order.lines.map((l) => ({ fieldSalesLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
      });
      if (shortLines.length > 0) throw new InsufficientStockError(shortLines);

      const margin = order.store.marginPercent === null ? null : Number(order.store.marginPercent);
      let total = 0;
      for (const l of order.lines) {
        const { price } = computeStorePrice({
          sellingPrice: l.item.sellingPrice === null ? null : Number(l.item.sellingPrice),
          termsType: "KONSI",
          marginPercent: margin,
        });
        const unit = price ?? 0;
        const lineTotal = unit * l.qty;
        total += lineTotal;
        await tx.fieldSalesOrderLine.update({ where: { id: l.id }, data: { unitPrice: unit, lineTotal } });
      }
      await tx.fieldSalesOrder.update({
        where: { id: order.id },
        data: { status: "APPROVED", approvedAt: new Date(), approvedById: input.approvedById, subtotal: total, total },
      });
      return { ok: true };
    }

    // PUTUS (unchanged): consume + materialize SalesHistory
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
