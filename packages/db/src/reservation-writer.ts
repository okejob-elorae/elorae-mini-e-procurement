import { AdjustmentType, Prisma, type PrismaClient } from "../generated/prisma/client";
import { sqlId, nowMs } from "./sql-dialect";
import type { StockAdjustmentSource } from "./stock-adjustment-source";
import type { StockLedgerRefType } from "./stock-ledger-ref";
import { ledgerTypeForDelta, moveMainStock } from "./stock-balance";
import { appendStockLedger } from "./stock-ledger";
import { InventoryValueMissingError } from "./stock-writer";

/*
 * The three statements below stay raw SQL (see the comment at each call site:
 * each folds a guard into the UPDATE so two concurrent writers can't both pass
 * off one stale read). Raw SQL means dialect matters — see ./sql-dialect for
 * what id() and nowMs() paper over between MySQL and PostgreSQL.
 *
 * The source is a literal, not a bound parameter: PostgreSQL compares an enum column with an
 * untyped literal, but refuses a text parameter without a cast.
 */
function consumeReservationSql(fieldSalesLineId: string, qty: number): Prisma.Sql {
  return Prisma.sql`
    UPDATE ${sqlId("StockReservation")}
    SET ${sqlId("consumedQty")} = ${sqlId("consumedQty")} + ${qty}
    WHERE ${sqlId("fieldSalesLineId")} = ${fieldSalesLineId}
      AND ${sqlId("source")} = 'FIELD_SALES'
      AND ${sqlId("state")} = 'RESERVED'
      AND ${sqlId("consumedQty")} + ${qty} <= ${sqlId("qty")}
  `;
}

function shipInventorySql(invId: string, qty: number, valueDelta: number): Prisma.Sql {
  return Prisma.sql`
    UPDATE ${sqlId("InventoryValue")}
    SET ${sqlId("qtyOnHand")} = ${sqlId("qtyOnHand")} - ${qty},
        ${sqlId("reservedQty")} = ${sqlId("reservedQty")} - ${qty},
        ${sqlId("totalValue")} = ${sqlId("totalValue")} - ${valueDelta},
        ${sqlId("lastUpdated")} = ${nowMs()}
    WHERE ${sqlId("id")} = ${invId} AND ${sqlId("qtyOnHand")} >= ${qty}
  `;
}

function reserveInventorySql(invId: string, qty: number): Prisma.Sql {
  return Prisma.sql`
    UPDATE ${sqlId("InventoryValue")}
    SET ${sqlId("reservedQty")} = ${sqlId("reservedQty")} + ${qty},
        ${sqlId("lastUpdated")} = ${nowMs()}
    WHERE ${sqlId("id")} = ${invId} AND (${sqlId("qtyOnHand")} - ${sqlId("reservedQty")}) >= ${qty}
  `;
}

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

/**
 * Picks the row EVERY reserve in this file lands on, Jubelio and field sales alike, and is the
 * fallback behind resolveReservedInventory for every consume and release.
 * Variantless rows may key on null OR "": prefers the exact "" row, then null. A bare OR
 * findFirst can pick the sibling and orphan reservedQty. NULLs are distinct under the unique
 * index, so two null rows can exist; the id tie-break keeps every reserve on one row.
 */
async function findReservationInventory(tx: Prisma.TransactionClient, itemId: string, variantSku: string) {
  if (variantSku !== "") {
    return tx.inventoryValue.findFirst({ where: { itemId, variantSku } });
  }
  const exactEmpty = await tx.inventoryValue.findFirst({ where: { itemId, variantSku: "" } });
  if (exactEmpty) return exactEmpty;
  return tx.inventoryValue.findFirst({ where: { itemId, variantSku: null }, orderBy: { id: "asc" } });
}

/**
 * The row a consume or release acts on: the one its reserve stored as `inventoryValueId`. Re-running
 * the lookup instead would move the consume onto a variantless sibling provisioned for the item
 * after the reserve, driving that row's qtyOnHand negative and stranding reservedQty on the real one.
 * Falls back to findReservationInventory for a reservation made before the column existed (null)
 * or whose pinned row no longer exists. The itemId filter is an ownership check: a pinned id that
 * does not belong to the item is treated as missing, never written.
 */
