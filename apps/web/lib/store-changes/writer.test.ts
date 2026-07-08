import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { submitStoreChangeRequest, approveStoreChangeRequest, rejectStoreChangeRequest, type ProposedStoreFields } from "./writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("store-change lifecycle writer (test bed only)", () => {
  const tag = `SCR-${Math.random().toString(36).slice(2, 10)}`;
  let storeId = "";
  let userId = "";
  let visitId = "";
  let since = new Date();

  const base: ProposedStoreFields = { name: "New Name", address: "New Addr", phone: "0812", contactName: "Budi", lat: 1.23, lng: 4.56 };

  beforeEach(async () => {
    since = new Date();
    const store = await prisma.store.create({ data: { code: tag, name: "Old Name", address: "Old Addr", phone: null, contactName: null, termsType: "PUTUS", isActive: true } });
    storeId = store.id;
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    userId = user!.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;
  });

  afterEach(async () => {
    await prisma.storeChangeRequest.deleteMany({ where: { storeId } });
    await prisma.storeVisit.deleteMany({ where: { storeId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.adminNotification.deleteMany({ where: { category: "STORE_CHANGE_REQUEST", createdAt: { gte: since } } });
  });

  it("submit creates a PENDING request + admin notification", async () => {
    const res = await submitStoreChangeRequest({ storeId, visitId, userId, proposed: base });
    expect(res.ok).toBe(true);
    const row = await prisma.storeChangeRequest.findFirst({ where: { storeId } });
    expect(row!.status).toBe("PENDING");
    expect(row!.pendingKey).toBe(storeId);
    expect(row!.oldName).toBe("Old Name");
    const notif = await prisma.adminNotification.findFirst({ where: { category: "STORE_CHANGE_REQUEST" } });
    expect(notif).not.toBeNull();
  });

  it("submit with no changes returns NO_CHANGES", async () => {
    const same: ProposedStoreFields = { name: "Old Name", address: "Old Addr", phone: null, contactName: null, lat: null, lng: null };
    const res = await submitStoreChangeRequest({ storeId, visitId, userId, proposed: same });
    expect(res).toEqual({ ok: false, code: "NO_CHANGES" });
  });

  it("submit with a closed/foreign visit returns NO_ACTIVE_VISIT", async () => {
    await prisma.storeVisit.update({ where: { id: visitId }, data: { checkoutAt: new Date() } });
    const res = await submitStoreChangeRequest({ storeId, visitId, userId, proposed: base });
    expect(res).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
  });

  it("second submit while one is pending returns ALREADY_PENDING", async () => {
    await submitStoreChangeRequest({ storeId, visitId, userId, proposed: base });
    const res = await submitStoreChangeRequest({ storeId, visitId, userId, proposed: { ...base, name: "Third Name" } });
    expect(res).toEqual({ ok: false, code: "ALREADY_PENDING" });
  });

  it("approve applies proposed to Store, clears pendingKey, leaves terms untouched", async () => {
    const before = await prisma.store.findUnique({ where: { id: storeId }, select: { termsType: true, marginPercent: true } });
    const sub = await submitStoreChangeRequest({ storeId, visitId, userId, proposed: base });
    const requestId = (sub as { ok: true; requestId: string }).requestId;
    const res = await approveStoreChangeRequest({ requestId, reviewerId: userId });
    expect(res).toEqual({ ok: true });
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    expect(store!.name).toBe("New Name");
    expect(Number(store!.lat)).toBeCloseTo(1.23);
    expect(store!.termsType).toBe(before!.termsType);
    expect(store!.marginPercent).toEqual(before!.marginPercent);
    const row = await prisma.storeChangeRequest.findUnique({ where: { id: requestId } });
    expect(row!.status).toBe("APPROVED");
    expect(row!.pendingKey).toBeNull();
  });

  it("approve applies only salesman-changed fields, preserving concurrent admin edits", async () => {
    const proposed: ProposedStoreFields = { name: "New Name", address: "Old Addr", phone: null, contactName: null, lat: null, lng: null };
    const sub = await submitStoreChangeRequest({ storeId, visitId, userId, proposed });
    const requestId = (sub as { ok: true; requestId: string }).requestId;
    await prisma.store.update({ where: { id: storeId }, data: { phone: "0899-admin" } });
    const res = await approveStoreChangeRequest({ requestId, reviewerId: userId });
    expect(res).toEqual({ ok: true });
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    expect(store!.name).toBe("New Name");
    expect(store!.phone).toBe("0899-admin");
  });

  it("after approve, a new submit is allowed (pendingKey freed)", async () => {
    const sub = await submitStoreChangeRequest({ storeId, visitId, userId, proposed: base });
    await approveStoreChangeRequest({ requestId: (sub as { ok: true; requestId: string }).requestId, reviewerId: userId });
    const res = await submitStoreChangeRequest({ storeId, visitId, userId, proposed: { ...base, name: "Even Newer" } });
    expect(res.ok).toBe(true);
  });

  it("reject leaves Store untouched, stores reason, clears pendingKey", async () => {
    const sub = await submitStoreChangeRequest({ storeId, visitId, userId, proposed: base });
    const requestId = (sub as { ok: true; requestId: string }).requestId;
    const res = await rejectStoreChangeRequest({ requestId, reviewerId: userId, reason: "wrong data" });
    expect(res).toEqual({ ok: true });
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    expect(store!.name).toBe("Old Name");
    const row = await prisma.storeChangeRequest.findUnique({ where: { id: requestId } });
    expect(row!.status).toBe("REJECTED");
    expect(row!.rejectReason).toBe("wrong data");
    expect(row!.pendingKey).toBeNull();
  });

  it("approve of a non-pending request returns INVALID_STATE", async () => {
    const sub = await submitStoreChangeRequest({ storeId, visitId, userId, proposed: base });
    const requestId = (sub as { ok: true; requestId: string }).requestId;
    await approveStoreChangeRequest({ requestId, reviewerId: userId });
    const res = await approveStoreChangeRequest({ requestId, reviewerId: userId });
    expect(res).toEqual({ ok: false, code: "INVALID_STATE" });
  });
});
