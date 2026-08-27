import { reserveFieldSalesOrder, releaseFieldSalesOrder, reserveKonsiFieldSalesOrder, type OversellAlert, type AdminNotification, type Prisma } from "@elorae/db";
import { effectiveMinQty, validateMinQtyLines } from "@elorae/db/field-sales";
import { computeStorePrice } from "@elorae/db/pricing";
import { applyItemAggregatedPromos } from "./promo-apply";
import { issueKonsiTransfer } from "./konsi-transfer/writer";
import { fetchActivePromosForStore } from "@/lib/promos/queries";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { computeStoreCreditExposure } from "@/lib/finance/ar/credit-exposure";
import { NoActiveVisitError, MinQtyViolationError, InvalidOrderTransitionError, InsufficientStockError, InvalidAddedLineError, CreditLimitExceededError } from "./errors";
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
}): Promise<{ orderId: string; orderNo: string; oversell: OversellAlert[]; creditHold: boolean }> {
  if (input.lines.length === 0) throw new MinQtyViolationError([]);
  let notification: AdminNotification | undefined;
  let creditHold = false;
  const result = await runSerializable(async (tx) => {
    /* Retry re-runs this whole callback; reset so a rolled-back attempt's row never survives into the next one. */
    notification = undefined;
    creditHold = false;
    if (input.idempotencyKey) {
      const existing = await tx.fieldSalesOrder.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, orderNo: true, creditHoldAtCreate: true },
      });
      if (existing) return { orderId: existing.id, orderNo: existing.orderNo, oversell: [] as OversellAlert[], creditHold: existing.creditHoldAtCreate };
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
      select: { termsType: true, marginPercent: true, priceDiscountPercent: true, creditLimit: true },
    });
    const isKonsi = store.termsType === "KONSI";
    const margin = store.marginPercent === null ? null : Number(store.marginPercent);
    const priceDiscount = store.priceDiscountPercent === null ? null : Number(store.priceDiscountPercent);

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
        : computeStorePrice({ sellingPrice: priceByItemId.get(l.itemId) ?? null, termsType: "PUTUS", marginPercent: margin, priceDiscountPercent: priceDiscount }).price ?? 0;
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

      creditHold = false;
      let creditExposureAtCreate: number | null = null;
      let creditLimitAtCreate: number | null = null;
      const creditLimit = store.creditLimit === null ? null : Number(store.creditLimit);
      if (creditLimit !== null) {
        const exposure = await computeStoreCreditExposure(tx, input.storeId);
        creditHold = exposure.total + netTotal > creditLimit;
        creditExposureAtCreate = exposure.total;
        creditLimitAtCreate = creditLimit;
      }

      await tx.fieldSalesOrder.update({
        where: { id: order.id },
        data: {
          total: netTotal,
          orderDiscountAmount: applied.orderDiscountAmount,
          appliedOrderPromoId: applied.appliedOrderPromoId,
          creditHoldAtCreate: creditHold,
          creditExposureAtCreate,
          creditLimitAtCreate,
        },
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

    return { orderId: order.id, orderNo, oversell, creditHold };
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

/**
 * Which of the given (itemId, variantSku) candidates are CURRENT assortment gaps for this store,
 * batched into two queries regardless of candidate count. Mirrors `listAssortmentGaps`'s gap test
 * (`packages/db` has no access to that helper, and it reads through the un-transacted `prisma`
 * singleton anyway) — `targetQty === null` means "must merely be present" (`onHandQty <= 0`),
 * `targetQty !== null` means a minimum (`onHandQty < targetQty`). Run inside the caller's own
 * transaction so the gap read is consistent with the `StoreStock` state the approval itself acts
 * on, not a stale snapshot from before the transaction opened.
 */
async function currentAssortmentGapKeys(
  tx: Prisma.TransactionClient,
  storeId: string,
  candidates: Array<{ itemId: string; variantSku: string }>,
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const itemIds = Array.from(new Set(candidates.map((c) => c.itemId)));
  const lines = await tx.storeAssortmentLine.findMany({
    where: { storeId, itemId: { in: itemIds } },
    select: { itemId: true, variantSku: true, targetQty: true },
  });
  if (lines.length === 0) return new Set();
  const stockRows = await tx.storeStock.findMany({
    where: { storeId, itemId: { in: itemIds } },
    select: { itemId: true, variantSku: true, qty: true },
  });
  const onHandByKey = new Map(stockRows.map((r) => [`${r.itemId}::${r.variantSku ?? ""}`, r.qty.toNumber()]));
  const gapKeys = new Set<string>();
  for (const line of lines) {
    const key = `${line.itemId}::${line.variantSku ?? ""}`;
    const onHandQty = onHandByKey.get(key) ?? 0;
    const targetQty = line.targetQty === null ? null : line.targetQty.toNumber();
    const isGap = targetQty === null ? onHandQty <= 0 : onHandQty < targetQty;
    if (isGap) gapKeys.add(key);
  }
  return gapKeys;
}

export async function approveFieldSalesOrder(input: {
  orderId: string;
  approvedById: string;
  finalPrices?: Array<{ lineId: string; finalUnitPrice: number }>;
  addedLines?: Array<{ itemId: string; variantSku: string; qty: number }>;
  creditOverrideReason?: string;
}): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: {
        store: { select: { marginPercent: true, priceDiscountPercent: true, creditLimit: true } },
        lines: { include: { item: { select: { sku: true, sellingPrice: true, category: { select: { name: true } } } } } },
      },
    });
    if (!order) throw new InvalidOrderTransitionError("MISSING", "APPROVED");
    /**
     * Re-approving an already-APPROVED order is a no-op ONLY when the caller carries nothing new.
     * With additions it is not idempotent at all: two admins can have the same order open, and the
     * second one's staged products would be accepted, discarded, and reported as a success that
     * created nothing. Refuse instead, so the operator sees the same "already decided" toast an
     * already-approved order gets everywhere else.
     */
    if (order.status === "APPROVED") {
      if ((input.addedLines ?? []).length > 0) throw new InvalidOrderTransitionError(order.status, "APPROVED");
      return { ok: true };
    }
    if (order.status !== "PENDING_APPROVAL") throw new InvalidOrderTransitionError(order.status, "APPROVED");

    if (order.orderType === "KONSI") {
      const added = input.addedLines ?? [];
      if (added.length > 0) {
        const onOrder = new Set(order.lines.map((l) => `${l.itemId}::${l.variantSku}`));
        const alreadySent = await sentItemIds(order.storeId, tx);
        const gapKeys = await currentAssortmentGapKeys(
          tx,
          order.storeId,
          added.map((a) => ({ itemId: a.itemId, variantSku: a.variantSku ?? "" })),
        );
        const items = await tx.item.findMany({
          where: { id: { in: added.map((a) => a.itemId) }, isActive: true, type: "FINISHED_GOOD" },
          select: { id: true, nameId: true },
        });
        const byId = new Map(items.map((i) => [i.id, i]));
        // Same OR-tolerant (itemId, variantSku) lookup reserveKonsiFieldSalesOrder's own
        // findFieldSalesInventory uses — a variantless row is stored keyed null, not "".
        const hasInventoryRow = async (itemId: string, variantSku: string) => {
          const inv =
            variantSku === ""
              ? await tx.inventoryValue.findFirst({ where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] } })
              : await tx.inventoryValue.findFirst({ where: { itemId, variantSku } });
          return inv !== null;
        };
        const seen = new Set<string>();
        // All validation runs before any write below, so a rejected payload never depends on
        // transaction rollback to leave the order untouched.
        for (const a of added) {
          const key = `${a.itemId}::${a.variantSku}`;
          if (!Number.isInteger(a.qty) || a.qty <= 0) throw new InvalidAddedLineError("BAD_QTY", a.itemId);
          // onOrder MUST be checked before alreadySent: sentItemIds(storeId) includes the
          // PENDING_APPROVAL order being approved, so every item already on this order is also
          // "already sent" — swapping the order changes which code fires for it (DUPLICATE vs
          // ALREADY_SENT), and the DUPLICATE test below pins the intended order.
          if (onOrder.has(key) || seen.has(key)) throw new InvalidAddedLineError("DUPLICATE", a.itemId);
          // ALREADY_SENT is item-level (sentItemIds has no variant dimension) while the dedupe
          // above is variant-level, so a different variant of an item already on the order is
          // rejected here, not there. Correct for an item-level "never sent" suggestion list —
          // flagged so it isn't a surprise to a future reader.
          //
          // EXCEPT: an item sentItemIds flags as "already sent" can still be a CURRENT assortment
          // gap for this store (shipped once, now at zero, or below its target) — exactly the
          // population listKonsiAssortmentGaps exists to surface, and exactly what the gap panel
          // just offered the admin to stage. Refusing it here would abort the whole approval for
          // the feature's primary use case. gapKeys is keyed at (itemId, variantSku) grain, so a
          // gap on one variant does not exempt a different variant of the same item — that other
          // variant still hits ALREADY_SENT below, unchanged. ALREADY_SENT still fires for a line
          // that is merely "never sent" and NOT a current gap — i.e. an admin re-adding something
          // the never-sent list should not have offered.
          if (alreadySent.has(a.itemId) && !gapKeys.has(key)) throw new InvalidAddedLineError("ALREADY_SENT", a.itemId);
          if (!byId.has(a.itemId)) throw new InvalidAddedLineError("UNKNOWN_ITEM", a.itemId);
          // A variantSku with no matching InventoryValue row would otherwise surface later as
          // InventoryValueMissingError out of reserveKonsiFieldSalesOrder — a @elorae/db class
          // with no `code`, which the action layer has nothing to map to a UI-facing reason.
          // Its own code, not UNKNOWN_ITEM: the product exists and is active, so "not found or no
          // longer active" would be untrue and reloading the page would not surface the cause.
          if (!(await hasInventoryRow(a.itemId, a.variantSku))) throw new InvalidAddedLineError("NO_INVENTORY", a.itemId);
          seen.add(key);
        }
        for (const a of added) {
          const item = byId.get(a.itemId)!;
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
      const priceDiscount = order.store.priceDiscountPercent === null ? null : Number(order.store.priceDiscountPercent);
      let total = 0;
      for (const l of lines) {
        const { price } = computeStorePrice({
          sellingPrice: l.item.sellingPrice === null ? null : Number(l.item.sellingPrice),
          termsType: "KONSI",
          marginPercent: margin,
          priceDiscountPercent: priceDiscount,
        });
        const unit = price ?? 0;
        const lineTotal = unit * l.qty;
        total += lineTotal;
        await tx.fieldSalesOrderLine.update({ where: { id: l.id }, data: { unitPrice: unit, lineTotal } });
      }

      /**
       * Konsi is a transfer, not a sale: stock leaves main and lands in the store's virtual
       * warehouse right here, in the same transaction that just reserved it — never through
       * consumeFieldSalesOrder (packages/db/src/reservation-writer.ts), which is an orphaned
       * FIELD_SALES_CONSUME trap with no production caller. No SalesHistory is written for konsi.
       */
      await issueKonsiTransfer(tx, {
        order: {
          id: order.id,
          storeId: order.storeId,
          lines: lines.map((l) => ({ id: l.id, itemId: l.itemId, variantSku: l.variantSku, productName: l.productName, qty: l.qty })),
        },
        transferredById: input.approvedById,
      });

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
    const finalLines: Array<{ id: string; unitPrice: number; lineTotal: number; discountAmount: Prisma.Decimal; changed: boolean }> = [];
    for (const l of order.lines) {
      let unitPrice = Number(l.unitPrice);
      let lineTotal = Number(l.lineTotal);
      let changed = false;
      // Only an appealed line (requestedUnitPrice set) may be repriced; ignore stray entries.
      if (l.requestedUnitPrice !== null && finalPriceByLineId.has(l.id)) {
        unitPrice = finalPriceByLineId.get(l.id)!;
        lineTotal = l.qty * unitPrice;
        changed = true;
      }
      subtotal += lineTotal;
      finalLines.push({ id: l.id, unitPrice, lineTotal, discountAmount: l.discountAmount, changed });
    }
    const discountTotal = finalLines.reduce((s, l) => s + Number(l.discountAmount), 0);
    const total = subtotal - discountTotal - Number(order.orderDiscountAmount);

    /**
     * Credit gate — computed and enforced BEFORE any write below, including the per-line
     * unitPrice/lineTotal updates the finalPrices loop used to fire first. `runSerializable` is a
     * plain `prisma.$transaction`: it commits on a normal return and rolls back only on a throw,
     * so a refusal placed after any write would commit that write while reporting a block. See
     * docs/superpowers/specs/2026-08-27-credit-limit-enforcement-design.md § 4.
     *
     * The order being approved is still PENDING_APPROVAL here — computeStoreCreditExposure only
     * counts APPROVED orders in its residual term, so this order is not counted against itself.
     */
    const creditLimit = order.store.creditLimit === null ? null : Number(order.store.creditLimit);
    let creditExposureAtApprove: number | null = null;
    let creditLimitAtApprove: number | null = null;
    let overrideReason: string | null = null;
    if (creditLimit !== null) {
      const exposure = await computeStoreCreditExposure(tx, order.storeId);
      if (exposure.total + total > creditLimit) {
        const reason = input.creditOverrideReason?.trim();
        if (!reason) {
          throw new CreditLimitExceededError(exposure, creditLimit, total);
        }
        creditExposureAtApprove = exposure.total;
        creditLimitAtApprove = creditLimit;
        overrideReason = reason;
        await tx.auditLog.create({
          data: {
            userId: input.approvedById,
            action: "CREDIT_LIMIT_OVERRIDE",
            entityType: "FieldSalesOrder",
            entityId: order.id,
            reason,
            metadata: { exposure, creditLimit, orderTotal: total },
          },
        });
      }
    }

    for (const l of finalLines) {
      if (l.changed) {
        await tx.fieldSalesOrderLine.update({ where: { id: l.id }, data: { unitPrice: l.unitPrice, lineTotal: l.lineTotal } });
      }
    }

    /**
     * Stock consumption and SalesHistory no longer happen here — a putus order ships in one or
     * more deliveries (see delivery/writer.ts), and stock only leaves + SalesHistory is only
     * written when a delivery is recorded.
     */
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedById: input.approvedById,
        subtotal,
        total,
        ...(creditExposureAtApprove !== null
          ? {
              creditExposureAtApprove,
              creditLimitAtApprove,
              creditOverrideReason: overrideReason,
              creditOverrideById: input.approvedById,
              creditOverrideAt: new Date(),
            }
          : {}),
      },
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
