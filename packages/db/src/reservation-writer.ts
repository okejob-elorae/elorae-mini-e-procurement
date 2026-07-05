import { AdjustmentType, Prisma, type PrismaClient } from "../generated/prisma/client";
import type { StockAdjustmentSource } from "./stock-adjustment-source";
import { InventoryValueMissingError } from "./stock-writer";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export type ReservationLine = {
  salesorderDetailId: number;
  itemId: string;
  variantSku: string;
  qty: number;
};

export type OversellAlert = { itemId: string; variantSku: string; available: number };
export type ReserveOrderInput = { salesorderId: number; salesorderNo: string; lines: ReservationLine[] };
export type ReserveOrderResult = { reserved: number; skipped: number; oversell: OversellAlert[] };

function hasTx(client: AnyClient): client is PrismaClient {
  return typeof (client as PrismaClient).$transaction === "function";
}

async function findFieldSalesInventory(tx: Prisma.TransactionClient, itemId: string, variantSku: string) {
  // Variantless rows use variantSku: null in this codebase (not ""); tolerate both.
  return variantSku === ""
    ? tx.inventoryValue.findFirst({ where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] } })
    : tx.inventoryValue.findFirst({ where: { itemId, variantSku } });
}

export async function reserveOrder(client: AnyClient, input: ReserveOrderInput): Promise<ReserveOrderResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<ReserveOrderResult> => {
    let reserved = 0;
    let skipped = 0;
    const oversell: OversellAlert[] = [];

    for (const line of input.lines) {
      const existing = await tx.stockReservation.findUnique({
        where: { salesorderDetailId: line.salesorderDetailId },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      await tx.stockReservation.create({
        data: {
          salesorderId: input.salesorderId,
          salesorderDetailId: line.salesorderDetailId,
          itemId: line.itemId,
          variantSku: line.variantSku,
          qty: line.qty,
          state: "RESERVED",
        },
      });

      const inv = await tx.inventoryValue.findUnique({
        where: { itemId_variantSku: { itemId: line.itemId, variantSku: line.variantSku } },
      });
      if (!inv) throw new InventoryValueMissingError(line.itemId, line.variantSku);
      const updated = await tx.inventoryValue.update({
        where: { itemId_variantSku: { itemId: line.itemId, variantSku: line.variantSku } },
        data: { reservedQty: { increment: line.qty }, lastUpdated: new Date() },
        select: { qtyOnHand: true, reservedQty: true },
      });
      reserved += 1;

      const available = Number(updated.qtyOnHand) - Number(updated.reservedQty);
      if (available < 0) {
        oversell.push({ itemId: line.itemId, variantSku: line.variantSku, available });
        await tx.adminNotification.create({
          data: {
            category: "STOCK_OVERSELL_RISK",
            severity: "WARN",
            title: `Oversell risk on salesorder ${input.salesorderNo || input.salesorderId}`,
            message: `SKU ${line.itemId}${line.variantSku ? `/${line.variantSku}` : ""} available stock is negative — potential oversell`,
            metadata: { salesorderId: input.salesorderId, itemId: line.itemId, variantSku: line.variantSku, available },
          },
        });
      }
    }

    return { reserved, skipped, oversell };
  };

  return hasTx(client) ? client.$transaction(run) : run(client);
}

export type ConsumeOrderResult = { consumed: number };

export async function consumeOrder(
  client: AnyClient,
  input: { salesorderId: number; salesorderNo: string },
): Promise<ConsumeOrderResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<ConsumeOrderResult> => {
    const rows = await tx.stockReservation.findMany({
      where: { salesorderId: input.salesorderId, state: "RESERVED" },
    });
    let consumed = 0;

    for (const row of rows) {
      const upd = await tx.stockReservation.updateMany({
        where: { salesorderDetailId: row.salesorderDetailId, state: "RESERVED" },
        data: { state: "CONSUMED", resolvedAt: new Date() },
      });
      if (upd.count === 0) continue; // lost the race — another trigger consumed it

      const qty = Number(row.qty);
      const inv = await tx.inventoryValue.findUnique({
        where: { itemId_variantSku: { itemId: row.itemId, variantSku: row.variantSku } },
      });
      if (!inv) throw new InventoryValueMissingError(row.itemId, row.variantSku);
      const avgCost = Number(inv.avgCost);
      const updated = await tx.inventoryValue.update({
        where: { itemId_variantSku: { itemId: row.itemId, variantSku: row.variantSku } },
        data: {
          qtyOnHand: { decrement: qty },
          reservedQty: { decrement: qty },
          totalValue: { decrement: qty * avgCost },
          lastUpdated: new Date(),
        },
        select: { qtyOnHand: true },
      });
      const newOnHand = Number(updated.qtyOnHand);
      const prevOnHand = newOnHand + qty;

      await tx.stockAdjustment.create({
        data: {
          docNumber: `CONSUME-${input.salesorderId}-${row.salesorderDetailId}`,
          itemId: row.itemId,
          type: AdjustmentType.NEGATIVE,
          qtyChange: -qty,
          reason: `Fulfillment ship — salesorder ${input.salesorderNo || input.salesorderId}`,
          prevQty: prevOnHand,
          newQty: newOnHand,
          prevAvgCost: avgCost,
          newAvgCost: avgCost,
          source: "FULFILLMENT_CONSUME" satisfies StockAdjustmentSource,
          idempotencyKey: `salesorder-${input.salesorderId}-consume-line-${row.salesorderDetailId}`,
          externalRef: `salesorder:${input.salesorderId}`,
        },
      });

      consumed += 1;
    }

    return { consumed };
  };

  return hasTx(client) ? client.$transaction(run) : run(client);
}

