import { Prisma, prisma, InventoryValueMissingError, MainStockNegativeError, type AdminNotification } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { parseDateOnly, formatDateOnlyJakarta } from "@/lib/date-only";
import { recordFieldSalesDeliveryInTx, NomorPiutangDipakaiError } from "@/lib/field-sales/delivery/writer";
import { batalkanNotaPengirimanInTx } from "@/lib/field-sales/delivery/koreksi-nota";
import { evaluateCheckinRadius, resolveEffectiveRadius, parseRadiusSetting } from "@/lib/pwa/checkin-radius";
import { issueKonsiTransfer, kembalikanKonsiTransferInTx } from "@/lib/field-sales/konsi-transfer/writer";
import { muatPesananKonsiCadanganLama } from "@/lib/field-sales/konsi-transfer/pesanan-lama";
import { DeliveryError, KonsiTransferReservationMismatchError } from "@/lib/field-sales/errors";
import { IndenBelumRilisError } from "@/lib/field-sales/inden";
import { nextDeliveryStatus } from "@/lib/field-sales/delivery/plan";
import { isR2KeyInFolder } from "@/lib/r2-key";
import { penerimaPod } from "@/lib/spg/kiriman";
import { sesudahTerimaKosong, terimaKirimanDalamTx, type SesudahTerima } from "@/lib/spg/stok-writer";
import { DeliveryShipmentError } from "./errors";
import { isSameActorReplay } from "./pod-completion-guard";
import { isEligibleCarrier } from "./carrier-queries";

/**
 * Pengiriman gudang → toko (owner answers 2026-11-02: Q1, P15–P17, P24–P26, P33a, P35, P40–P45a).
 *
 * - CREATE is the moment stock leaves the main warehouse. KONSI: creating the shipment IS the surat
 *   jalan and the transfer into the store's warehouse, IN TRANSIT. PUTUS: the nota tagihan (with its
 *   receivable, faktur queue row, consume and SalesHistory) is issued, dated the WIB day of creation.
 * - SHIP needs the expedition's resi, the weight in kg and a handover-to-courier photo showing the
 *   weight (P35, P43), or the salesman carrier.
 * - COMPLETE is the expedition/courier confirmation. At a store without an SPG it is also the
 *   store's receipt (diterima / retur langsung / hilang); at a store with one, the SPG records the
 *   receipt on her phone (P40) and the POD is information only.
 * - CANCEL ("tidak jadi dikirim") puts the goods back; for putus it voids the nota, the receivable
 *   and the faktur, refused once the nota has a payment report or the store received it (P16/P33a).
 */

/**
 * A compare-and-swap `updateMany` that matched nothing means one of two things the caller must
 * tell apart: the shipment is gone (NOT_FOUND) or it exists in a state the CAS excludes
 * (INVALID_STATE).
 */
async function throwForMissedCas(client: Prisma.TransactionClient | typeof prisma, shipmentId: string): Promise<never> {
  const exists = await client.deliveryShipment.findUnique({
    where: { id: shipmentId },
    select: { id: true },
  });
  throw new DeliveryShipmentError(exists ? "INVALID_STATE" : "NOT_FOUND");
}

/** 00:00 WIB of the calendar day `now` falls on — the parseDateOnly convention. */
export function hariNotaWib(now: Date): Date {
  return parseDateOnly(formatDateOnlyJakarta(now)) ?? now;
}

export type HasilBuatPengiriman = {
  shipmentId: string;
  docNo: string;
  orderType: "PUTUS" | "KONSI";
  deliveryId: string | null;
  transferId: string | null;
  barangKeluar: string[];
  ulang: boolean;
};

/**
 * Creates a PACKED shipment AND moves its goods out of the main warehouse, in one serializable
 * transaction (R1–R4). `idempotencyKey` is made once per dialog open and kept across retries: the
 * first statement looks it up, so a double submit or a retry after a lost response returns the same
 * shipment (`ulang: true`) and writes nothing. A key held by another order is INVALID_STATE.
 *
 * PUTUS: `invoiceDate` is NOT an input — the nota is dated the WIB day the shipment is created and
 * the due date counts from it (P17). `dueDate` is required (MISSING_DATES), and before the nota
 * date is INVALID_DATES. Later corrections go only through Edit tanggal nota.
 * KONSI: one `KonsiTransfer` IN_TRANSIT, each line snapshotting the konsi price (P37).
 *
 * Remaining to pack = qty − deliveredQty − cancelledQty: `deliveredQty` already counts every PACKED
 * and IN_TRANSIT shipment, because stock or the nota moves at creation.
 */