export async function resolveReservedInventory(
  tx: Prisma.TransactionClient,
  reservation: { itemId: string; variantSku: string; inventoryValueId: string | null },
) {
  if (reservation.inventoryValueId) {
    const pinned = await tx.inventoryValue.findFirst({
      where: { id: reservation.inventoryValueId, itemId: reservation.itemId },
    });
    if (pinned) return pinned;
  }
  return findReservationInventory(tx, reservation.itemId, reservation.variantSku);
}

/*
 * Baris stok untuk penahanan pesanan marketplace (dan kirim/batalnya).
 *
 * Kunci "" = barang tanpa varian; barisnya bisa tersimpan "" (ingest katalog,
 * GRN) atau null (barang yang dibuat di ERP) — keduanya diterima, "" didahulukan
 * bila kembar supaya pilihan selalu sama. Varian yang tidak punya baris sendiri
 * jatuh ke baris gabungan HANYA bila barang itu belum punya baris per-varian
 * sama sekali (barang buatan ERP yang stoknya masih satu baris); kalau ada baris
 * per-varian lain, varian itu memang tidak tercatat dan tetap ditolak.
 * Tidak pernah membuat baris. `kunci` = variantSku yang dicatat di
 * StockReservation, jadi kirim dan batal mengenai baris yang sama persis.
 * Retur marketplace yang diterima (`acceptReturnItem`) memakai aturan yang sama,
 * supaya barang kembali ke baris tempat ia dijual.
 */
