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
      const onHand = Number(inv.qtyOnHand);
      const newReserved = Number(inv.reservedQty) + line.qty;
      await tx.inventoryValue.update({
        where: { itemId_variantSku: { itemId: line.itemId, variantSku: line.variantSku } },
        data: { reservedQty: newReserved, lastUpdated: new Date() },
      });
      reserved += 1;

      const available = onHand - newReserved;
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
      const prevOnHand = inv ? Number(inv.qtyOnHand) : 0;
      const avgCost = inv ? Number(inv.avgCost) : 0;
      const prevReserved = inv ? Number(inv.reservedQty) : 0;
      const newOnHand = prevOnHand - qty;
      const newReserved = Math.max(0, prevReserved - qty);

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

      await tx.inventoryValue.update({
        where: { itemId_variantSku: { itemId: row.itemId, variantSku: row.variantSku } },
        data: { qtyOnHand: newOnHand, reservedQty: newReserved, totalValue: newOnHand * avgCost, lastUpdated: new Date() },
      });
      consumed += 1;
    }

    return { consumed };
  };

  return hasTx(client) ? client.$transaction(run) : run(client);
}