export async function createDeliveryShipment(input: {
  orderId: string;
  method: "EXPEDITION" | "SALESMAN_CARRY";
  lines: Array<{ orderLineId: string; qty: number }>;
  packedById: string;
  idempotencyKey: string;
  dueDate?: Date;
}): Promise<HasilBuatPengiriman> {
  const kunci = input.idempotencyKey?.trim();
  if (!kunci || kunci.length > 64) throw new DeliveryShipmentError("INVALID_STATE");
  if (input.lines.length === 0) throw new DeliveryShipmentError("NO_LINES");
  for (const line of input.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new DeliveryShipmentError("INVALID_QTY");
    }
  }

  try {
    return await runSerializable(async (tx): Promise<HasilBuatPengiriman> => {
      const ulang = await pengirimanDenganKunci(tx, kunci, input.orderId);
      if (ulang) return ulang;

      const order = await tx.fieldSalesOrder.findUnique({
        where: { id: input.orderId },
        include: { lines: true },
      });
      if (!order) throw new DeliveryShipmentError("NOT_FOUND");
      /* Only an APPROVED order can ship: nothing is reserved or priced before approve. */
      if (order.status !== "APPROVED") throw new DeliveryShipmentError("INVALID_STATE");
      /**
       * An old konsi order whose reservation is still held (approved before the per-shipment flow
       * reached production) is settled at the store, not shipped (legacy, kept, not extended —
       * `lib/field-sales/konsi-transfer/pesanan-lama-writer.ts`).
       */
      if (order.orderType === "KONSI" && (await muatPesananKonsiCadanganLama(tx, order.id))) {
        throw new DeliveryShipmentError("KONSI_PESANAN_LAMA");
      }

      const packer = await tx.user.findUnique({ where: { id: input.packedById }, select: { id: true } });
      if (!packer) throw new DeliveryShipmentError("NOT_FOUND");

      const orderLineById = new Map(order.lines.map((l) => [l.id, l]));
      /* One shipment line per order line: duplicate entries are summed before validation. */
      const qtyByOrderLineId = new Map<string, number>();
      for (const line of input.lines) {
        qtyByOrderLineId.set(line.orderLineId, (qtyByOrderLineId.get(line.orderLineId) ?? 0) + line.qty);
      }
      for (const [orderLineId, totalQty] of qtyByOrderLineId) {
        const orderLine = orderLineById.get(orderLineId);
        if (!orderLine) throw new DeliveryShipmentError("NOT_FOUND");
        const remaining = orderLine.qty - orderLine.deliveredQty - orderLine.cancelledQty;
        if (totalQty > remaining) throw new DeliveryShipmentError("OVER_PLANNED");
      }

      const sekarang = new Date();
      let invoiceDate: Date | null = null;
      if (order.orderType === "PUTUS") {
        if (!input.dueDate || Number.isNaN(input.dueDate.getTime())) throw new DeliveryShipmentError("MISSING_DATES");
        invoiceDate = hariNotaWib(sekarang);
        if (input.dueDate.getTime() < invoiceDate.getTime()) throw new DeliveryError("INVALID_DATES");
      }

      const docNo = await generateDocNumber("DELIVERY", tx);
      const baris = Array.from(qtyByOrderLineId, ([orderLineId, qty]) => ({ orderLine: orderLineById.get(orderLineId)!, qty }));
      const shipment = await tx.deliveryShipment.create({
        data: {
          docNo,
          orderId: input.orderId,
          method: input.method,
          packedById: input.packedById,
          idempotencyKey: kunci,
          lines: {
            create: baris.map((b) => ({
              orderLineId: b.orderLine.id,
              itemId: b.orderLine.itemId,
              variantSku: b.orderLine.variantSku,
              plannedQty: b.qty,
            })),
          },
        },
        select: { id: true, docNo: true },
      });

      if (order.orderType === "PUTUS") {
        let nota: Awaited<ReturnType<typeof recordFieldSalesDeliveryInTx>>;
        try {
          nota = await recordFieldSalesDeliveryInTx(tx, {
            orderId: order.id,
            deliveredById: input.packedById,
            lines: baris.map((b) => ({ orderLineId: b.orderLine.id, qty: b.qty })),
            invoiceDate: invoiceDate!,
            dueDate: input.dueDate!,
            idempotencyKey: `shipment-${shipment.id}`,
            deliveredAt: sekarang,
          });
        } catch (error) {
          if (error instanceof IndenBelumRilisError) throw new DeliveryShipmentError("INDEN_BELUM_RILIS");
          if (error instanceof NomorPiutangDipakaiError) throw new DeliveryShipmentError("NOMOR_NOTA_DIPAKAI", error.invoiceNo);
          throw error;
        }
        await tx.deliveryShipment.update({ where: { id: shipment.id }, data: { deliveryId: nota.deliveryId } });
        return {
          shipmentId: shipment.id,
          docNo: shipment.docNo,
          orderType: "PUTUS",
          deliveryId: nota.deliveryId,
          transferId: null,
          barangKeluar: nota.barangKeluar,
          ulang: false,
        };
      }

      let transfer: { transferId: string; docNo: string };
      try {
        transfer = await issueKonsiTransfer(tx, {
          order: {
            id: order.id,
            storeId: order.storeId,
            lines: baris.map((b) => ({
              id: b.orderLine.id,
              itemId: b.orderLine.itemId,
              variantSku: b.orderLine.variantSku,
              productName: b.orderLine.productName,
              qty: b.qty,
              unitPrice: b.orderLine.unitPrice === null ? null : Number(b.orderLine.unitPrice),
            })),
          },
          shipmentId: shipment.id,
          transferredById: input.packedById,
        });
      } catch (error) {
        /*
         * Every refusal the transfer can raise leaves as a typed code rather than UNEXPECTED; none
         * clears on a retry. Rethrown inside the transaction, so the shipment rolls back too.
         */
        if (error instanceof KonsiTransferReservationMismatchError) throw new DeliveryShipmentError("KONSI_NOT_RESERVED");
        if (error instanceof MainStockNegativeError) throw new DeliveryError("INSUFFICIENT_STOCK");
        if (error instanceof InventoryValueMissingError) throw new DeliveryShipmentError("NO_INVENTORY_ROW");
        throw error;
      }
      for (const b of baris) {
        await tx.fieldSalesOrderLine.update({ where: { id: b.orderLine.id }, data: { deliveredQty: { increment: b.qty } } });
      }
      await perbaruiStatusKirim(tx, order.id);
      return {
        shipmentId: shipment.id,
        docNo: shipment.docNo,
        orderType: "KONSI",
        deliveryId: null,
        transferId: transfer.transferId,
        barangKeluar: baris.map((b) => b.orderLine.itemId),
        ulang: false,
      };
    });
  } catch (error) {
    /* Two submits of one dialog racing: the unique key refused the loser — hand back the winner. */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const pemenang = await pengirimanDenganKunci(prisma, kunci, input.orderId);
      if (pemenang) return pemenang;
    }
    throw error;
  }
}

async function pengirimanDenganKunci(
  client: Prisma.TransactionClient | typeof prisma,
  kunci: string,
  orderId: string,
): Promise<HasilBuatPengiriman | null> {
  const ada = await client.deliveryShipment.findUnique({
    where: { idempotencyKey: kunci },
    select: {
      id: true,
      docNo: true,
      orderId: true,
      deliveryId: true,
      order: { select: { orderType: true } },
      konsiTransfer: { select: { id: true } },
      lines: { select: { itemId: true } },
    },
  });
  if (!ada) return null;
  if (ada.orderId !== orderId) throw new DeliveryShipmentError("INVALID_STATE");
  return {
    shipmentId: ada.id,
    docNo: ada.docNo,
    orderType: ada.order.orderType === "KONSI" ? "KONSI" : "PUTUS",
    deliveryId: ada.deliveryId,
    transferId: ada.konsiTransfer?.id ?? null,
    barangKeluar: ada.lines.map((l) => l.itemId),
    ulang: true,
  };
}