export async function barisStokPesanan(
  tx: Prisma.TransactionClient,
  itemId: string,
  variantSku: string,
): Promise<{ id: string; avgCost: Prisma.Decimal; kunci: string } | null> {
  if (variantSku !== "") {
    const persis = await tx.inventoryValue.findUnique({
      where: { itemId_variantSku: { itemId, variantSku } },
      select: { id: true, avgCost: true },
    });
    if (persis) return { ...persis, kunci: variantSku };
    const perVarian = await tx.inventoryValue.count({
      where: { itemId, AND: [{ variantSku: { not: null } }, { variantSku: { not: "" } }] },
    });
    if (perVarian > 0) return null;
  }
  const gabungan = await tx.inventoryValue.findMany({
    where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
    orderBy: { id: "asc" },
    select: { id: true, avgCost: true, variantSku: true },
  });
  const pilih = gabungan.find((b) => b.variantSku === "") ?? gabungan[0];
  return pilih ? { id: pilih.id, avgCost: pilih.avgCost, kunci: "" } : null;
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

      const inv = await barisStokPesanan(tx, line.itemId, line.variantSku);
      if (!inv) throw new InventoryValueMissingError(line.itemId, line.variantSku);

      await tx.stockReservation.create({
        data: {
          salesorderId: input.salesorderId,
          salesorderDetailId: line.salesorderDetailId,
          itemId: line.itemId,
          variantSku: inv.kunci,
          qty: line.qty,
          state: "RESERVED",
          inventoryValueId: inv.id,
        },
      });

      /* No ledger entry: a reservation moves no stock. Only qtyOnHand movements are ledger events. */
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
      where: { source: "JUBELIO", salesorderId: input.salesorderId, state: "RESERVED" },
    });
    let consumed = 0;

    for (const row of rows) {
      const upd = await tx.stockReservation.updateMany({
        where: { source: "JUBELIO", salesorderDetailId: row.salesorderDetailId, state: "RESERVED" },
        data: { state: "CONSUMED", resolvedAt: new Date() },
      });
      if (upd.count === 0) continue; // lost the race — another trigger consumed it

      const qty = Number(row.qty);
      const inv = await resolveReservedInventory(tx, row);
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

      /**
       * One ledger entry for the qtyOnHand movement only. The same statement also releases the
       * reservation, but that half moves nothing and is deliberately not a second entry.
       * balanceQty comes from the update's own return value, never a follow-up read, so it
       * cannot race the concurrent webhook workers.
       *
       * totalCost/balanceValue reuse the SAME `qty * avgCost` expression the update above just
       * decremented totalValue by (also the SAME figure stamped onto SalesOrderItem.cogs below)
       * — avgCost does not change on a consume, so newOnHand * avgCost is the row's real new
       * total value, not a re-derivation.
       */
      await appendStockLedger(tx, {
        location: { type: "MAIN" },
        itemId: row.itemId,
        variantSku: row.variantSku,
        type: ledgerTypeForDelta(-qty),
        qty: -qty,
        balanceQty: newOnHand,
        unitCost: avgCost,
        totalCost: -(qty * avgCost),
        balanceValue: newOnHand * avgCost,
        refType: "FulfillmentConsume" satisfies StockLedgerRefType,
        refId: row.id,
        refDocNumber: input.salesorderNo,
      });

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

      if (row.salesorderDetailId != null) {
        await tx.salesOrderItem.updateMany({
          where: { salesorderDetailId: row.salesorderDetailId },
          data: { cogs: qty * avgCost },
        });
      }

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
      where: { source: "JUBELIO", salesorderId: input.salesorderId, state: "RESERVED" },
    });
    let released = 0;

    for (const row of rows) {
      const upd = await tx.stockReservation.updateMany({
        where: { source: "JUBELIO", salesorderDetailId: row.salesorderDetailId, state: "RESERVED" },
        data: { state: "RELEASED", resolvedAt: new Date() },
      });
      if (upd.count === 0) continue;

      const inv = await resolveReservedInventory(tx, row);
      if (!inv) throw new InventoryValueMissingError(row.itemId, row.variantSku);
      /* No ledger entry: releasing a reservation moves no stock. Only qtyOnHand movements are ledger events. */
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
      const inv = await findReservationInventory(tx, line.itemId, line.variantSku);
      if (!inv) throw new InventoryValueMissingError(line.itemId, line.variantSku);
      await tx.stockReservation.create({
        data: {
          source: "FIELD_SALES",
          fieldSalesLineId: line.fieldSalesLineId,
          itemId: line.itemId,
          variantSku: line.variantSku,
          qty: line.qty,
          state: "RESERVED",
          inventoryValueId: inv.id,
        },
      });
      /* No ledger entry: a reservation moves no stock. Only qtyOnHand movements are ledger events. */
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

export type PartialConsumeShortLine = {
  fieldSalesLineId: string;
  itemId: string;
  variantSku: string;
  requested: number;
  /* On-hand before this call moved anything. */
  onHand: number;
  /* What was left for THIS line after earlier lines in the same call took from the same row. */
  available: number;
};

export class PartialConsumeError extends Error {
  constructor(
    readonly code: "OVER_CONSUME" | "INSUFFICIENT_STOCK",
    readonly shortLines: PartialConsumeShortLine[] = [],
  ) {
    super(`Partial consume rejected: ${code}`);
    this.name = "PartialConsumeError";
  }
}

export type PartialConsumeLine = { fieldSalesLineId: string; itemId: string; variantSku: string; qty: number };

export type PartialConsumeResult = {
  consumed: number;
  lines: Array<{ fieldSalesLineId: string; qty: number; avgCost: number }>;
};

export async function consumeFieldSalesOrderPartial(
  client: AnyClient,
  input: { orderNo: string; deliveryId: string; lines: PartialConsumeLine[] },
): Promise<PartialConsumeResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<PartialConsumeResult> => {
    const shortLines: PartialConsumeShortLine[] = [];
    const prepared: Array<{ line: PartialConsumeLine; invId: string; avgCost: number; fullyConsumed: boolean }> = [];

    for (const line of input.lines) {
      // Atomic guard: only bump consumedQty if it still fits within the reserved qty.
      // Folds the OVER_CONSUME check into the write so two concurrent partial consumes
      // on the same fieldSalesLineId can't both pass a stale read (see reserveKonsiFieldSalesOrder
      // for the same idiom against InventoryValue).
      /* No ledger entry: StockReservation is not an inventory balance table. */
      const affected = await tx.$executeRaw(consumeReservationSql(line.fieldSalesLineId, line.qty));
      if (affected === 0) throw new PartialConsumeError("OVER_CONSUME");

      // Re-read post-update so fullyConsumed reflects this call's own committed increment,
      // not the pre-write snapshot.
      const res = await tx.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: line.fieldSalesLineId } });
      const fullyConsumed = Number(res.consumedQty) >= Number(res.qty);

      const inv = await resolveReservedInventory(tx, {
        itemId: line.itemId,
        variantSku: line.variantSku,
        inventoryValueId: res.inventoryValueId,
      });
      if (!inv) throw new InventoryValueMissingError(line.itemId, line.variantSku);
      prepared.push({
        line,
        invId: inv.id,
        avgCost: Number(inv.avgCost),
        fullyConsumed,
      });
    }

    let consumed = 0;
    const consumedLines: Array<{ fieldSalesLineId: string; qty: number; avgCost: number }> = [];
    /* Quantity this call has already taken per resolved row, so a short line reports on-hand as it stood before the call. */
    const takenByRow = new Map<string, number>();
    for (const p of prepared) {
      const qty = p.line.qty;
      /**
       * Atomic guard: only decrement if on-hand still covers this line, the same idiom
       * reserveKonsiFieldSalesOrder uses against InventoryValue. Two lines that resolve to the
       * SAME row (same item + variant) each check against the row's state as of this
       * transaction's OWN prior write, not a stale pre-loop snapshot — so the second line
       * correctly fails instead of both passing off one read and driving stock negative. Also
       * closes the cross-process race the old read-then-write left open.
       */
      const affected = await tx.$executeRaw(
        shipInventorySql(p.invId, qty, qty * p.avgCost),
      );
      if (affected === 0) {
        const current = await tx.inventoryValue.findUniqueOrThrow({ where: { id: p.invId }, select: { qtyOnHand: true } });
        shortLines.push({
          fieldSalesLineId: p.line.fieldSalesLineId,
          itemId: p.line.itemId,
          variantSku: p.line.variantSku,
          requested: qty,
          onHand: Number(current.qtyOnHand) + (takenByRow.get(p.invId) ?? 0),
          available: Number(current.qtyOnHand),
        });
        continue;
      }
      if (p.fullyConsumed) {
        await tx.stockReservation.updateMany({
          where: { fieldSalesLineId: p.line.fieldSalesLineId, state: "RESERVED" },
          data: { state: "CONSUMED", resolvedAt: new Date() },
        });
      }
      /**
       * Success path only — the affected === 0 branch above has already continued. Reading the
       * row back is safe here in a way it is not for a Prisma update: $executeRaw returns an
       * affected-row count rather than the row, the transaction sees its own write, and the row
       * is already locked by the update that just succeeded.
       */
      const updated = await tx.inventoryValue.findUniqueOrThrow({ where: { id: p.invId }, select: { qtyOnHand: true } });
      const newOnHand = Number(updated.qtyOnHand);
      /**
       * One ledger entry for the qtyOnHand movement only. The guarded update also released the
       * reservation in the same statement, but that half moves nothing and is not a second entry.
       *
       * totalCost/balanceValue reuse the SAME `qty * p.avgCost` expression the raw UPDATE above
       * just decremented totalValue by — avgCost is unchanged by a consume, so
       * newOnHand * p.avgCost is the row's real new total value.
       */
      await appendStockLedger(tx, {
        location: { type: "MAIN" },
        itemId: p.line.itemId,
        variantSku: p.line.variantSku,
        type: ledgerTypeForDelta(-qty),
        qty: -qty,
        balanceQty: newOnHand,
        unitCost: p.avgCost,
        totalCost: -(qty * p.avgCost),
        balanceValue: newOnHand * p.avgCost,
        refType: "FieldSalesConsume" satisfies StockLedgerRefType,
        refId: p.line.fieldSalesLineId,
        refDocNumber: input.orderNo,
      });
      await tx.stockAdjustment.create({
        data: {
          docNumber: `CONSUME-${input.orderNo}-${input.deliveryId}-${p.line.fieldSalesLineId}`,
          itemId: p.line.itemId,
          type: AdjustmentType.NEGATIVE,
          qtyChange: -qty,
          reason: `Field-sales putus delivery for order ${input.orderNo}`,
          prevQty: newOnHand + qty,
          newQty: newOnHand,
          prevAvgCost: p.avgCost,
          newAvgCost: p.avgCost,
          source: "FIELD_SALES_CONSUME" satisfies StockAdjustmentSource,
          idempotencyKey: `fieldsales-${input.orderNo}-delivery-${input.deliveryId}-line-${p.line.fieldSalesLineId}`,
          externalRef: `fieldsales:${input.orderNo}`,
        },
      });
      takenByRow.set(p.invId, (takenByRow.get(p.invId) ?? 0) + qty);
      consumed += 1;
      consumedLines.push({ fieldSalesLineId: p.line.fieldSalesLineId, qty, avgCost: p.avgCost });
    }
    if (shortLines.length > 0) throw new PartialConsumeError("INSUFFICIENT_STOCK", shortLines);
    return { consumed, lines: consumedLines };
  };
  return hasTx(client) ? client.$transaction(run) : run(client);
}

