import { Prisma, type PrismaClient } from "../generated/prisma/client";
import type { StockAdjustmentSource } from "./stock-adjustment-source";

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
      const onHand = inv ? Number(inv.qtyOnHand) : 0;
      const newReserved = (inv ? Number(inv.reservedQty) : 0) + line.qty;
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

export const _sourceGuard: StockAdjustmentSource = "FULFILLMENT_CONSUME";
