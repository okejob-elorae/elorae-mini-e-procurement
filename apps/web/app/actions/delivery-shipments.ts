"use server";

import { revalidatePath } from "next/cache";
import { prisma, type AdminNotification } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  createDeliveryShipment,
  updateShipmentTracking,
  reassignShipmentCarrier,
  shipDeliveryShipment,
  completeDeliveryShipment,
  cancelDeliveryShipment,
} from "@/lib/delivery/shipment-writer";
import { listDeliveryShipments, getDeliveryShipment } from "@/lib/delivery/shipment-queries";
import { mapError, type ShipmentActionResult } from "@/lib/delivery/action-errors";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postFieldDeliveryRevenueJournal, postFieldDeliveryCogsJournal } from "@/lib/finance/ar/delivery-journal";
import { kaitPindahKonsiPengiriman } from "@/lib/finance/operasional/kait";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { kabarkanPengirimanBerangkat, kabarkanPengirimanDiserahkan, kabarkanPengirimanDibatalkan } from "@/lib/spg/kabar-pengiriman";
import { kabarkanPesananDikirim } from "@/lib/delivery/kabar-salesman";
import { sebarSesudahTerima } from "@/lib/spg/stok-writer";


const ERROR_TAG = "delivery-shipments";

/**
 * Revalidates the order detail page a shipment belongs to. The writer's return carries no order
 * id, so it is looked up here, after the write has committed; a failed lookup is logged and
 * swallowed because the write already succeeded and the register path is revalidated regardless.
 */
async function revalidateShipmentOrder(shipmentId: string): Promise<void> {
  try {
    const shipment = await prisma.deliveryShipment.findUnique({
      where: { id: shipmentId },
      select: { orderId: true },
    });
    if (shipment) revalidatePath(`/backoffice/field-sales-orders/${shipment.orderId}`);
  } catch (error) {
    console.error(`[${ERROR_TAG}] order revalidation lookup failed`, error);
  }
}

/**
 * Both of a PUTUS delivery's journals, through `postArJournalSafely` — never a builder called bare.
 * Called after the nota is issued (shipment creation), after a store receipt corrected it and after
 * a cancel voided it. Posting is idempotent on the source document, so a delivery whose journals
 * already posted re-posts nothing (re-syncing a corrected or voided nota is the nota journal's own
 * job, `lib/finance/ar/delivery-journal.ts`). Never exported: from a `"use server"` module that would publish it as a
 * network-callable action posting journals for any delivery id, which is also why
 * `app/pwa/deliveries/actions.ts` holds its own copy — keep the two in sync by hand.
 */
async function postDeliveryJournals(deliveryId: string, postedById: string): Promise<void> {
  await postArJournalSafely("field_delivery_revenue", deliveryId, () =>
    postFieldDeliveryRevenueJournal(deliveryId, postedById),
  );
  await postArJournalSafely("field_delivery_cogs", deliveryId, () =>
    postFieldDeliveryCogsJournal(deliveryId, postedById),
  );
}

/**
 * Tells the store's SPG the goods have been HANDED OVER — count and receive them — after the
 * completion committed, putus and konsi alike, keyed on the shipment: N is what THIS shipment
 * actually handed over (a konsi order shipped 60 then 40 tells the SPG twice), and a 0-pcs
 * completion says nothing was handed over. The notifier never throws and
 * notifies once per shipment, so a same-actor replay sends nothing new. Never exported, for the
 * same reason as `postDeliveryJournals`, and `app/pwa/deliveries/actions.ts` holds its own copy —
 * keep the two in sync by hand.
 */
async function notifyStoreSpg(shipmentId: string, deliveryId: string, actorId: string): Promise<void> {
  void kabarkanPengirimanDiserahkan({ shipmentId, deliveryId: deliveryId || null, pelakuId: actorId });
}

/**
 * Posts (or re-syncs) the consignment move journal (DR consignment inventory / CR inventory) for a
 * KONSI shipment, after its transaction committed. Stock moves into transit when the shipment is
 * CREATED, so the journal follows creation, every door refusal and a cancel. Idempotent and never
 * throws: a shipment a crashed earlier attempt touched still gets its journal from the next call.
 * Never exported; `app/pwa/deliveries/actions.ts` holds its own copy.
 */
async function postKonsiMoveJournal(shipmentId: string, actorId: string): Promise<void> {
  try {
    const shipment = await prisma.deliveryShipment.findUnique({
      where: { id: shipmentId },
      select: { order: { select: { orderType: true } } },
    });
    if (shipment?.order.orderType !== "KONSI") return;
    await kaitPindahKonsiPengiriman(shipmentId, actorId);
  } catch (error) {
    console.error(`[${ERROR_TAG}] konsi move journal hook failed`, error);
  }
}