export async function releaseFieldSalesOrder(
  client: AnyClient,
  input: { fieldSalesLineIds: string[] },
): Promise<ReleaseOrderResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<ReleaseOrderResult> => {
    /* Both field-sales sources: a konsi order reserves at approve and releases its remainder here too. Callers pass explicit line ids, so the wider source cannot reach another order. */
    const rows = await tx.stockReservation.findMany({
      where: {
        source: { in: ["FIELD_SALES", "FIELD_SALES_KONSI"] },
        fieldSalesLineId: { in: input.fieldSalesLineIds },
        state: "RESERVED",
      },
    });
    let released = 0;
    for (const row of rows) {
      const upd = await tx.stockReservation.updateMany({
        where: { fieldSalesLineId: row.fieldSalesLineId, state: "RESERVED" },
        data: { state: "RELEASED", resolvedAt: new Date() },
      });
      if (upd.count === 0) continue;
      const inv = await resolveReservedInventory(tx, row);
      if (!inv) throw new InventoryValueMissingError(row.itemId, row.variantSku);
      const stillHeld = Number(row.qty) - Number(row.consumedQty);
      if (stillHeld > 0) {
        /* No ledger entry: releasing a reservation moves no stock. Only qtyOnHand movements are ledger events. */
        await tx.inventoryValue.update({
          where: { id: inv.id },
          data: { reservedQty: { decrement: stillHeld }, lastUpdated: new Date() },
        });
      }
      released += 1;
    }
    return { released };
  };
  return hasTx(client) ? client.$transaction(run) : run(client);
}

