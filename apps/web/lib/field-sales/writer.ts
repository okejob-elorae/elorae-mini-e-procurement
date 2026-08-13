import { reserveFieldSalesOrder, releaseFieldSalesOrder, reserveKonsiFieldSalesOrder, type OversellAlert, type AdminNotification } from "@elorae/db";
import { effectiveMinQty, validateMinQtyLines } from "@elorae/db/field-sales";
import { computeStorePrice } from "@elorae/db/pricing";
import { applyItemAggregatedPromos } from "./promo-apply";
import { fetchActivePromosForStore } from "@/lib/promos/queries";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { NoActiveVisitError, MinQtyViolationError, InvalidOrderTransitionError, InsufficientStockError, InvalidAddedLineError } from "./errors";
import { sentItemIds } from "./queries";

type CreateLine = {
  itemId: string;
  variantSku: string;
  productName: string;
  qty: number;
  unitPrice: number;
  requestedUnitPrice?: number | null;
  appealReason?: string | null;
};

export async function createFieldSalesOrder(input: {
  storeId: string;
  salesmanId: string;
  visitId?: string;
  lines: CreateLine[];
  note?: string;
  idempotencyKey?: string;
  skipMinQty?: boolean;
}): Promise<{ orderId: string; orderNo: string; oversell: OversellAlert[] }> {
  if (input.lines.length === 0) throw new MinQtyViolationError([]);
  let notification: AdminNotification | undefined;
  const result = await runSerializable(async (tx) => {
    /* Retry re-runs this whole callback; reset so a rolled-back attempt's row never survives into the next one. */
    notification = undefined;
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
      select: { termsType: true, marginPercent: true },
    });
    const isKonsi = store.termsType === "KONSI";
    const margin = store.marginPercent === null ? null : Number(store.marginPercent);

    // Server-authoritative putus price: the salesman never sets it, the office rules (store price) do.
    const priceByItemId = new Map<string, number | null>();
    if (!isKonsi) {
      const itemIds = Array.from(new Set(input.lines.map((l) => l.itemId)));
      const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, minOrderQty: true, sellingPrice: true } });
      for (const i of items) priceByItemId.set(i.id, i.sellingPrice === null ? null : Number(i.sellingPrice));
      if (!input.skipMinQty) {
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
    }

    const orderNo = await generateDocNumber(isKonsi ? "KONSI" : "PUTUS", tx);
    // Konsi lines carry no salesman price; gross-up is computed later at approve.
    const linesData = input.lines.map((l) => {
      const unitPrice = isKonsi
        ? 0
        : computeStorePrice({ sellingPrice: priceByItemId.get(l.itemId) ?? null, termsType: "PUTUS", marginPercent: margin }).price ?? 0;
      return {
        ...l,
        unitPrice,
        lineTotal: isKonsi ? 0 : l.qty * unitPrice,
        requestedUnitPrice: l.requestedUnitPrice ?? null,
        appealReason: l.appealReason ?? null,
      };
    });
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
            requestedUnitPrice: l.requestedUnitPrice,
            appealReason: l.appealReason,
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
      const promos = await fetchActivePromosForStore(input.storeId, new Date(), tx);
      // Per-item aggregate + pro-rate — shared with previewFieldSalesPromos so the quote matches.
      const applied = applyItemAggregatedPromos(
        order.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: Number(l.unitPrice), avgCost: avgCostById.get(l.itemId) ?? 0 })),
        promos,
      );
      let netTotal = 0;
      for (let i = 0; i < order.lines.length; i++) {
        const l = order.lines[i];
        netTotal += Number(l.lineTotal) - applied.lineDiscounts[i];
        await tx.fieldSalesOrderLine.update({ where: { id: l.id }, data: { discountAmount: applied.lineDiscounts[i], appliedPromoId: applied.lineAppliedPromoId[i] } });
      }
      netTotal -= applied.orderDiscountAmount;
      await tx.fieldSalesOrder.update({
        where: { id: order.id },
        data: { total: netTotal, orderDiscountAmount: applied.orderDiscountAmount, appliedOrderPromoId: applied.appliedOrderPromoId },
      });
      finalTotal = netTotal;
    }

    notification = await tx.adminNotification.create({
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

  /**
   * Outside the transaction on purpose — `fanOutAdminNotification` performs FCM network calls
   * and must never run inside one — and not awaited, because the salesman is watching a PWA
   * spinner on mobile data while the order that already committed waits on a bell ping. The
   * seam swallows its own failures, so there is no outcome here for this function to report.
   */
  if (notification) void fanOutAdminNotification(notification);
  return result;
}

export async function approveFieldSalesOrder(input: {
  orderId: string;
  approvedById: string;
  finalPrices?: Array<{ lineId: string; finalUnitPrice: number }>;
  addedLines?: Array<{ itemId: string; variantSku: string; qty: number }>;
}): Promise<{ ok: true }> {
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
      const added = input.addedLines ?? [];
      if (added.length > 0) {
        const onOrder = new Set(order.lines.map((l) => `${l.itemId}::${l.variantSku}`));
        const alreadySent = await sentItemIds(order.storeId, tx);
        const seen = new Set<string>();
        for (const a of added) {
          const key = `${a.itemId}::${a.variantSku}`;
          if (!Number.isInteger(a.qty) || a.qty <= 0) throw new InvalidAddedLineError("BAD_QTY", a.itemId);
          if (onOrder.has(key) || seen.has(key)) throw new InvalidAddedLineError("DUPLICATE", a.itemId);
          if (alreadySent.has(a.itemId)) throw new InvalidAddedLineError("ALREADY_SENT", a.itemId);
          seen.add(key);
        }
        const items = await tx.item.findMany({
          where: { id: { in: added.map((a) => a.itemId) }, isActive: true, type: "FINISHED_GOOD" },
          select: { id: true, sku: true, nameId: true },
        });
        const byId = new Map(items.map((i) => [i.id, i]));
        for (const a of added) {
          const item = byId.get(a.itemId);
          if (!item) throw new InvalidAddedLineError("UNKNOWN_ITEM", a.itemId);
          await tx.fieldSalesOrderLine.create({
            data: {
              orderId: order.id,
              itemId: item.id,
              variantSku: a.variantSku,
              productName: item.nameId,
              qty: a.qty,
              unitPrice: 0,
              lineTotal: 0,
              addedById: input.approvedById,
            },
          });
        }
      }

      /* Re-read: the lines created above are not in the `order.lines` snapshot taken at the top. */
      const lines = await tx.fieldSalesOrderLine.findMany({
        where: { orderId: order.id },
        include: { item: { select: { sku: true, sellingPrice: true, category: { select: { name: true } } } } },
      });

      const { shortLines } = await reserveKonsiFieldSalesOrder(tx, {
        orderNo: order.orderNo,
        lines: lines.map((l) => ({ fieldSalesLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
      });
      if (shortLines.length > 0) throw new InsufficientStockError(shortLines);

      const margin = order.store.marginPercent === null ? null : Number(order.store.marginPercent);
      let total = 0;
      for (const l of lines) {
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

    if ((input.addedLines ?? []).length > 0) {
      throw new InvalidAddedLineError("NOT_KONSI", null);
    }

    /**
     * PUTUS: apply owner's final appeal prices (Decision A — no promo recompute) and recompute the
     * order total. Create-time discounts are kept as-is. Stock consumption and SalesHistory happen
     * at delivery, not here (see delivery/writer.ts).
     */
    const finalPriceByLineId = new Map((input.finalPrices ?? []).map((f) => [f.lineId, f.finalUnitPrice]));
    let subtotal = 0;
    const finalLines: Array<
      Omit<(typeof order.lines)[number], "unitPrice" | "lineTotal"> & { unitPrice: number; lineTotal: number }
    > = [];
    for (const l of order.lines) {
      let unitPrice = Number(l.unitPrice);
      let lineTotal = Number(l.lineTotal);
      // Only an appealed line (requestedUnitPrice set) may be repriced; ignore stray entries.
      if (l.requestedUnitPrice !== null && finalPriceByLineId.has(l.id)) {
        unitPrice = finalPriceByLineId.get(l.id)!;
        lineTotal = l.qty * unitPrice;
        await tx.fieldSalesOrderLine.update({ where: { id: l.id }, data: { unitPrice, lineTotal } });
      }
      subtotal += lineTotal;
      finalLines.push({ ...l, unitPrice, lineTotal });
    }
    const discountTotal = finalLines.reduce((s, l) => s + Number(l.discountAmount), 0);
    const total = subtotal - discountTotal - Number(order.orderDiscountAmount);

    /**
     * Stock consumption and SalesHistory no longer happen here — a putus order ships in one or
     * more deliveries (see delivery/writer.ts), and stock only leaves + SalesHistory is only
     * written when a delivery is recorded.
     */
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: input.approvedById, subtotal, total },
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