/** Goods that left or came back to the main warehouse — the absolute figures go to Jubelio. Never throws. */
async function pushStock(itemIds: readonly string[], ref: string, actorId: string): Promise<void> {
  if (itemIds.length === 0) return;
  try {
    await antrekanPushStok([...new Set(itemIds)], { sumber: "ADJUSTMENT", ref, userId: actorId });
  } catch (error) {
    console.error(`[${ERROR_TAG}] stock push failed`, error);
  }
}

function fanOut(notifications: readonly AdminNotification[]): void {
  for (const n of notifications) void fanOutAdminNotification(n);
}

/**
 * READ access to the shipment register. Not exported — a `"use server"` module may only export
 * async functions, so the server page spells the same OR out with `hasPermission` directly.
 */
function canReadShipments(permissions: string[]): boolean {
  return (
    hasPermission(permissions, PERMISSIONS.DELIVERIES_SHIP) ||
    hasPermission(permissions, PERMISSIONS.DELIVERIES_POD) ||
    hasPermission(permissions, PERMISSIONS.DELIVERIES_CANCEL_NOTA)
  );
}

/**
 * A `YYYY-MM-DD` calendar day at WIB midnight, or null for anything that is not one. Same shape
 * and same three rejections as `parseCalendarDay` in `app/actions/field-sales-deliveries.ts`: a
 * non-string (a JSON number survives into `.trim()` and throws), a value `new Date` silently rolls
 * over (`"2026-02-30"` → 2 March, and it would be STORED), and a year outside MariaDB's `DATETIME`
 * range. The format round-trip is what closes the last two.
 *
 * Without this, an emptied date field produces an Invalid Date, the writer's own ordering guard
 * evaluates `NaN < NaN === false` and therefore PASSES it, and the Invalid Date reaches a Prisma
 * write.
 */
function parseCalendarDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const parsed = parseDateOnly(trimmed);
  if (!parsed) return null;
  return formatDateOnlyJakarta(parsed) === trimmed ? parsed : null;
}

/**
 * PACKS a shipment AND moves its goods out of the main warehouse (konsi: into transit to the store;
 * putus: the nota tagihan is issued, dated today WIB). `idempotencyKey` is made once per dialog
 * open and kept across retries, so a double submit makes one shipment; on a replay (`ulang`) the
 * idempotent post-commit tail still runs, in case the first response was lost before it ran.
 */
export async function createShipmentAction(input: {
  orderId: string;
  method: "EXPEDITION" | "SALESMAN_CARRY";
  lines: Array<{ orderLineId: string; qty: number }>;
  idempotencyKey: string;
  dueDate?: string;
}): Promise<ShipmentActionResult & { shipmentId?: string; docNo?: string; ulang?: boolean }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const kunci = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (kunci.length < 1 || kunci.length > 64) return { ok: false, reason: "INVALID_REQUEST" };
  const dueDate = input.dueDate ? parseCalendarDay(input.dueDate) : undefined;
  if (dueDate === null) return { ok: false, reason: "INVALID_REQUEST" };
  try {
    const result = await createDeliveryShipment({
      orderId: input.orderId,
      method: input.method,
      lines: input.lines,
      packedById: session.user.id,
      idempotencyKey: kunci,
      dueDate,
    });
    if (result.deliveryId) await postDeliveryJournals(result.deliveryId, session.user.id);
    else await postKonsiMoveJournal(result.shipmentId, session.user.id);
    // Also on a replay (R1): the first response may have been lost before the push ran; the
    // figures pushed are absolute, so pushing them again is harmless.
    await pushStock(result.barangKeluar, `kirim ${result.docNo}`, session.user.id);
    revalidatePath("/backoffice/deliveries");
    revalidatePath(`/backoffice/field-sales-orders/${input.orderId}`);
    return { ok: true, shipmentId: result.shipmentId, docNo: result.docNo, ulang: result.ulang };
  } catch (error) {
    return mapError(error, ERROR_TAG);
  }
}

export async function updateShipmentTrackingAction(input: {
  shipmentId: string;
  carrierName?: string;
  resiNumber?: string;
  carriedById?: string;
  weightKg?: number | null;
  handoverPhotoUrl?: string;
  handoverPhotoR2Key?: string;
}): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  if (input.weightKg !== undefined && input.weightKg !== null && typeof input.weightKg !== "number") {
    return { ok: false, reason: "INVALID_WEIGHT" };
  }
  try {
    await updateShipmentTracking({
      shipmentId: input.shipmentId,
      carrierName: input.carrierName,
      resiNumber: input.resiNumber,
      carriedById: input.carriedById,
      weightKg: input.weightKg,
      handoverPhotoUrl: input.handoverPhotoUrl,
      handoverPhotoR2Key: input.handoverPhotoR2Key,
    });
    revalidatePath("/backoffice/deliveries");
    revalidatePath(`/backoffice/deliveries/${input.shipmentId}`);
    return { ok: true };
  } catch (error) {
    return mapError(error, ERROR_TAG);
  }
}

