import {
  InventoryValueMissingError,
  moveMainStock,
  moveStoreStock,
  reopenFieldSalesLineStock,
  resolveReservedInventory,
  type Prisma,
} from "@elorae/db";
import type { StockAdjustmentSource, StockLedgerRefType } from "@elorae/db";
import { weightedAvgCost } from "@/lib/inventory/weighted-avg-cost";
import { generateDocNumber } from "@/lib/docNumber";
import { KonsiTransferReservationMismatchError } from "../errors";
import { nextDeliveryStatus } from "../delivery/plan";

type TxClient = Prisma.TransactionClient;

export type IssueKonsiTransferLine = {
  id: string;
  itemId: string;
  variantSku: string;
  productName: string;
  qty: number;
  /**
   * Only on an old-order arrival (`oldOrderArrival`): the APPROVED main-warehouse StockOpname that
   * counted this item AFTER the order was approved. That count already left these pcs out of
   * `qtyOnHand`, so the line adds them to the store and releases the reservation WITHOUT cutting
   * main stock a second time. A shipment creation never passes it.
   */
  mainCountedByOpnameId?: string | null;
  /**
   * Shipment path: the konsi price snapshotted on the order line at approve
   * (`FieldSalesOrderLine.unitPrice`). The surat jalan lists it per article like a nota, without a
   * faktur (P37), and a konsi expedition claim is valued at it. An arrival never passes it.
   */
  unitPrice?: number | null;
};

/**
 * A konsi transfer that is no longer in transit: the store already received it (RECEIVED), or it
 * was cancelled ("tidak jadi dikirim", CANCELLED). Thrown by the receipt, the door refusal and the
 * cancel when a concurrent writer won the transfer first — the caller's transaction rolls back.
 */
export class KonsiTransferNotInTransitError extends Error {
  constructor(
    readonly transferId: string,
    readonly status: "RECEIVED" | "CANCELLED",
  ) {
    super(`Konsi transfer ${transferId} is ${status}, not in transit`);
    this.name = "KonsiTransferNotInTransitError";
  }
}

/** Idempotency key of the main-stock cut for one line of a shipment transfer. */
export function kunciPindahKonsi(transferId: string, orderLineId: string): string {
  return `konsi-pindah-${transferId}-${orderLineId}`;
}

/** Idempotency key of pieces that came back (door refusal `ref` = receipt id, cancel `ref` = "batal"). */
export function kunciKembaliKonsi(ref: string, orderLineId: string): string {
  return `konsi-kembali-${ref}-${orderLineId}`;
}

/**
 * Moves konsi stock out of the main warehouse, inside the caller's transaction. Runs when the
 * delivery shipment is CREATED — creating it IS the surat jalan (owner answer Q1 2026-11-02: "ketika
 * kita membuat surat jalan saja … seharusnya kan sudah berkurang"), one transfer per shipment,
 * never at approve (approve only reserves). Each line's `qty` is the PLANNED quantity of that
 * shipment, so the reservation approve created is consumed PARTIALLY, and a second shipment against
 * the same line draws it down further.
 *
 * A shipment transfer is written IN_TRANSIT ("Gudang Toko, dalam perjalanan"): its pieces are in
 * neither the main warehouse nor the store's StoreStock until the store receipt
 * (`receiveKonsiTransferInTx`) lands what arrived. Refused pieces and a cancel come back through
 * `kembalikanKonsiTransferInTx`. Each line snapshots the konsi price (`unitPrice`, P37).
 *
 * The second caller is an OLD-ORDER ARRIVAL (`oldOrderArrival`, no shipment): a konsi order
 * approved before the per-shipment flow reached production, whose reservation is still RESERVED,
 * confirmed at the store by its SPG or holding salesman (`konfirmasiSampaiPesananLama`). Same
 * transfer, same reservation draw-down, same store stock and ledger, so stok titipan, pencocokan
 * and the consignment move journal (`CONSIGNMENT_TRANSFER`, one per transfer) all see it — with one
 * difference per line: a line whose item the main warehouse already re-counted after approve
 * (`mainCountedByOpnameId`) keeps main `qtyOnHand` as the count left it and only releases the
 * reservation, and its journal credits the opname variance account instead of warehouse inventory.
 *
 * qtyOnHand and reservedQty must decrement TOGETHER. The reservation approve created already
 * covers this line's qty, so decrementing one without the other would leave stock reserved
 * against nothing, forever. The quantity goes through moveMainStock, pinned to the row the line's
 * reservation was made against; the reservedQty decrement follows immediately after on that same id, as a plain
 * atomic update outside the mover — it writes no ledger entry, because a reservation resolving is
 * not a stock movement. A future edit must not separate the two writes or let anything run
 * between them.
 */
