import { reserveFieldSalesOrder, consumeFieldSalesOrder, releaseFieldSalesOrder, reserveKonsiFieldSalesOrder, type OversellAlert } from "@elorae/db";
import { effectiveMinQty, validateMinQtyLines, buildOfflineSalesHistoryRows } from "@elorae/db/field-sales";
import { computeStorePrice } from "@elorae/db/pricing";
import { computeOrderPromos } from "@elorae/db/promo";
import { fetchActivePromosForStore } from "@/lib/promos/queries";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { NoActiveVisitError, MinQtyViolationError, InvalidOrderTransitionError, InsufficientStockError } from "./errors";
import { distributeDiscountProRata } from "./promo-distribute";

type CreateLine = { itemId: string; variantSku: string; productName: string; qty: number; unitPrice: number };

export async function createFieldSalesOrder(input: {
  storeId: string;
  salesmanId: string;
  visitId?: string;
  lines: CreateLine[];
  note?: string;
  idempotencyKey?: string;
}): Promise<{ orderId: string; orderNo: string; oversell: OversellAlert[] }> {
  if (input.lines.length === 0) throw new MinQtyViolationError([]);
  return runSerializable(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.fieldSalesOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, orderNo: true } });
      if (existing) return { orderId: existing.id, orderNo: existing.orderNo, oversell: [] as OversellAlert[] };
    }

    let visitId: string;
    if (input.visitId) {
      const v = await tx.storeVisit.findFirst({
        where: { id: input.visitId, storeId: input.storeId, userId: input.salesmanId },
        select: { id: true },
      });
      if (!v) throw new NoActiveVisitError(input.storeId, input.salesmanId);
      visitId = v.id;
    } else {
      const active = await tx.storeVisit.findFirst({
        where: { storeId: input.storeId, userId: input.salesmanId, checkoutAt: null },
        select: { id: true },
      });
      if (!active) throw new NoActiveVisitError(input.storeId, input.salesmanId);
      visitId = active.id;
    }

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
      // Aggregate qty per item so an item's variants collectively satisfy the min.
      const qtyByItem = new Map<string, number>();
      for (const l of input.lines) qtyByItem.set(l.itemId, (qtyByItem.get(l.itemId) ?? 0) + l.qty);
      const aggLines = Array.from(qtyByItem, ([itemId, qty]) => ({ itemId, qty }));
      const violations = validateMinQtyLines(aggLines, minByItemId);
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
    let finalTotal = subtotal;

    const order = await tx.fieldSalesOrder.create({
      data: {
        orderNo,
        orderType: isKonsi ? "KONSI" : "PUTUS",
        storeId: input.storeId,
        salesmanId: input.salesmanId,
        visitId,
        status: "PENDING_APPROVAL",
        subtotal,
        total: subtotal,
        note: input.note,
        idempotencyKey: input.idempotencyKey ?? null,
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

      // Apply promos (server-authoritative, honor-at-create).
      const itemMeta = await tx.item.findMany({
        where: { id: { in: Array.from(new Set(order.lines.map((l) => l.itemId))) } },
        select: { id: true, inventoryValues: { select: { avgCost: true } } },
      });
      const avgCostById = new Map(itemMeta.map((i) => [i.id, i.inventoryValues[0] ? Number(i.inventoryValues[0].avgCost) : 0]));
      // group order.lines by itemId (preserve line order for distribution)
      const linesByItem = new Map<string, typeof order.lines>();
      for (const l of order.lines) {
        const arr = linesByItem.get(l.itemId) ?? [];
        arr.push(l);
        linesByItem.set(l.itemId, arr);
      }
      const itemAgg = Array.from(linesByItem, ([itemId, ls]) => ({
        itemId,
        qty: ls.reduce((s, l) => s + l.qty, 0),
        unitPrice: Number(ls[0].unitPrice),
        avgCost: avgCostById.get(itemId) ?? 0,
      }));
      const promos = await fetchActivePromosForStore(input.storeId, new Date(), tx);
      const result = computeOrderPromos({ lines: itemAgg, activePromos: promos });

      let netTotal = 0;
      for (let a = 0; a < itemAgg.length; a++) {
        const itemId = itemAgg[a].itemId;
        const res = result.lines[a];
        const ls = linesByItem.get(itemId)!;
        const parts = distributeDiscountProRata(ls.map((l) => Number(l.lineTotal)), res.discountAmount);
        for (let j = 0; j < ls.length; j++) {
          const l = ls[j];
          netTotal += Number(l.lineTotal) - parts[j];
          await tx.fieldSalesOrderLine.update({ where: { id: l.id }, data: { discountAmount: parts[j], appliedPromoId: res.appliedPromoId } });
        }
      }
      netTotal -= result.orderDiscountAmount;
      await tx.fieldSalesOrder.update({
        where: { id: order.id },
        data: { total: netTotal, orderDiscountAmount: result.orderDiscountAmount, appliedOrderPromoId: result.appliedOrderPromoId },
      });
      finalTotal = netTotal;
    }

    await tx.adminNotification.create({
      data: {
        category: "PENDING_ORDER_APPROVAL",
        severity: "INFO",
        title: `${isKonsi ? "Konsi transfer" : "Putus order"} ${orderNo} awaiting approval`,
        message: isKonsi
          ? `New konsi transfer request ${orderNo} is pending approval.`
          : `New putus order ${orderNo} (total ${finalTotal}) is pending approval.`,
        metadata: { orderId: order.id, orderNo, orderType: isKonsi ? "KONSI" : "PUTUS", storeId: input.storeId, salesmanId: input.salesmanId, total: finalTotal },
      },
    });

    return { orderId: order.id, orderNo, oversell };
  });
}

export async function approveFieldSalesOrder(input: { orderId: string; approvedById: string }): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
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

    // PUTUS: consume + materialize SalesHistory with NET figures (honor-at-create; no promo recompute here).
    await consumeFieldSalesOrder(tx, { orderNo: order.orderNo, fieldSalesLineIds: order.lines.map((l) => l.id) });
    const now = new Date();
    const rows = buildOfflineSalesHistoryRows({
      orderNo: order.orderNo,
      orderTotal: Number(order.total),
      lines: order.lines.map((l) => {
        const net = Number(l.lineTotal) - Number(l.discountAmount);
        return {
          itemId: l.itemId,
          variantSku: l.variantSku,
          parentSku: l.item.sku,
          productName: l.productName,
          qty: l.qty,
          unitPrice: l.qty > 0 ? net / l.qty : 0,
          lineTotal: net,
          productCategory: l.item.category?.name ?? null,
        };
      }),
    }).map((row) => ({ ...row, orderDate: now, completedDate: now }));
    await tx.salesHistory.createMany({ data: rows });
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: input.approvedById },
    });
    return { ok: true };
  });
}

export async function rejectFieldSalesOrder(input: { orderId: string; rejectedById: string; reason?: string }): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
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
  });
}