async function perbaruiStatusKirim(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const orderLines = await tx.fieldSalesOrderLine.findMany({
    where: { orderId },
    select: { id: true, qty: true, deliveredQty: true, cancelledQty: true },
  });
  await tx.fieldSalesOrder.update({
    where: { id: orderId },
    data: {
      deliveryStatus: nextDeliveryStatus(
        orderLines.map((l) => ({ orderLineId: l.id, qty: l.qty, deliveredQty: l.deliveredQty, cancelledQty: l.cancelledQty })),
      ),
    },
  });
}

/** Weight in kg: finite, > 0, ≤ 99999.99, at most two decimals. */
export function beratSah(weightKg: number): boolean {
  return (
    Number.isFinite(weightKg) &&
    weightKg > 0 &&
    weightKg <= 99999.99 &&
    Math.abs(Math.round(weightKg * 100) - weightKg * 100) < 1e-6
  );
}

/**
 * Tracking edits while PACKED (P15: the warehouse, or whoever handles the expedition). Read,
 * validate and compare-and-swap on `{ id, status: PACKED }` in one serializable transaction, so a
 * concurrent cancel or ship cannot interleave. `weightKg: null` clears the weight. The handover
 * photo key must sit in `delivery-handover/<shipmentId>` — bound to THIS shipment, so one photo
 * cannot satisfy two shipments.
 */
export async function updateShipmentTracking(input: {
  shipmentId: string;
  carrierName?: string;
  resiNumber?: string;
  carriedById?: string;
  weightKg?: number | null;
  handoverPhotoUrl?: string;
  handoverPhotoR2Key?: string;
}): Promise<{ ok: true }> {
  if (input.carriedById && !(await isEligibleCarrier(prisma, input.carriedById))) {
    throw new DeliveryShipmentError("INVALID_CARRIER");
  }
  if (input.weightKg !== undefined && input.weightKg !== null && !beratSah(input.weightKg)) {
    throw new DeliveryShipmentError("INVALID_WEIGHT");
  }
  const fotoKey = input.handoverPhotoR2Key?.trim();
  const fotoUrl = input.handoverPhotoUrl?.trim();
  if (input.handoverPhotoR2Key !== undefined || input.handoverPhotoUrl !== undefined) {
    if (!fotoKey || !fotoUrl || !isR2KeyInFolder(fotoKey, `delivery-handover/${input.shipmentId}`)) {
      throw new DeliveryShipmentError("MISSING_HANDOVER_PHOTO");
    }
  }
  return runSerializable(async (tx) => {
    const shipment = await tx.deliveryShipment.findUnique({ where: { id: input.shipmentId }, select: { status: true } });
    if (!shipment) throw new DeliveryShipmentError("NOT_FOUND");
    if (shipment.status !== "PACKED") throw new DeliveryShipmentError("INVALID_STATE");
    const result = await tx.deliveryShipment.updateMany({
      where: { id: input.shipmentId, status: "PACKED" },
      data: {
        ...(input.carrierName !== undefined ? { carrierName: input.carrierName.trim() } : {}),
        ...(input.resiNumber !== undefined ? { resiNumber: input.resiNumber.trim() } : {}),
        ...(input.carriedById !== undefined ? { carriedById: input.carriedById } : {}),
        ...(input.weightKg !== undefined ? { weightKg: input.weightKg === null ? null : new Prisma.Decimal(input.weightKg.toFixed(2)) } : {}),
        ...(fotoKey && fotoUrl ? { handoverPhotoUrl: fotoUrl, handoverPhotoR2Key: fotoKey } : {}),
      },
    });
    if (result.count === 0) return throwForMissedCas(tx, input.shipmentId);
    return { ok: true as const };
  });
}

/**
 * Moves an in-transit salesman-carry shipment to a different carrier — the escape hatch for a
 * salesman who cannot make the run, which previously meant cancel-and-recreate.
 *
 * IN_TRANSIT only: while PACKED the carrier is already editable through `updateShipmentTracking`,
 * and once the shipment is delivered or cancelled the carrier is history. EXPEDITION shipments
 * have no carrier to reassign. Every putus shipment carries its nota from creation, so a recorded
 * nota is no reason to refuse (R32).
 *
 * Two concurrent reassigns are last-writer-wins: under MariaDB SERIALIZABLE the loser usually
 * deadlocks and `runSerializable` retries it against the new carrier, so both commit and leave two
 * audit rows. The audit row is written with `tx.auditLog.create`, not `logAudit`, which swallows
 * its own errors.
 *
 * A completion the previous carrier queued offline now fails `NOT_CARRIER` and lands in their
 * stuck list. That is correct: it is no longer their delivery. Both completion CASes bind
 * `carriedById` to the completing actor, so a reassign committing after the completion's read
 * makes the old carrier's completion miss and throw instead of landing under the wrong carrier.
 */
export async function reassignShipmentCarrier(input: {
  shipmentId: string;
  carriedById: string;
  reassignedById: string;
}): Promise<{ ok: true; orderId: string }> {
  if (!input.carriedById || !(await isEligibleCarrier(prisma, input.carriedById))) {
    throw new DeliveryShipmentError("INVALID_CARRIER");
  }
  return runSerializable(async (tx) => {
    const shipment = await tx.deliveryShipment.findUnique({
      where: { id: input.shipmentId },
      select: { id: true, orderId: true, status: true, method: true, carriedById: true },
    });
    if (!shipment) throw new DeliveryShipmentError("NOT_FOUND");
    if (shipment.method !== "SALESMAN_CARRY" || shipment.status !== "IN_TRANSIT") {
      throw new DeliveryShipmentError("INVALID_STATE");
    }
    if (shipment.carriedById === input.carriedById) {
      return { ok: true as const, orderId: shipment.orderId };
    }
    const result = await tx.deliveryShipment.updateMany({
      where: {
        id: shipment.id,
        status: "IN_TRANSIT",
        method: "SALESMAN_CARRY",
        carriedById: shipment.carriedById,
      },
      data: { carriedById: input.carriedById },
    });
    if (result.count === 0) throw new DeliveryShipmentError("INVALID_STATE");
    await tx.auditLog.create({
      data: {
        userId: input.reassignedById,
        action: "DELIVERY_SHIPMENT_CARRIER_REASSIGNED",
        entityType: "DeliveryShipment",
        entityId: shipment.id,
        changes: {
          before: { carriedById: shipment.carriedById },
          after: { carriedById: input.carriedById },
        },
      },
    });
    return { ok: true as const, orderId: shipment.orderId };
  });
}