export async function reassignShipmentCarrierAction(input: {
  shipmentId: string;
  carriedById: string;
}): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  try {
    const result = await reassignShipmentCarrier({
      shipmentId: input.shipmentId,
      carriedById: input.carriedById,
      reassignedById: session.user.id,
    });
    revalidatePath("/backoffice/deliveries");
    revalidatePath(`/backoffice/field-sales-orders/${result.orderId}`);
    return { ok: true };
  } catch (error) {
    return mapError(error, ERROR_TAG);
  }
}

export async function shipShipmentAction(input: { shipmentId: string }): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_SHIP)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  try {
    await shipDeliveryShipment({ shipmentId: input.shipmentId, shippedById: session.user.id });
    /*
     * The IN_TRANSIT transition ("Kirim" in the Pengiriman menu / Ubah Pelacakan). The stock left
     * the warehouse when the shipment was created; the store's SPG is told, once per shipment,
     * after the write committed; the notifier never throws. The putus order's salesman gets the
     * PESANAN_DIKIRIM notice the removed "Catat pengiriman" used to send (P44a) — once, because only
     * one call wins the PACKED → IN_TRANSIT swap.
     */
    void kabarkanPengirimanBerangkat({ shipmentId: input.shipmentId, pelakuId: session.user.id });
    void kabarkanPesananDikirim({ shipmentId: input.shipmentId, pelakuId: session.user.id });
    revalidatePath("/backoffice/deliveries");
    await revalidateShipmentOrder(input.shipmentId);
    return { ok: true };
  } catch (error) {
    return mapError(error, ERROR_TAG);
  }
}

/**
 * The expedition's confirmation. At a store without an SPG it is also the store's receipt
 * (diterima / retur langsung / hilang per line); its post-commit half — notifications, the
 * journals of the corrected nota or the received transfer, the stock push of refused goods — runs
 * here after commit, also on a same-actor replay (idempotent).
 */
export async function completeShipmentAction(input: {
  shipmentId: string;
  proofPhotoUrl: string;
  proofPhotoR2Key: string;
  lines: Array<{ shipmentLineId: string; deliveredQty: number; returnedQty?: number; lostQty?: number }>;
}): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_POD)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  try {
    const result = await completeDeliveryShipment({
      shipmentId: input.shipmentId,
      deliveredById: session.user.id,
      proofPhotoUrl: input.proofPhotoUrl,
      proofPhotoR2Key: input.proofPhotoR2Key,
      lines: input.lines,
    });
    if (result.podReceipt) {
      await sebarSesudahTerima({
        storeId: result.podReceipt.storeId,
        userId: session.user.id,
        sourceType: result.podReceipt.sourceType,
        receiptId: result.podReceipt.receiptId,
        sesudah: result.podReceipt.sesudah,
      });
    }
    if (result.deliveryId) await postDeliveryJournals(result.deliveryId, session.user.id);
    else await postKonsiMoveJournal(input.shipmentId, session.user.id);
    await notifyStoreSpg(input.shipmentId, result.deliveryId, session.user.id);

    revalidatePath("/backoffice/deliveries");
    await revalidateShipmentOrder(input.shipmentId);
    return { ok: true };
  } catch (error) {
    return mapError(error, ERROR_TAG);
  }
}

/**
 * "Tidak jadi dikirim". The permission follows the document (P41/P41a): a putus shipment whose nota
 * exists needs `deliveries:cancel_nota` (default ADMIN + ADMIN_PENJUALAN); a konsi shipment — and a
 * shipment of the old rule without a document — keeps `deliveries:ship`. A reason is required.
 * After commit: journals re-sync, refused stock goes to Jubelio, Keuangan is notified at once, and
 * the SPG is told when the goods had already left.
 */