export type ReleaseOrderResult = { released: number };

export async function releaseOrder(
  client: AnyClient,
  input: { salesorderId: number },
): Promise<ReleaseOrderResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<ReleaseOrderResult> => {
    const rows = await tx.stockReservation.findMany({
      where: { salesorderId: input.salesorderId, state: "RESERVED" },
    });
    let released = 0;

    for (const row of rows) {
      const upd = await tx.stockReservation.updateMany({
        where: { salesorderDetailId: row.salesorderDetailId, state: "RESERVED" },
        data: { state: "RELEASED", resolvedAt: new Date() },
      });
      if (upd.count === 0) continue;

      const inv = await tx.inventoryValue.findUnique({
        where: { itemId_variantSku: { itemId: row.itemId, variantSku: row.variantSku } },
      });
      if (!inv) throw new InventoryValueMissingError(row.itemId, row.variantSku);
      await tx.inventoryValue.update({
        where: { itemId_variantSku: { itemId: row.itemId, variantSku: row.variantSku } },
        data: { reservedQty: { decrement: Number(row.qty) }, lastUpdated: new Date() },
      });
      released += 1;
    }

    return { released };
  };

  return hasTx(client) ? client.$transaction(run) : run(client);
}

export type FieldSalesReservationLine = { fieldSalesLineId: string; itemId: string; variantSku: string; qty: number };

export async function reserveFieldSalesOrder(
  client: AnyClient,
  input: { orderNo: string; lines: FieldSalesReservationLine[] },
): Promise<ReserveOrderResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<ReserveOrderResult> => {
    let reserved = 0;
    let skipped = 0;
    const oversell: OversellAlert[] = [];
    for (const line of input.lines) {
      const existing = await tx.stockReservation.findUnique({
        where: { fieldSalesLineId: line.fieldSalesLineId },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await tx.stockReservation.create({
        data: {
          source: "FIELD_SALES",
          fieldSalesLineId: line.fieldSalesLineId,
          itemId: line.itemId,
          variantSku: line.variantSku,
          qty: line.qty,
          state: "RESERVED",
        },
      });
      const inv = await findFieldSalesInventory(tx, line.itemId, line.variantSku);
      if (!inv) throw new InventoryValueMissingError(line.itemId, line.variantSku);
      const updated = await tx.inventoryValue.update({
        where: { id: inv.id },
        data: { reservedQty: { increment: line.qty }, lastUpdated: new Date() },
        select: { qtyOnHand: true, reservedQty: true },
      });
      reserved += 1;
      const available = Number(updated.qtyOnHand) - Number(updated.reservedQty);
      if (available < 0) {
        oversell.push({ itemId: line.itemId, variantSku: line.variantSku, available });
        await tx.adminNotification.create({
          data: {
            category: "STOCK_OVERSELL_RISK",
            severity: "WARN",
            title: `Oversell risk on field-sales order ${input.orderNo}`,
            message: `SKU ${line.itemId}${line.variantSku ? `/${line.variantSku}` : ""} available stock is negative — potential oversell`,
            metadata: { orderNo: input.orderNo, itemId: line.itemId, variantSku: line.variantSku, available },
          },
        });
      }
    }
    return { reserved, skipped, oversell };
  };
  return hasTx(client) ? client.$transaction(run) : run(client);
}

export async function consumeFieldSalesOrder(
  client: AnyClient,
  input: { orderNo: string; fieldSalesLineIds: string[] },
): Promise<ConsumeOrderResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<ConsumeOrderResult> => {
    const rows = await tx.stockReservation.findMany({
      where: { source: "FIELD_SALES", fieldSalesLineId: { in: input.fieldSalesLineIds }, state: "RESERVED" },
    });
    let consumed = 0;
    for (const row of rows) {
      const upd = await tx.stockReservation.updateMany({
        where: { fieldSalesLineId: row.fieldSalesLineId, state: "RESERVED" },
        data: { state: "CONSUMED", resolvedAt: new Date() },
      });
      if (upd.count === 0) continue;
      const qty = Number(row.qty);
      const inv = await findFieldSalesInventory(tx, row.itemId, row.variantSku);
      if (!inv) throw new InventoryValueMissingError(row.itemId, row.variantSku);
      const avgCost = Number(inv.avgCost);
      const updated = await tx.inventoryValue.update({
        where: { id: inv.id },
        data: {
          qtyOnHand: { decrement: qty },
          reservedQty: { decrement: qty },
          totalValue: { decrement: qty * avgCost },
          lastUpdated: new Date(),
        },
        select: { qtyOnHand: true },
      });
      const newOnHand = Number(updated.qtyOnHand);
      const prevOnHand = newOnHand + qty;
      await tx.stockAdjustment.create({
        data: {
          docNumber: `CONSUME-${input.orderNo}-${row.fieldSalesLineId}`,
          itemId: row.itemId,
          type: AdjustmentType.NEGATIVE,
          qtyChange: -qty,
          reason: `Field-sales putus order ${input.orderNo}`,
          prevQty: prevOnHand,
          newQty: newOnHand,
          prevAvgCost: avgCost,
          newAvgCost: avgCost,
          source: "FIELD_SALES_CONSUME" satisfies StockAdjustmentSource,
          idempotencyKey: `fieldsales-${input.orderNo}-consume-line-${row.fieldSalesLineId}`,
          externalRef: `fieldsales:${input.orderNo}`,
        },
      });
      consumed += 1;
    }
    return { consumed };
  };
  return hasTx(client) ? client.$transaction(run) : run(client);
}