/**
 * PACKED → IN_TRANSIT. EXPEDITION needs the resi (MISSING_RESI), the weight in kg (MISSING_WEIGHT,
 * P35) and the handover-to-courier photo showing the weight (MISSING_HANDOVER_PHOTO, P43);
 * SALESMAN_CARRY needs its carrier. Read, check and CAS in one serializable transaction; the CAS
 * re-checks what the read saw, so a value cleared in between cannot ship. Moves no stock — that
 * left at creation.
 */
export async function shipDeliveryShipment(input: {
  shipmentId: string;
  shippedById: string;
}): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const shipment = await tx.deliveryShipment.findUnique({
      where: { id: input.shipmentId },
      select: { status: true, method: true, resiNumber: true, carriedById: true, weightKg: true, handoverPhotoR2Key: true, handoverPhotoUrl: true },
    });
    if (!shipment) throw new DeliveryShipmentError("NOT_FOUND");
    if (shipment.status !== "PACKED") throw new DeliveryShipmentError("INVALID_STATE");
    if (shipment.method === "EXPEDITION") {
      if (!shipment.resiNumber?.trim()) throw new DeliveryShipmentError("MISSING_RESI");
      if (shipment.weightKg === null) throw new DeliveryShipmentError("MISSING_WEIGHT");
      if (!shipment.handoverPhotoR2Key || !shipment.handoverPhotoUrl) throw new DeliveryShipmentError("MISSING_HANDOVER_PHOTO");
    }
    if (shipment.method === "SALESMAN_CARRY" && !shipment.carriedById) {
      throw new DeliveryShipmentError("MISSING_CARRIER");
    }
    const result = await tx.deliveryShipment.updateMany({
      where: {
        id: input.shipmentId,
        status: "PACKED",
        ...(shipment.method === "EXPEDITION"
          ? {
              resiNumber: { not: null },
              NOT: { resiNumber: "" },
              weightKg: { not: null },
              handoverPhotoR2Key: { not: null },
            }
          : { carriedById: { not: null } }),
      },
      data: { status: "IN_TRANSIT", shippedAt: new Date(), shippedById: input.shippedById },
    });
    if (result.count === 0) return throwForMissedCas(tx, input.shipmentId);
    return { ok: true as const };
  });
}

export type PodReceipt = {
  receiptId: string;
  storeId: string;
  sourceType: "KONSI_TRANSFER" | "PUTUS_DELIVERY";
  sesudah: SesudahTerima;
};

export type HasilSelesaikanPengiriman = {
  ok: true;
  deliveryId: string;
  transferId: string | null;
  mode: "INFO_ONLY" | "RECEIPT_AT_POD";
  podReceipt: PodReceipt | null;
  barangKembali: string[];
  ulang: boolean;
};

/**
 * Completion = the expedition/courier confirmation (owner putus answer 2026-11-02). Nothing about
 * stock or the nota moves here unless the POD is also the store's receipt:
 *
 * - `RECEIPT_AT_POD` — no receipt exists yet and either the courier receives for the store
 *   (`penerimaPod` = KURIR: no SPG at the POD and none stopped while these goods were on the road,
 *   or no holder to record the PIC's receipt — decision 2026-10-29 tambahan #3), or the store's SPG
 *   stopped while they were on the road (`PEMEGANG`, P45a) AND the courier records a door refusal
 *   or hands nothing over at all. Who records a refusal in that case is still an open owner
 *   question and the holder's form records only arrivals, so the confirmation keeps doing it as
 *   before; and with nothing handed over there is nothing for the PIC to receive, while the holder
 *   can only record a shipment that was handed over — without this it could never close. Each line
 *   must account for every planned piece as diterima (`deliveredQty`), retur langsung
 *   (`returnedQty`, refused at the door) or hilang (`lostQty`), else LINE_UNACCOUNTED, and the store
 *   receipt is written in the same transaction (`terimaKirimanDalamTx`, which corrects the putus
 *   nota, returns refused goods to the main warehouse and opens the StockLoss). Any refusal it
 *   returns rolls the completion back (TERIMA_GAGAL).
 * - `INFO_ONLY` — otherwise (a store with an SPG, P40, absent or not, P26; or `PEMEGANG` with
 *   something handed over and nothing refused, P45a: the holder salesman later records what the PIC
 *   got, and whatever did not arrive is lost): each line carries only what was handed to the store.
 *   Refused or lost pieces are DICATAT_SPG (recorded at the store's receipt); nothing handed over
 *   is POD_KOSONG unless the receipt already exists.
 *
 * The same-actor replay guard returns `ulang: true` so the action re-runs its idempotent post-commit
 * tail; the StockLoss of a receipt is already written in-tx.
 */