export async function issueKonsiTransfer(
  tx: TxClient,
  input: {
    order: { id: string; storeId: string; lines: IssueKonsiTransferLine[] };
    /** The delivery shipment being created; null only for an old-order arrival. */
    shipmentId: string | null;
    transferredById: string;
    /** An old-order arrival confirmed at the store (no shipment). */
    oldOrderArrival?: boolean;
  },
): Promise<{ transferId: string; docNo: string }> {
  const oldOrderArrival = input.oldOrderArrival === true;
  /*
   * Exactly one of the two: a shipment creation always names its shipment, an arrival never has
   * one. Refused before anything is written — a shipment transfer without its shipment would be
   * invisible to the SPG receipt list, and an arrival tied to a shipment would be received twice.
   */
  if (oldOrderArrival === (input.shipmentId !== null && input.shipmentId !== "")) {
    throw new Error("issueKonsiTransfer: a transfer is either a shipment's or an old-order arrival, never both or neither");
  }
  const docNo = await generateDocNumber("KONSITRF", tx);

  const sekarang = new Date();
  /*
   * A shipment transfer starts IN TRANSIT; an arrival is counted at the store when it is written,
   * so it is RECEIVED at once (legacy path, not extended — only made readable by every reader keyed
   * on RECEIVED).
   */
  const transfer = await tx.konsiTransfer.create({
    data: {
      docNo,
      orderId: input.order.id,
      storeId: input.order.storeId,
      shipmentId: oldOrderArrival ? null : input.shipmentId,
      oldOrderArrival,
      transferredById: input.transferredById,
      status: oldOrderArrival ? "RECEIVED" : "IN_TRANSIT",
      ...(oldOrderArrival ? { receivedAt: sekarang, receivedById: input.transferredById } : {}),
    },
    select: { id: true },
  });

  const lineData: Array<{
    transferId: string;
    orderLineId: string;
    itemId: string;
    variantSku: string;
    productName: string;
    qty: number;
    unitCost: number;
    mainCountedByOpnameId: string | null;
    unitPrice: number | null;
    receivedQty: number | null;
  }> = [];

  for (const l of input.order.lines) {
    /**
     * The caller filters to delivered lines today; a zero draw would pass the guard below as a
     * no-op and a negative one would move stock INTO main, so neither is left to the caller.
     */
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new KonsiTransferReservationMismatchError(l.id, 0);
    /* Only an arrival may skip the main cut; a shipment always moves its pcs out of main. */
    const mainCountedByOpnameId = oldOrderArrival && l.mainCountedByOpnameId ? l.mainCountedByOpnameId : null;
    if (!oldOrderArrival && l.mainCountedByOpnameId) throw new Error("issueKonsiTransfer: only an old-order arrival may skip the main-stock cut");

    /**
     * Partial consume of the reservation approve created, folded into one guarded statement so a
     * concurrent shipment creation cannot pass a stale read — the same idiom
     * `consumeFieldSalesOrderPartial` uses, filtered to the konsi reservation source as that one
     * is to its own. It runs BEFORE any balance write for this line, so an
     * over-draw, or a reservation that is not RESERVED at all (a konsi order approved before
     * stock moved at shipment, whose reservation was consumed at approve), refuses with nothing
     * moved. `StockReservation` is not a balance table, so this raw statement needs no entry in
     * the stock-balance guard.
     */
    const reserved = await tx.$executeRaw`
      UPDATE StockReservation
      SET consumedQty = consumedQty + ${l.qty}
      WHERE fieldSalesLineId = ${l.id} AND source = 'FIELD_SALES_KONSI' AND state = 'RESERVED' AND consumedQty + ${l.qty} <= qty
    `;
    if (reserved === 0) throw new KonsiTransferReservationMismatchError(l.id, 0);

    /**
     * The row approve reserved against, which is where this line's reservedQty sits. It is pinned
     * into moveMainStock below AND into the reservedQty decrement after it. Resolving it through
     * the reservation rather than a fresh item lookup keeps the draw-down on that row even when the
     * item carries both variantless spellings, or gained one after approve; a fresh lookup could
     * pick the sibling, driving its qtyOnHand down and stranding reservedQty on the reserved row.
     * A reservation made before the pin was stored falls back to the reserve's own lookup.
     */
    const pin = await tx.stockReservation.findUniqueOrThrow({
      where: { fieldSalesLineId: l.id },
      select: { inventoryValueId: true },
    });
    const main = await resolveReservedInventory(tx, {
      itemId: l.itemId,
      variantSku: l.variantSku,
      inventoryValueId: pin.inventoryValueId,
    });
    if (!main) throw new InventoryValueMissingError(l.itemId, l.variantSku);

    const prevQty = main.qtyOnHand.toNumber();
    const avgCost = main.avgCost.toNumber();
    const newQty = prevQty - l.qty;

    if (mainCountedByOpnameId === null) {
      /*
       * qtyOnHand and reservedQty decrement TOGETHER — see the module doc above. moveMainStock
       * only moves qtyOnHand (and records the ledger entry for it); reservedQty is not a stock
       * movement and gets no ledger entry, so it stays a separate atomic decrement immediately
       * after, pinned to the same row moveMainStock just wrote.
       */
      await moveMainStock(tx, {
        itemId: l.itemId,
        variantSku: l.variantSku,
        qtyDelta: -l.qty,
        totalValue: newQty * avgCost,
        totalCost: -l.qty * avgCost,
        balanceValue: newQty * avgCost,
        inventoryValueId: main.id,
        refType: "KonsiTransfer" satisfies StockLedgerRefType,
        refId: transfer.id,
        refDocNumber: docNo,
        createdById: input.transferredById,
      });
    }

    /*
     * An arrival whose item the warehouse already re-counted reaches here WITHOUT a qtyOnHand
     * write: the count set qtyOnHand without these pcs and never touched reservedQty, so the
     * reservation is all that is left to resolve — a release, written exactly as the normal path's
     * decrement is, on the reserved row. Never a second qtyOnHand cut.
     */
    await tx.inventoryValue.update({
      where: { id: main.id },
      data: {
        reservedQty: { decrement: l.qty },
        lastUpdated: new Date(),
      },
    });

    if (mainCountedByOpnameId === null) {
      await tx.stockAdjustment.create({
        data: {
          docNumber: await generateDocNumber("ADJ", tx),
          itemId: l.itemId,
          type: "NEGATIVE",
          qtyChange: -l.qty,
          reason: `Konsi transfer ${docNo}`,
          prevQty,
          newQty,
          prevAvgCost: avgCost,
          newAvgCost: avgCost,
          createdById: input.transferredById,
          source: "KONSI_TRANSFER" satisfies StockAdjustmentSource,
          ...(oldOrderArrival ? {} : { idempotencyKey: kunciPindahKonsi(transfer.id, l.id) }),
        },
      });
    }

    /*
     * Only an arrival lands on the store's shelf here (it was counted at the store). A shipment
     * transfer is in transit: its StoreStock moves at the store receipt (`receiveKonsiTransferInTx`).
     */
    if (oldOrderArrival) {
      await naikkanStokToko(tx, {
        storeId: input.order.storeId,
        itemId: l.itemId,
        variantSku: l.variantSku,
        qty: l.qty,
        unitCost: avgCost,
        refId: transfer.id,
        refDocNumber: docNo,
        createdById: input.transferredById,
      });
    }

    /* Only the draw that exhausts the reservation resolves it; an earlier partial draw leaves it
       RESERVED for the next shipment or for a close-remainder release. */
    const reservation = await tx.stockReservation.findUniqueOrThrow({
      where: { fieldSalesLineId: l.id },
      select: { qty: true, consumedQty: true },
    });
    if (Number(reservation.consumedQty) >= Number(reservation.qty)) {
      await tx.stockReservation.updateMany({
        where: { fieldSalesLineId: l.id, state: "RESERVED" },
        data: { state: "CONSUMED", resolvedAt: new Date() },
      });
    }

    lineData.push({
      transferId: transfer.id,
      orderLineId: l.id,
      itemId: l.itemId,
      variantSku: l.variantSku,
      productName: l.productName,
      qty: l.qty,
      unitCost: avgCost,
      mainCountedByOpnameId,
      unitPrice: oldOrderArrival ? null : (l.unitPrice ?? null),
      receivedQty: oldOrderArrival ? l.qty : null,
    });
  }

  await tx.konsiTransferLine.createMany({ data: lineData });

  return { transferId: transfer.id, docNo };
}