export type KonsiReserveResult = { reserved: number; skipped: number; shortLines: OversellAlert[] };

/**
 * The konsi approve path (`approveKonsiOrderInTx`): approve only RESERVES. Stock leaves main at
 * delivery-shipment completion through `issueKonsiTransfer`, which draws this reservation down
 * line by line, and a remainder that never ships is released by closing the order's remainder
 * (`releaseFieldSalesOrder`). A RESERVED reservation of this source therefore belongs to the
 * delivery flow — nothing else may cut stock against it or release it.
 */
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
      const inv = await findReservationInventory(tx, line.itemId, line.variantSku);
      if (!inv) throw new InventoryValueMissingError(line.itemId, line.variantSku);
      // Atomic guard: only increment if available (qtyOnHand - reservedQty) still covers qty.
      // Prevents the check-then-write race under concurrent approvals.
      /* No ledger entry: a reservation moves no stock. Only qtyOnHand movements are ledger events. */
      const affected = await tx.$executeRaw(reserveInventorySql(inv.id, line.qty));
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
          inventoryValueId: inv.id,
        },
      });
      reserved += 1;
    }
    return { reserved, skipped, shortLines };
  };
  return hasTx(client) ? client.$transaction(run) : run(client);
}

/*
 * Toko konsinyasi = gudang lain milik kita (keputusan pemilik): barang keluar dari stok gudang
 * utama saat DIKIRIM ke toko itu, menjadi stok toko (buku toko / titipan), dan kembali ke gudang
 * hanya lewat retur (NRI). Penjualan di toko tidak pernah menyentuh gudang utama.
 *
 * Pemindahan di bawah ini dipakai kiriman titipan modul konsinyasi (`kirimTitipan`) dan koreksi
 * kiriman lamanya. Pesanan KONSI salesman TIDAK lewat sini: stoknya pindah lewat alur pengiriman
 * (lihat `reserveKonsiFieldSalesOrder`).
 *
 * Stok bergerak lewat `moveMainStock`, jadi setiap potongan tercatat di buku stok bersama
 * penyesuaian KONSI_TRANSFER-nya; entri bukunya menunjuk penyesuaian itu (refType
 * `StockAdjustment`, refId = id penyesuaian). Harga rata-rata TIDAK digeser: pindah gudang bukan
 * pembelian; nilainya keluar sebesar qty × avgCost saat itu.
 *
 * Penjaga: ON_HAND = stok fisik tidak boleh negatif — dijaga atomik oleh lantai `moveMainStock`
 * (`MainStockNegativeError` membatalkan seluruh dokumen). AVAILABLE (bawaan) juga menolak stok
 * yang sudah dicadangkan pesanan lain; cadangan tidak terlihat oleh lantai itu, jadi angkanya dibaca
 * dari baris di transaksi pemanggil — pemanggil wajib serializable (`kirimTitipan` dan koreksi
 * memakai runSerializable) supaya cadangan baru tidak menyelinap di antara bacaan dan potongan.
 */