export async function completeDeliveryShipment(input: {
  shipmentId: string;
  deliveredById: string;
  proofPhotoUrl: string;
  proofPhotoR2Key: string;
  /** SALESMAN_CARRY only, and mandatory there — the delivery's proof-of-location. */
  gps?: { lat: number; lng: number };
  /** SALESMAN_CARRY only, and mandatory there — a photo of the signed physical nota. */
  signatureUrl?: string;
  signatureR2Key?: string;
  /** SALESMAN_CARRY only, and mandatory there — the receiver's typed name, trimmed and capped at 120 chars. */
  signedByName?: string;
  /**
   * When this completion actually happened, per the client's clock — set by the offline
   * queue to the capture time, omitted (defaults to `new Date()`) by the live online path.
   * Clamped server-side below: a value in the future or more than 3 days old is replaced
   * with `new Date()` rather than trusted, so a malformed client clock cannot invalidate an
   * otherwise-legitimate completion.
   */
  deliveredAt?: Date;
  /** Set only by the offline-flush action — stamps DeliveryShipment.completedOfflineAt. */
  completedOffline?: boolean;
  lines: Array<{ shipmentLineId: string; deliveredQty: number; returnedQty?: number; lostQty?: number }>;
}): Promise<HasilSelesaikanPengiriman> {
  const shipment = await prisma.deliveryShipment.findUnique({
    where: { id: input.shipmentId },
    include: {
      lines: true,
      order: { select: { orderType: true, storeId: true } },
      konsiTransfer: { select: { id: true, status: true } },
      delivery: { select: { id: true, voidedAt: true } },
    },
  });
  if (!shipment) throw new DeliveryShipmentError("NOT_FOUND");
  /**
   * Idempotent replay guard — the classic "response lost after the server committed" failure mode.
   * Scoped to the SAME actor only — a different actor hitting an already-completed shipment is a
   * real anomaly, not a benign retry, and still refuses below. Deliberately runs BEFORE every input
   * check: an offline-queued retry may legitimately carry no photos/lines the second time around.
   */
  if (isSameActorReplay(shipment, input.deliveredById)) {
    return {
      ok: true,
      deliveryId: shipment.deliveryId ?? "",
      transferId: shipment.konsiTransfer?.id ?? null,
      mode: "INFO_ONLY",
      podReceipt: null,
      barangKembali: [],
      ulang: true,
    };
  }
  if (shipment.status !== "IN_TRANSIT") throw new DeliveryShipmentError("INVALID_STATE");
  const isKonsi = shipment.order.orderType === "KONSI";

  if (input.lines.length === 0) throw new DeliveryShipmentError("NO_LINES");
  const proofPhotoUrl = input.proofPhotoUrl?.trim();
  if (!proofPhotoUrl) throw new DeliveryShipmentError("MISSING_PROOF");
  /**
   * The goods-photo key bind, sibling of the nota-key binds in the SALESMAN_CARRY branch below.
   * The expected folder follows `method`, because the two methods upload through different routes:
   * the salesman-carry PWA route writes `delivery-pod-proofs/<shipmentId>/goods.<ext>`, the
   * backoffice route writes `delivery-proofs/<shipmentId>/<timestamp>.<ext>`. The bind is the exact
   * shape `<folder>/<segment>.<ext>` (`isR2KeyInFolder`), not a prefix match.
   */
  const goodsKeyFolder =
    shipment.method === "SALESMAN_CARRY"
      ? `delivery-pod-proofs/${input.shipmentId}`
      : `delivery-proofs/${input.shipmentId}`;
  if (!isR2KeyInFolder(input.proofPhotoR2Key, goodsKeyFolder)) {
    throw new DeliveryShipmentError("MISSING_PROOF");
  }
  for (const line of input.lines) {
    for (const q of [line.deliveredQty, line.returnedQty ?? 0, line.lostQty ?? 0]) {
      if (!Number.isInteger(q) || q < 0) throw new DeliveryShipmentError("INVALID_QTY");
    }
  }

  /*
   * Backstop: every shipment of the new rule has its document from creation. One packed by the old
   * image (deploy window) has none — cancel and re-create it.
   */
  if (!isKonsi && (!shipment.deliveryId || !shipment.delivery)) throw new DeliveryShipmentError("INVALID_STATE");
  if (isKonsi && !shipment.konsiTransfer) throw new DeliveryShipmentError("INVALID_STATE");
  /*
   * A voided nota / cancelled transfer has two origins. Without a store receipt it was "tidak jadi
   * dikirim" in a race this read lost — refused. WITH a store receipt the SPG refused every piece at
   * the door before the courier confirmed (R10 allows her receipt while IN_TRANSIT, P40): the
   * document was voided by that receipt, and the courier's confirmation is the only exit left for
   * the shipment — cancel refuses it (the nota is already voided / the store received) and the
   * order's remainder cannot close while it is IN_TRANSIT. It completes INFO_ONLY below.
   */
  const dokumenBatal = isKonsi
    ? shipment.konsiTransfer!.status === "CANCELLED"
    : shipment.delivery!.voidedAt !== null;
  if (dokumenBatal) {
    const terimaToko = await prisma.storeReceipt.findUnique({
      where: {
        sourceType_sourceId: isKonsi
          ? { sourceType: "KONSI_TRANSFER", sourceId: shipment.konsiTransfer!.id }
          : { sourceType: "PUTUS_DELIVERY", sourceId: shipment.deliveryId! },
      },
      select: { id: true },
    });
    if (!terimaToko) throw new DeliveryShipmentError("INVALID_STATE");
  }

  const now = new Date();
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const effectiveDeliveredAt =
    input.deliveredAt &&
    input.deliveredAt.getTime() <= now.getTime() &&
    input.deliveredAt.getTime() >= now.getTime() - THREE_DAYS_MS
      ? input.deliveredAt
      : now;

  let salesmanCarryGps: { lat: number; lng: number; distanceMeters: number } | undefined;
  let salesmanCarrySignature: { url: string; r2Key: string; signedByName: string } | undefined;

  if (shipment.method === "SALESMAN_CARRY") {
    /**
     * The feature's anti-fraud property, and the whole reason `carriedById` exists: the actor
     * closing the delivery must BE the salesman it was assigned to. `shipDeliveryShipment` only
     * checks the column is SET, and `listMyDeliveries` only scopes the PWA queue — neither binds
     * the completing actor, so without this check any `deliveries:pod` holder could open another
     * salesman's shipment URL and close it — recording the store's receipt (at a store without an
     * SPG) and stamping their own id as `deliveredById` — while the assigned carrier's queue
     * silently loses the row. GPS is a LOCATION check standing in for an IDENTITY check and is
     * trivially spoofed from a browser, so it is not a substitute. Enforced here rather than only
     * in the PWA page because every `"use server"` export is independently callable.
     *
     * `!==` on the nullable column is safe: a null `carriedById` cannot equal a session user id,
     * so an unassigned SALESMAN_CARRY shipment is refused here too (it should already have been
     * refused at ship time by MISSING_CARRIER).
     */
    if (shipment.carriedById !== input.deliveredById) {
      throw new DeliveryShipmentError("NOT_CARRIER");
    }

    if (!input.gps) throw new DeliveryShipmentError("MISSING_GPS");
    /**
     * The declared `number` type is not a runtime guarantee — this is a `"use server"`-reachable
     * writer, so the payload is network input. Unvalidated, `{ lat: null, lng: null }` OPENS the
     * gate instead of failing it: `null - null` coerces to `0` inside `haversineMeters`, which
     * returns a distance of 0, which then passes both `=== null` and `> radius` and completes the
     * delivery with a fabricated "0 metres from the store" audit record. `NaN` and a missing field
     * do the same, since `NaN === null` and `NaN > radius` are both false. Same stance the
     * `deliveredQty` check above takes on its own declared type, and the same range the check-in
     * action's zod schema enforces. `Number.isFinite`, NOT the global `isFinite`, which coerces
     * its argument — `isFinite(null)` is `true` and would make this guard a no-op.
     */
    if (
      !Number.isFinite(input.gps.lat) ||
      !Number.isFinite(input.gps.lng) ||
      Math.abs(input.gps.lat) > 90 ||
      Math.abs(input.gps.lng) > 180
    ) {
      throw new DeliveryShipmentError("MISSING_GPS");
    }

    const store = await prisma.store.findUnique({
      where: { id: shipment.order.storeId },
      select: { lat: true, lng: true, checkinRadiusMeters: true },
    });
    /**
     * Two distinct failures, two distinct codes: a missing row is a NOT_FOUND, not a geocoding gap
     * the ops team could fix by entering coordinates. `FieldSalesOrder.storeId` carries a real FK
     * (`ON DELETE RESTRICT`), so this branch is defensive; keep it distinct from the geocoding one.
     */
    if (!store) throw new DeliveryShipmentError("NOT_FOUND");
    if (store.lat === null || store.lng === null) {
      throw new DeliveryShipmentError("STORE_NOT_GEOCODED");
    }

    const globalRow = await prisma.systemSetting.findUnique({
      where: { key: "checkin.radiusMeters" },
    });
    const effectiveRadius = resolveEffectiveRadius(
      store.checkinRadiusMeters,
      parseRadiusSetting(globalRow?.value),
    );
    const gpsResult = evaluateCheckinRadius({
      checkin: input.gps,
      store: { lat: store.lat.toNumber(), lng: store.lng.toNumber() },
      effectiveRadiusMeters: effectiveRadius,
    });
    /**
     * `distanceMeters: null` is `evaluateCheckinRadius`'s "the store has no coordinates" return,
     * and it comes back paired with `outOfRadius: false`. The store check-in flow treats that as a
     * PASS (it only ever warns); here it is a REFUSAL — a deliberate divergence in interpretation,
     * not a bug, and the reason this gate must not be expressed as `if (outOfRadius)` alone. The
     * store null-check above already covers the same case; keeping both means a future change to
     * `evaluateCheckinRadius`'s null conditions cannot silently open the gate. Compare `=== null`
     * rather than falsiness: a legitimate 0-metre distance is falsy.
     */
    if (gpsResult.distanceMeters === null) throw new DeliveryShipmentError("STORE_NOT_GEOCODED");
    if (gpsResult.outOfRadius) throw new DeliveryShipmentError("GPS_OUT_OF_RADIUS");

    const signatureUrl = input.signatureUrl?.trim();
    const signatureR2Key = input.signatureR2Key?.trim();
    const signedByName = input.signedByName?.trim();

    if (!signatureUrl || !signatureR2Key) throw new DeliveryShipmentError("MISSING_NOTA_PHOTO");
    /**
     * Two independent binds, both closing the same hole: without them, any `deliveries:pod`
     * holder can pass the SAME R2 key already used for `proofPhotoR2Key` (one photo satisfies
     * both gates) or an arbitrary string that was never uploaded to R2 at all for THIS shipment
     * (nothing here queries R2 to confirm the object exists — the upload route already wrote it,
     * this only checks the key's shape is consistent with having come from it). Same lesson as
     * NOT_CARRIER above: every "use server" export is independently callable, so the UI only
     * ever sending real uploaded keys is not a guarantee. The goods key gets the same
     * shipment-scoped bind (`MISSING_PROOF`) above, before the method branch.
     */
    if (signatureR2Key === input.proofPhotoR2Key) {
      throw new DeliveryShipmentError("MISSING_NOTA_PHOTO");
    }
    if (!isR2KeyInFolder(signatureR2Key, `delivery-pod-proofs/${input.shipmentId}`)) {
      throw new DeliveryShipmentError("MISSING_NOTA_PHOTO");
    }
    if (!signedByName || signedByName.length > 120) {
      throw new DeliveryShipmentError("MISSING_SIGNED_BY");
    }

    salesmanCarryGps = {
      lat: input.gps.lat,
      lng: input.gps.lng,
      distanceMeters: gpsResult.distanceMeters,
    };
    salesmanCarrySignature = {
      url: signatureUrl,
      r2Key: signatureR2Key,
      signedByName,
    };
  }

  const lineById = new Map(shipment.lines.map((l) => [l.id, l]));
  /**
   * The payload must name EVERY line on the shipment EXACTLY once: a duplicate would stamp one line
   * twice, a missing one would leave its `deliveredQty` null forever while the status reads
   * delivered — a terminal status that can neither be completed nor cancelled again.
   */
  const seenLineIds = new Set<string>();
  for (const line of input.lines) {
    const shipmentLine = lineById.get(line.shipmentLineId);
    if (!shipmentLine) throw new DeliveryShipmentError("NOT_FOUND");
    if (seenLineIds.has(line.shipmentLineId)) throw new DeliveryShipmentError("LINE_MISMATCH");
    seenLineIds.add(line.shipmentLineId);
    if (line.deliveredQty > shipmentLine.plannedQty) throw new DeliveryShipmentError("OVER_PLANNED");
  }
  if (seenLineIds.size !== shipment.lines.length) throw new DeliveryShipmentError("LINE_MISMATCH");

  const anyShort = input.lines.some((line) => line.deliveredQty < lineById.get(line.shipmentLineId)!.plannedQty);
  /* Annotated explicitly: the literal union would widen to `string` inside the object below. */
  const nextStatus: "PARTIALLY_DELIVERED" | "DELIVERED" = anyShort ? "PARTIALLY_DELIVERED" : "DELIVERED";
  const completionData = {
    status: nextStatus,
    deliveredAt: effectiveDeliveredAt,
    deliveredById: input.deliveredById,
    proofPhotoUrl,
    proofPhotoR2Key: input.proofPhotoR2Key,
    ...(input.completedOffline ? { completedOfflineAt: now } : {}),
    /* The GPS audit trail and the status it justifies land in one write, never as a second write. */
    ...(salesmanCarryGps
      ? {
          gpsLat: salesmanCarryGps.lat,
          gpsLng: salesmanCarryGps.lng,
          gpsDistanceMeters: salesmanCarryGps.distanceMeters,
        }
      : {}),
    ...(salesmanCarrySignature
      ? {
          signatureUrl: salesmanCarrySignature.url,
          signatureR2Key: salesmanCarrySignature.r2Key,
          signedByName: salesmanCarrySignature.signedByName,
        }
      : {}),
  };

  const sourceType = isKonsi ? ("KONSI_TRANSFER" as const) : ("PUTUS_DELIVERY" as const);
  const sourceId = isKonsi ? shipment.konsiTransfer!.id : shipment.deliveryId!;
  let podReceipt: PodReceipt | null = null;
  let mode: "INFO_ONLY" | "RECEIPT_AT_POD" = "INFO_ONLY";

  await runSerializable(async (tx) => {
    podReceipt = null;
    const sudahDiterima = await tx.storeReceipt.findUnique({
      where: { sourceType_sourceId: { sourceType, sourceId } },
      select: { id: true },
    });
    /*
     * R6: who receives for the store (`penerimaPod`). An SPG who is merely absent stays assigned
     * (P26: the goods wait for her) → INFO_ONLY. One who stopped on or after the day this shipment
     * was created, at an active store with a holder, leaves the receipt to the store's PIC,
     * recorded by the holder salesman during a visit with the PIC's name and a photo (P45/P45a,
     * "benar") → INFO_ONLY, unless the courier records a door refusal or hands nothing over. The
     * holder's form records only arrivals and who records a refusal there is still an owner
     * question, so until he answers the confirmation stays the store's receipt as before and the
     * refused goods go back to the main warehouse instead of being booked as lost; and a shipment
     * with nothing handed over has nothing for the PIC to receive and could never reach the
     * holder's form (it needs DELIVERED/PARTIALLY_DELIVERED). Otherwise — no SPG when the shipment
     * was created, or nobody who could record the PIC's receipt — the courier's confirmation is the
     * receipt (decision 2026-10-29 tambahan #3).
     */
    const penerima = await penerimaPod(tx, shipment.order.storeId, shipment.createdAt);
    const kurirMencatat =
      penerima === "KURIR" ||
      (penerima === "PEMEGANG" &&
        (input.lines.some((l) => (l.returnedQty ?? 0) > 0) || input.lines.every((l) => l.deliveredQty === 0)));
    mode = !sudahDiterima && kurirMencatat ? "RECEIPT_AT_POD" : "INFO_ONLY";

    if (mode === "INFO_ONLY") {
      if (input.lines.some((l) => (l.returnedQty ?? 0) > 0 || (l.lostQty ?? 0) > 0)) {
        throw new DeliveryShipmentError("DICATAT_SPG");
      }
      if (!sudahDiterima && input.lines.every((l) => l.deliveredQty === 0)) throw new DeliveryShipmentError("POD_KOSONG");
    } else {
      for (const l of input.lines) {
        const planned = lineById.get(l.shipmentLineId)!.plannedQty;
        if (l.deliveredQty + (l.returnedQty ?? 0) + (l.lostQty ?? 0) !== planned) throw new DeliveryShipmentError("LINE_UNACCOUNTED");
      }
    }

    const result = await tx.deliveryShipment.updateMany({
      where: {
        id: input.shipmentId,
        status: "IN_TRANSIT",
        ...(shipment.method === "SALESMAN_CARRY" ? { carriedById: input.deliveredById } : {}),
      },
      data: completionData,
    });
    if (result.count === 0) throw new DeliveryShipmentError("INVALID_STATE");

    for (const line of input.lines) {
      await tx.deliveryShipmentLine.update({
        where: { id: line.shipmentLineId },
        data: {
          deliveredQty: line.deliveredQty,
          ...(mode === "RECEIPT_AT_POD" ? { returnedQty: line.returnedQty ?? 0, lostQty: line.lostQty ?? 0 } : {}),
        },
      });
    }

    if (mode === "RECEIPT_AT_POD") {
      /* The document's own lines, keyed by order line (one line per order line since creation). */
      const barisDok = isKonsi
        ? await tx.konsiTransferLine.findMany({ where: { transferId: sourceId }, select: { id: true, orderLineId: true } })
        : await tx.fieldSalesDeliveryLine.findMany({ where: { deliveryId: sourceId }, select: { id: true, orderLineId: true } });
      const perBarisPesanan = new Map<string, { tiba: number; tolak: number }>();
      for (const l of input.lines) {
        const sl = lineById.get(l.shipmentLineId)!;
        const ada = perBarisPesanan.get(sl.orderLineId) ?? { tiba: 0, tolak: 0 };
        perBarisPesanan.set(sl.orderLineId, { tiba: ada.tiba + l.deliveredQty, tolak: ada.tolak + (l.returnedQty ?? 0) });
      }
      const sesudah = sesudahTerimaKosong();
      const hasil = await terimaKirimanDalamTx(
        tx,
        {
          storeId: shipment.order.storeId,
          userId: input.deliveredById,
          sourceType,
          sourceId,
          oleh: "POD",
          diterima: barisDok.map((b) => {
            const q = perBarisPesanan.get(b.orderLineId ?? "") ?? { tiba: 0, tolak: 0 };
            return { lineId: b.id, qtyReceived: q.tiba, qtyRefused: q.tolak };
          }),
          sekarang: effectiveDeliveredAt,
        },
        sesudah,
        { kunci: `pod-${input.shipmentId}`, waktuTangkap: null },
      );
      if (!hasil.ok) throw new DeliveryShipmentError("TERIMA_GAGAL", hasil.alasan);
      podReceipt = { receiptId: hasil.receiptId, storeId: shipment.order.storeId, sourceType, sesudah };
    }
  });

  const terima = podReceipt as PodReceipt | null;
  return {
    ok: true,
    deliveryId: shipment.deliveryId ?? "",
    transferId: shipment.konsiTransfer?.id ?? null,
    mode,
    podReceipt: terima,
    barangKembali: terima ? terima.sesudah.barangKembali : [],
    ulang: false,
  };
}