/**
 * StoreStock += qty, blended at `unitCost`. StoreStock keys on "" for variantless, never null — the
 * composite unique must be DB-enforced. moveStoreStock applies whatever avgCost it is handed; it
 * does not compute the blend itself.
 *
 * A negative StoreStock qty (e.g. a konsi retur that credited back more than the store's ledger
 * held — see approve-writer.ts) represents units that are not physically there. Blending against
 * those units with weightedAvgCost would use a negative weight and inflate the average well past
 * the true cost, so the blend is clamped to 0; the quantity moved still uses the real balance.
 */
async function naikkanStokToko(
  tx: TxClient,
  input: {
    storeId: string;
    itemId: string;
    variantSku: string;
    qty: number;
    unitCost: number;
    refId: string;
    refDocNumber: string;
    createdById: string;
  },
): Promise<void> {
  const storeKey = { storeId_itemId_variantSku: { storeId: input.storeId, itemId: input.itemId, variantSku: input.variantSku } };
  const existingStoreStock = await tx.storeStock.findUnique({ where: storeKey, select: { qty: true, avgCost: true } });
  const prevStoreQty = existingStoreStock ? existingStoreStock.qty.toNumber() : 0;
  const prevStoreAvg = existingStoreStock ? existingStoreStock.avgCost.toNumber() : 0;
  const blendQty = Math.max(prevStoreQty, 0);
  const nextStoreAvgCost = existingStoreStock ? weightedAvgCost(blendQty, prevStoreAvg, input.qty, input.unitCost) : input.unitCost;

  await moveStoreStock(tx, {
    storeId: input.storeId,
    itemId: input.itemId,
    variantSku: input.variantSku,
    qtyDelta: input.qty,
    avgCost: nextStoreAvgCost,
    refType: "KonsiTransfer" satisfies StockLedgerRefType,
    refId: input.refId,
    refDocNumber: input.refDocNumber,
    createdById: input.createdById,
  });
}