export async function cancelShipmentAction(input: { shipmentId: string; reason: string }): Promise<ShipmentActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "FORBIDDEN" };
  const permissions = session.user.permissions ?? [];
  if (typeof input.reason !== "string") return { ok: false, reason: "INVALID_REQUEST" };
  let shipment: { deliveryId: string | null; order: { orderType: string } } | null;
  try {
    shipment = await prisma.deliveryShipment.findUnique({
      where: { id: input.shipmentId },
      select: { deliveryId: true, order: { select: { orderType: true } } },
    });
  } catch (error) {
    return mapError(error, ERROR_TAG);
  }
  if (!shipment) return { ok: false, reason: "NOT_FOUND" };
  const needsNotaPermission = shipment.order.orderType === "PUTUS" && shipment.deliveryId !== null;
  const allowed = needsNotaPermission
    ? hasPermission(permissions, PERMISSIONS.DELIVERIES_CANCEL_NOTA)
    : hasPermission(permissions, PERMISSIONS.DELIVERIES_SHIP);
  if (!allowed) return { ok: false, reason: "FORBIDDEN" };
  try {
    const result = await cancelDeliveryShipment({
      shipmentId: input.shipmentId,
      cancelledById: session.user.id,
      reason: input.reason,
    });
    fanOut(result.notifikasi);
    if (result.deliveryId) await postDeliveryJournals(result.deliveryId, session.user.id);
    else await postKonsiMoveJournal(input.shipmentId, session.user.id);
    await pushStock(result.barangKembali, `tidak jadi dikirim ${input.shipmentId}`, session.user.id);
    if (result.berangkat) void kabarkanPengirimanDibatalkan({ shipmentId: input.shipmentId, pelakuId: session.user.id });
    revalidatePath("/backoffice/deliveries");
    revalidatePath(`/backoffice/field-sales-orders/${result.orderId}`);
    return { ok: true };
  } catch (error) {
    return mapError(error, ERROR_TAG);
  }
}

/**
 * The register itself is readable by EITHER permission, for the same reason `getShipmentAction`
 * is: the POD actor reaches the Complete button by finding the IN_TRANSIT row in this list, so a
 * `deliveries:ship`-only gate here would hand them an empty page and nothing to complete. Every
 * WRITE stays on its own permission — `deliveries:ship` for pack/track/ship and the konsi cancel,
 * `deliveries:cancel_nota` for the putus cancel, `deliveries:pod` for completion.
 */
export async function listShipmentsAction(input: {
  status?: "PACKED" | "IN_TRANSIT" | "DELIVERED" | "PARTIALLY_DELIVERED" | "CANCELLED";
  method?: "EXPEDITION" | "SALESMAN_CARRY";
  storeId?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}) {
  const session = await auth();
  if (!session?.user?.id || !canReadShipments(session.user.permissions ?? [])) {
    return { items: [], total: 0 };
  }
  return listDeliveryShipments({
    ...input,
    dateFrom: input.dateFrom ? new Date(`${input.dateFrom}T00:00:00.000+07:00`) : undefined,
    dateTo: input.dateTo ? new Date(`${input.dateTo}T23:59:59.999+07:00`) : undefined,
  });
}

/**
 * EITHER permission, unlike every other action in this file. `completeShipmentAction` requires
 * `deliveries:pod`, and the completion dialog cannot populate its per-line quantities without
 * first loading the shipment through here — gating this on `deliveries:ship` alone left a
 * POD-only actor, the exact role the permission was created for, unable to complete anything.
 */
export async function getShipmentAction(id: string) {
  const session = await auth();
  if (!session?.user?.id || !canReadShipments(session.user.permissions ?? [])) {
    return null;
  }
  return getDeliveryShipment(id);
}

/**
 * The priced lines of a konsi shipment's surat jalan (P37): its transfer's lines with the konsi
 * price snapshotted at creation — what the store receives minus what came back. Read by the
 * order page's per-shipment print; office-only (the SPG phone and the store portal never receive
 * these prices, P18a). Null when the shipment has no transfer (a shipment of the old rule).
 */
export async function muatSuratJalanKonsiAction(shipmentId: string): Promise<{
  lines: Array<{ orderLineId: string | null; productName: string; variantSku: string; qty: number; unitPrice: number | null }>;
} | null> {
  const session = await auth();
  const permissions = session?.user?.permissions ?? [];
  if (!session?.user?.id) return null;
  if (!canReadShipments(permissions) && !hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) return null;
  if (typeof shipmentId !== "string" || shipmentId === "") return null;
  const transfer = await prisma.konsiTransfer.findUnique({
    where: { shipmentId },
    select: { lines: { select: { orderLineId: true, productName: true, variantSku: true, qty: true, returnedQty: true, unitPrice: true } } },
  });
  if (!transfer) return null;
  return {
    lines: transfer.lines
      .map((l) => ({
        orderLineId: l.orderLineId,
        productName: l.productName,
        variantSku: l.variantSku,
        qty: Math.round(Number(l.qty)) - l.returnedQty,
        unitPrice: l.unitPrice === null ? null : Number(l.unitPrice),
      }))
      .filter((l) => l.qty > 0),
  };
}