export type HasilBatalPengiriman = {
  ok: true;
  orderId: string;
  orderType: "PUTUS" | "KONSI";
  berangkat: boolean;
  deliveryId: string | null;
  transferId: string | null;
  barangKembali: string[];
  notifikasi: AdminNotification[];
};

/**
 * "Tidak jadi dikirim" (Q1, P16, P25, P33a, P41/P41a). PACKED or IN_TRANSIT only; a reason is
 * required. The ACTION checks the permission first: KONSI (no nota exists) and a shipment of the
 * old rule without a document on `deliveries:ship`, PUTUS with a nota on `deliveries:cancel_nota`.
 *
 * One serializable transaction checks first, then writes; any failure throws and rolls everything
 * back. KONSI: the transfer must still be IN_TRANSIT with no store receipt (ALREADY_RECEIVED), and
 * every piece still on it returns to the main warehouse; the transfer becomes CANCELLED. PUTUS: the
 * nota is refused when the store received it (its `StoreReceipt`, or a signed bukti terima — the
 * final design review's rule, put to the owner), it has any payment report checked or not (P33a),
 * it sits in a running kontrabon, or it priced a field return; otherwise it is voided with its
 * receivable and faktur, and Keuangan is notified (returned in `notifikasi`, fanned out by the
 * action after commit). Goods LOST in transit are never handled here — that would put them back in
 * stock; the store receives short instead.
 */