/** Reads the status a CAS missed on, to tell a concurrent receipt from a concurrent cancel. */
async function tolakBukanDiPerjalanan(tx: TxClient, transferId: string): Promise<never> {
  const t = await tx.konsiTransfer.findUnique({ where: { id: transferId }, select: { status: true } });
  if (!t) throw new Error(`konsi transfer ${transferId} not found`);
  throw new KonsiTransferNotInTransitError(transferId, t.status === "CANCELLED" ? "CANCELLED" : "RECEIVED");
}

/**
 * The store receipt of a shipment transfer (Q1): IN_TRANSIT → RECEIVED in one CAS, then each line's
 * `receivedQty` = what arrived (damaged pieces included — they are at the store) and StoreStock +=
 * that, blended at the line's issue cost. Pieces sent but not arrived are NOT put back anywhere —
 * they are barang hilang (the receipt opens the StockLoss). Refused pieces were already put back by
 * `kembalikanKonsiTransferInTx` before this runs, and are not in `baris` as arrived.
 */
export async function receiveKonsiTransferInTx(
  tx: TxClient,
  input: {
    transferId: string;
    storeId: string;
    receivedById: string;
    receivedAt: Date;
    baris: Array<{ transferLineId: string; qtyReceived: number }>;
  },
): Promise<void> {
  const cas = await tx.konsiTransfer.updateMany({
    where: { id: input.transferId, storeId: input.storeId, status: "IN_TRANSIT" },
    data: { status: "RECEIVED", receivedAt: input.receivedAt, receivedById: input.receivedById },
  });
  if (cas.count !== 1) await tolakBukanDiPerjalanan(tx, input.transferId);

  const transfer = await tx.konsiTransfer.findUniqueOrThrow({
    where: { id: input.transferId },
    select: { docNo: true, lines: { select: { id: true, itemId: true, variantSku: true, unitCost: true } } },
  });
  const tiba = new Map(input.baris.map((b) => [b.transferLineId, b.qtyReceived]));
  for (const l of transfer.lines) {
    const q = tiba.get(l.id) ?? 0;
    await tx.konsiTransferLine.update({ where: { id: l.id }, data: { receivedQty: q } });
    if (q > 0) {
      await naikkanStokToko(tx, {
        storeId: input.storeId,
        itemId: l.itemId,
        variantSku: l.variantSku,
        qty: q,
        unitCost: Number(l.unitCost),
        refId: input.transferId,
        refDocNumber: transfer.docNo,
        createdById: input.receivedById,
      });
    }
  }
}