export async function releaseFieldSalesOrder(
  client: AnyClient,
  input: { fieldSalesLineIds: string[] },
): Promise<ReleaseOrderResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<ReleaseOrderResult> => {
    const rows = await tx.stockReservation.findMany({
      where: { source: "FIELD_SALES", fieldSalesLineId: { in: input.fieldSalesLineIds }, state: "RESERVED" },
    });
    let released = 0;
    for (const row of rows) {
      const upd = await tx.stockReservation.updateMany({
        where: { fieldSalesLineId: row.fieldSalesLineId, state: "RESERVED" },
        data: { state: "RELEASED", resolvedAt: new Date() },
      });
      if (upd.count === 0) continue;
      const inv = await findFieldSalesInventory(tx, row.itemId, row.variantSku);
      if (!inv) throw new InventoryValueMissingError(row.itemId, row.variantSku);
      await tx.inventoryValue.update({
        where: { id: inv.id },
        data: { reservedQty: { decrement: Number(row.qty) }, lastUpdated: new Date() },
      });
      released += 1;
    }
    return { released };
  };
  return hasTx(client) ? client.$transaction(run) : run(client);
}

export type KonsiReserveResult = { reserved: number; skipped: number; shortLines: OversellAlert[] };

export async function reserveKonsiFieldSalesOrder(
  client: AnyClient,
  input: { orderNo: string; lines: FieldSalesReservationLine[] },
): Promise<KonsiReserveResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<KonsiReserveResult> => {
    let reserved = 0;
    let skipped = 0;
    const shortLines: OversellAlert[] = [];
    for (const line of input.lines) {
      const existing = await tx.stockReservation.findUnique({
        where: { fieldSalesLineId: line.fieldSalesLineId },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      const inv = await findFieldSalesInventory(tx, line.itemId, line.variantSku);
      if (!inv) throw new InventoryValueMissingError(line.itemId, line.variantSku);
      // Atomic guard: only increment if available (qtyOnHand - reservedQty) still covers qty.
      // Prevents the check-then-write race under concurrent approvals.
      const affected = await tx.$executeRaw`
        UPDATE InventoryValue
        SET reservedQty = reservedQty + ${line.qty}, lastUpdated = NOW(3)
        WHERE id = ${inv.id} AND (qtyOnHand - reservedQty) >= ${line.qty}
      `;
      if (affected === 0) {
        shortLines.push({ itemId: line.itemId, variantSku: line.variantSku, available: Number(inv.qtyOnHand) - Number(inv.reservedQty) });
        continue;
      }
      await tx.stockReservation.create({
        data: {
          source: "FIELD_SALES_KONSI",
          fieldSalesLineId: line.fieldSalesLineId,
          itemId: line.itemId,
          variantSku: line.variantSku,
          qty: line.qty,
          state: "RESERVED",
        },
      });
      reserved += 1;
    }
    return { reserved, skipped, shortLines };
  };
  return hasTx(client) ? client.$transaction(run) : run(client);
}