export async function cancelDeliveryShipment(input: {
  shipmentId: string;
  cancelledById: string;
  reason: string;
}): Promise<HasilBatalPengiriman> {
  const reason = input.reason?.trim() ?? "";
  if (!reason || reason.length > 1000) throw new DeliveryShipmentError("REASON_REQUIRED");

  const tangkap: { notifikasi: AdminNotification[]; barangKembali: string[] } = { notifikasi: [], barangKembali: [] };
  return runSerializable(async (tx): Promise<HasilBatalPengiriman> => {
    tangkap.notifikasi = [];
    tangkap.barangKembali = [];
    const shipment = await tx.deliveryShipment.findUnique({
      where: { id: input.shipmentId },
      select: {
        id: true,
        docNo: true,
        orderId: true,
        status: true,
        shippedAt: true,
        deliveryId: true,
        order: { select: { orderType: true } },
        konsiTransfer: { select: { id: true, status: true, lines: { select: { orderLineId: true, qty: true, returnedQty: true } } } },
      },
    });
    if (!shipment) throw new DeliveryShipmentError("NOT_FOUND");
    if (shipment.status !== "PACKED" && shipment.status !== "IN_TRANSIT") throw new DeliveryShipmentError("INVALID_STATE");
    const isKonsi = shipment.order.orderType === "KONSI";
    const sekarang = new Date();

    if (isKonsi && shipment.konsiTransfer) {
      const t = shipment.konsiTransfer;
      const diterima = await tx.storeReceipt.findUnique({
        where: { sourceType_sourceId: { sourceType: "KONSI_TRANSFER", sourceId: t.id } },
        select: { id: true },
      });
      if (diterima || t.status === "RECEIVED") throw new DeliveryShipmentError("ALREADY_RECEIVED");
      if (t.status === "CANCELLED") throw new DeliveryShipmentError("INVALID_STATE");
      const sisa = new Map<string, number>();
      for (const l of t.lines) {
        if (!l.orderLineId) continue;
        sisa.set(l.orderLineId, (sisa.get(l.orderLineId) ?? 0) + Math.round(Number(l.qty)) - l.returnedQty);
      }
      const kembali = await kembalikanKonsiTransferInTx(tx, {
        transferId: t.id,
        baris: Array.from(sisa, ([orderLineId, qty]) => ({ orderLineId, qty })).filter((b) => b.qty > 0),
        olehUserId: input.cancelledById,
        sekarang,
        alasan: reason,
        batal: true,
        kunci: "batal",
      });
      tangkap.barangKembali = kembali.barangKembali;
    } else if (!isKonsi && shipment.deliveryId) {
      const hasil = await batalkanNotaPengirimanInTx(tx, {
        deliveryId: shipment.deliveryId,
        olehUserId: input.cancelledById,
        alasan: reason,
        sekarang,
        refKembali: "batal",
        periksa: true,
      });
      tangkap.notifikasi = hasil.notifikasi;
      tangkap.barangKembali = hasil.barangKembali;
    }
    /* Else: a shipment of the old rule (packed by the old image) without a document — nothing moved, nothing to reverse. */

    const result = await tx.deliveryShipment.updateMany({
      where: { id: input.shipmentId, status: { in: ["PACKED", "IN_TRANSIT"] } },
      data: { status: "CANCELLED", cancelledAt: sekarang, cancelledById: input.cancelledById, cancelReason: reason },
    });
    if (result.count === 0) return throwForMissedCas(tx, input.shipmentId);
    await tx.auditLog.create({
      data: {
        userId: input.cancelledById,
        action: "DELIVERY_SHIPMENT_CANCELLED",
        entityType: "DeliveryShipment",
        entityId: shipment.id,
        changes: { before: { status: shipment.status }, after: { status: "CANCELLED" } },
        metadata: {
          docNo: shipment.docNo,
          orderId: shipment.orderId,
          deliveryId: shipment.deliveryId,
          transferId: shipment.konsiTransfer?.id ?? null,
        },
        reason,
      },
    });

    return {
      ok: true,
      orderId: shipment.orderId,
      orderType: isKonsi ? "KONSI" : "PUTUS",
      berangkat: shipment.shippedAt !== null,
      deliveryId: shipment.deliveryId,
      transferId: shipment.konsiTransfer?.id ?? null,
      barangKembali: tangkap.barangKembali,
      notifikasi: tangkap.notifikasi,
    };
  });
}