/**
 * Pieces of an IN-TRANSIT shipment transfer go back to the main warehouse: refused at the store's
 * door ("retur langsung", P24/P40) or the whole shipment "tidak jadi dikirim" (`batal`, Q1). Per
 * line: the reservation reopens and main stock comes back at the line's issue cost
 * (`reopenFieldSalesLineStock`), a POSITIVE StockAdjustment `KONSI_TRANSFER_RETURN` keyed
 * `kunciKembaliKonsi(kunci, orderLineId)`, the transfer line's `returnedQty` and the order line's
 * `deliveredQty` move by the same pieces (they are the order's open remainder again), and the
 * order's `deliveryStatus` is recomputed. `batal` also moves the transfer to CANCELLED. The CAS on
 * IN_TRANSIT comes FIRST, so a concurrent receipt or cancel refuses before anything moves. The
 * audit row is written here, in the same transaction.
 */
export async function kembalikanKonsiTransferInTx(
  tx: TxClient,
  input: {
    transferId: string;
    baris: Array<{ orderLineId: string; qty: number }>;
    olehUserId: string;
    sekarang: Date;
    alasan: string;
    batal: boolean;
    kunci: string;
  },
): Promise<{ barangKembali: string[] }> {
  const cas = await tx.konsiTransfer.updateMany({
    where: { id: input.transferId, status: "IN_TRANSIT" },
    data: input.batal
      ? {
          status: "CANCELLED",
          cancelledAt: input.sekarang,
          cancelledById: input.olehUserId,
          cancelReason: input.alasan,
          adjustedAt: input.sekarang,
        }
      : { adjustedAt: input.sekarang },
  });
  if (cas.count !== 1) await tolakBukanDiPerjalanan(tx, input.transferId);

  const transfer = await tx.konsiTransfer.findUniqueOrThrow({
    where: { id: input.transferId },
    select: {
      docNo: true,
      orderId: true,
      storeId: true,
      lines: { select: { id: true, orderLineId: true, itemId: true, variantSku: true, qty: true, returnedQty: true, unitCost: true } },
    },
  });

  const barangKembali: string[] = [];
  const perubahan: Array<{ transferLineId: string; orderLineId: string; qty: number }> = [];
  for (const b of input.baris) {
    if (!Number.isInteger(b.qty) || b.qty < 0) throw new KonsiTransferReservationMismatchError(b.orderLineId, 0);
    let sisa = b.qty;
    for (const l of transfer.lines.filter((x) => x.orderLineId === b.orderLineId)) {
      if (sisa === 0) break;
      const terbuka = Math.round(Number(l.qty)) - l.returnedQty;
      const ambil = Math.min(sisa, Math.max(terbuka, 0));
      if (ambil === 0) continue;
      const balik = await reopenFieldSalesLineStock(tx, {
        fieldSalesLineId: b.orderLineId,
        source: "FIELD_SALES_KONSI",
        itemId: l.itemId,
        variantSku: l.variantSku,
        qty: ambil,
        unitCost: Number(l.unitCost),
        refType: "KonsiTransfer" satisfies StockLedgerRefType,
        refId: input.transferId,
        refDocNumber: transfer.docNo,
        createdById: input.olehUserId,
      });
      await tx.stockAdjustment.create({
        data: {
          docNumber: await generateDocNumber("ADJ", tx),
          itemId: l.itemId,
          type: "POSITIVE",
          qtyChange: ambil,
          reason: `${input.batal ? "Tidak jadi dikirim" : "Ditolak toko (retur langsung)"} ${transfer.docNo}`,
          prevQty: balik.prevQty,
          newQty: balik.newQty,
          prevAvgCost: balik.prevAvgCost,
          newAvgCost: balik.newAvgCost,
          createdById: input.olehUserId,
          /* Kept apart from KONSI_TRANSFER, which biayaSatuanKonsi averages. */
          source: "KONSI_TRANSFER_RETURN" satisfies StockAdjustmentSource,
          idempotencyKey: `${kunciKembaliKonsi(input.kunci, b.orderLineId)}-${l.id}`,
        },
      });
      await tx.konsiTransferLine.update({ where: { id: l.id }, data: { returnedQty: { increment: ambil } } });
      await tx.fieldSalesOrderLine.update({ where: { id: b.orderLineId }, data: { deliveredQty: { decrement: ambil } } });
      perubahan.push({ transferLineId: l.id, orderLineId: b.orderLineId, qty: ambil });
      barangKembali.push(l.itemId);
      sisa -= ambil;
    }
    if (sisa > 0) throw new KonsiTransferReservationMismatchError(b.orderLineId, 0);
  }

  const orderLines = await tx.fieldSalesOrderLine.findMany({
    where: { orderId: transfer.orderId },
    select: { id: true, qty: true, deliveredQty: true, cancelledQty: true },
  });
  await tx.fieldSalesOrder.update({
    where: { id: transfer.orderId },
    data: {
      deliveryStatus: nextDeliveryStatus(
        orderLines.map((l) => ({ orderLineId: l.id, qty: l.qty, deliveredQty: l.deliveredQty, cancelledQty: l.cancelledQty })),
      ),
    },
  });

  await tx.auditLog.create({
    data: {
      userId: input.olehUserId,
      action: input.batal ? "KONSI_TRANSFER_CANCELLED" : "KONSI_TRANSFER_RETURNED",
      entityType: "KonsiTransfer",
      entityId: input.transferId,
      changes: {
        before: { status: "IN_TRANSIT" },
        after: { status: input.batal ? "CANCELLED" : "IN_TRANSIT", kembali: perubahan },
      } as Prisma.InputJsonValue,
      reason: input.alasan,
    },
  });

  return { barangKembali };
}