export type KonsiTransferGuard = "AVAILABLE" | "ON_HAND";

export type KonsiTransferLine = {
  itemId: string;
  /** "" = barang tanpa varian; baris persediaan `null` maupun `""` ditemukan. */
  variantSku: string;
  qty: number;
  /** Unik per baris dokumen sumber: kiriman ulang / balapan tidak memotong dua kali. */
  idempotencyKey: string;
  docNumber: string;
  reason: string;
  externalRef: string;
  createdById?: string | null;
};

export type KonsiTransferShortLine = { itemId: string; variantSku: string; requested: number; available: number };
export type KonsiTransferResult = { transferred: number; skipped: number; shortLines: KonsiTransferShortLine[] };

/** Kunci idempotensi pemindahan satu baris pesanan konsinyasi salesman. */
export function konsiTransferKeyForLine(fieldSalesLineId: string): string {
  return `konsi-transfer-line-${fieldSalesLineId}`;
}

type SatuPindah = { status: "TRANSFERRED" } | { status: "SKIPPED" } | { status: "SHORT"; short: KonsiTransferShortLine };

async function pindahkanSatuBaris(
  tx: Prisma.TransactionClient,
  line: KonsiTransferLine,
  guard: KonsiTransferGuard,
): Promise<SatuPindah> {
  const sudah = await tx.stockAdjustment.findUnique({ where: { idempotencyKey: line.idempotencyKey }, select: { id: true } });
  if (sudah) return { status: "SKIPPED" };

  const inv = await findReservationInventory(tx, line.itemId, line.variantSku);
  if (!inv) {
    return { status: "SHORT", short: { itemId: line.itemId, variantSku: line.variantSku, requested: line.qty, available: 0 } };
  }
  const prevQty = Number(inv.qtyOnHand);
  const avgCost = Number(inv.avgCost);
  const available = guard === "AVAILABLE" ? prevQty - Number(inv.reservedQty) : prevQty;
  if (available < line.qty) {
    return { status: "SHORT", short: { itemId: line.itemId, variantSku: line.variantSku, requested: line.qty, available } };
  }
  const newQty = prevQty - line.qty;

  const adj = await tx.stockAdjustment.create({
    data: {
      docNumber: line.docNumber,
      itemId: line.itemId,
      type: AdjustmentType.NEGATIVE,
      qtyChange: -line.qty,
      reason: line.reason,
      prevQty,
      newQty,
      prevAvgCost: avgCost,
      newAvgCost: avgCost,
      createdById: line.createdById ?? null,
      source: "KONSI_TRANSFER" satisfies StockAdjustmentSource,
      idempotencyKey: line.idempotencyKey,
      externalRef: line.externalRef,
    },
    select: { id: true },
  });
  // Dipatok ke baris yang baru dibaca: baris tanpa varian bisa tersimpan null DAN "", dan
  // pencarian ulang di dalam mover bisa jatuh ke kembarannya.
  await moveMainStock(tx, {
    itemId: line.itemId,
    variantSku: line.variantSku,
    qtyDelta: -line.qty,
    inventoryValueId: inv.id,
    unitCost: avgCost,
    totalCost: -(line.qty * avgCost),
    totalValue: newQty * avgCost,
    balanceValue: newQty * avgCost,
    refType: "StockAdjustment" satisfies StockLedgerRefType,
    refId: adj.id,
    refDocNumber: line.docNumber,
    createdById: line.createdById ?? null,
  });
  return { status: "TRANSFERRED" };
}

