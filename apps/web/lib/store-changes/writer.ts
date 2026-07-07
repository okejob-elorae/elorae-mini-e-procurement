import { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";

export type ProposedStoreFields = {
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  lat: number | null;
  lng: number | null;
};

export type SubmitResult =
  | { ok: true; requestId: string }
  | { ok: false; code: "NO_ACTIVE_VISIT" | "ALREADY_PENDING" | "NO_CHANGES" };

export type ReviewResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "INVALID_STATE" | "STORE_GONE" };

function decToNum(v: Prisma.Decimal | null): number | null {
  return v === null ? null : v.toNumber();
}
function numToDec(v: number | null): Prisma.Decimal | null {
  return v === null ? null : new Prisma.Decimal(v);
}
function coordEq(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-7;
}

export async function submitStoreChangeRequest(input: {
  storeId: string;
  visitId: string;
  userId: string;
  proposed: ProposedStoreFields;
}): Promise<SubmitResult> {
  return runSerializable(async (tx) => {
    const visit = await tx.storeVisit.findFirst({
      where: { id: input.visitId, storeId: input.storeId, userId: input.userId, checkoutAt: null },
      select: { id: true },
    });
    if (!visit) return { ok: false, code: "NO_ACTIVE_VISIT" };

    const store = await tx.store.findUnique({
      where: { id: input.storeId },
      select: { name: true, address: true, phone: true, contactName: true, lat: true, lng: true },
    });
    if (!store) return { ok: false, code: "NO_ACTIVE_VISIT" };

    const p = input.proposed;
    const unchanged =
      store.name === p.name &&
      store.address === p.address &&
      store.phone === p.phone &&
      store.contactName === p.contactName &&
      coordEq(decToNum(store.lat), p.lat) &&
      coordEq(decToNum(store.lng), p.lng);
    if (unchanged) return { ok: false, code: "NO_CHANGES" };

    const existing = await tx.storeChangeRequest.findFirst({
      where: { storeId: input.storeId, status: "PENDING" },
      select: { id: true },
    });
    if (existing) return { ok: false, code: "ALREADY_PENDING" };

    const created = await tx.storeChangeRequest.create({
      data: {
        storeId: input.storeId,
        visitId: input.visitId,
        requestedById: input.userId,
        status: "PENDING",
        pendingKey: input.storeId,
        name: p.name,
        address: p.address,
        phone: p.phone,
        contactName: p.contactName,
        lat: numToDec(p.lat),
        lng: numToDec(p.lng),
        oldName: store.name,
        oldAddress: store.address,
        oldPhone: store.phone,
        oldContactName: store.contactName,
        oldLat: store.lat,
        oldLng: store.lng,
      },
      select: { id: true, storeId: true },
    });

    await tx.adminNotification.create({
      data: {
        category: "STORE_CHANGE_REQUEST",
        severity: "INFO",
        title: `Store data change for ${store.name} awaiting approval`,
        message: `A salesman proposed changes to store ${store.name}. Review on the store detail page.`,
        metadata: { storeChangeRequestId: created.id, storeId: created.storeId },
      },
    });

    return { ok: true, requestId: created.id };
  });
}

export async function approveStoreChangeRequest(input: {
  requestId: string;
  reviewerId: string;
}): Promise<ReviewResult> {
  return runSerializable(async (tx) => {
    const req = await tx.storeChangeRequest.findUnique({ where: { id: input.requestId } });
    if (!req) return { ok: false, code: "NOT_FOUND" };
    if (req.status !== "PENDING") return { ok: false, code: "INVALID_STATE" };

    const store = await tx.store.findUnique({ where: { id: req.storeId }, select: { id: true } });
    if (!store) return { ok: false, code: "STORE_GONE" };

    // Apply only the fields the salesman actually changed (proposed != submit-time snapshot),
    // so a concurrent admin edit to an untouched field is not silently reverted.
    const data: Prisma.StoreUpdateInput = {};
    if (req.name !== req.oldName) data.name = req.name;
    if (req.address !== req.oldAddress) data.address = req.address;
    if (req.phone !== req.oldPhone) data.phone = req.phone;
    if (req.contactName !== req.oldContactName) data.contactName = req.contactName;
    if (!coordEq(decToNum(req.lat), decToNum(req.oldLat))) data.lat = req.lat;
    if (!coordEq(decToNum(req.lng), decToNum(req.oldLng))) data.lng = req.lng;
    if (Object.keys(data).length > 0) {
      await tx.store.update({ where: { id: req.storeId }, data });
    }
    await tx.storeChangeRequest.update({
      where: { id: req.id },
      data: { status: "APPROVED", reviewedById: input.reviewerId, reviewedAt: new Date(), pendingKey: null },
    });
    return { ok: true };
  });
}

export async function rejectStoreChangeRequest(input: {
  requestId: string;
  reviewerId: string;
  reason: string;
}): Promise<ReviewResult> {
  return runSerializable(async (tx) => {
    const req = await tx.storeChangeRequest.findUnique({ where: { id: input.requestId }, select: { id: true, status: true } });
    if (!req) return { ok: false, code: "NOT_FOUND" };
    if (req.status !== "PENDING") return { ok: false, code: "INVALID_STATE" };

    await tx.storeChangeRequest.update({
      where: { id: req.id },
      data: { status: "REJECTED", reviewedById: input.reviewerId, reviewedAt: new Date(), rejectReason: input.reason, pendingKey: null },
    });
    return { ok: true };
  });
}