/**
 * Pindahkan stok gudang utama ke toko konsinyasi, satu baris per dokumen sumber.
 *
 * Baris yang kurang dikembalikan di `shortLines` dan TIDAK dipotong; baris lain yang sudah
 * terpotong tetap tertulis di transaksi ini — PEMANGGIL wajib melempar galat bila `shortLines`
 * tidak kosong, supaya seluruh dokumen batal bersama (pengiriman separuh bukan pengiriman).
 */
export async function transferKonsiStock(
  client: AnyClient,
  input: { lines: KonsiTransferLine[]; guard?: KonsiTransferGuard },
): Promise<KonsiTransferResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<KonsiTransferResult> => {
    let transferred = 0;
    let skipped = 0;
    const shortLines: KonsiTransferShortLine[] = [];
    for (const line of input.lines) {
      const h = await pindahkanSatuBaris(tx, line, input.guard ?? "AVAILABLE");
      if (h.status === "TRANSFERRED") transferred += 1;
      else if (h.status === "SKIPPED") skipped += 1;
      else shortLines.push(h.short);
    }
    return { transferred, skipped, shortLines };
  };
  return hasTx(client) ? client.$transaction(run) : run(client);
}

/**
 * Pindahkan baris pesanan konsinyasi salesman yang TIDAK punya cadangan sama sekali.
 *
 * Tidak ada alur yang memanggilnya lagi: persetujuan konsinyasi hanya mencadangkan dan stoknya
 * pindah saat pengiriman selesai (lihat `reserveKonsiFieldSalesOrder`). Baris yang sudah punya
 * cadangan SELALU dilewati — RESERVED milik alur pengiriman (memotongnya di sini membuat pengiriman
 * berikutnya ditolak, atau memotong lagi untuk baris yang sebagian sudah dikirim), CONSUMED dan
 * RELEASED sudah selesai.
 *
 * Baris yang dipindah mendapat satu `StockReservation` (FIELD_SALES_KONSI) berstatus CONSUMED
 * sebagai tanda per baris — `fieldSalesLineId` unik, dan penyesuaian stoknya berkunci
 * `konsiTransferKeyForLine`, jadi tidak pernah dipotong dua kali.
 *
 * `guard`: AVAILABLE (bawaan) menolak bila stok tersedia kurang; ON_HAND hanya menjaga stok fisik
 * tidak negatif. Pemanggil wajib melempar galat bila `shortLines` tidak kosong (lihat
 * `transferKonsiStock`).
 */
export async function transferKonsiFieldSalesOrder(
  client: AnyClient,
  input: { orderNo: string; lines: FieldSalesReservationLine[]; guard?: KonsiTransferGuard; createdById?: string | null },
): Promise<KonsiTransferResult> {
  const guard = input.guard ?? "AVAILABLE";
  const run = async (tx: Prisma.TransactionClient): Promise<KonsiTransferResult> => {
    let transferred = 0;
    let skipped = 0;
    const shortLines: KonsiTransferShortLine[] = [];
    for (const line of input.lines) {
      const ada = await tx.stockReservation.findUnique({ where: { fieldSalesLineId: line.fieldSalesLineId }, select: { id: true } });
      if (ada) {
        skipped += 1;
        continue;
      }
      const h = await pindahkanSatuBaris(
        tx,
        {
          itemId: line.itemId,
          variantSku: line.variantSku,
          qty: line.qty,
          idempotencyKey: konsiTransferKeyForLine(line.fieldSalesLineId),
          docNumber: `KONSI-${input.orderNo}-${line.fieldSalesLineId}`,
          reason: `Kirim konsinyasi ${input.orderNo} (stok pindah ke toko)`,
          externalRef: `fieldsales:${input.orderNo}`,
          createdById: input.createdById ?? null,
        },
        guard,
      );
      if (h.status === "SHORT") {
        shortLines.push(h.short);
        continue;
      }
      if (h.status === "SKIPPED") {
        skipped += 1;
        continue;
      }
      await tx.stockReservation.create({
        data: {
          source: "FIELD_SALES_KONSI",
          fieldSalesLineId: line.fieldSalesLineId,
          itemId: line.itemId,
          variantSku: line.variantSku,
          qty: line.qty,
          consumedQty: line.qty,
          state: "CONSUMED",
          resolvedAt: new Date(),
        },
      });
      transferred += 1;
    }
    return { transferred, skipped, shortLines };
  };
  return hasTx(client) ? client.$transaction(run) : run(client);
}
