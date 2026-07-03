import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, Prisma } from "@elorae/db";

// Guard: refuse to run against prod tunnel (port 3307) or api.elorae.cloud
const DB_URL = process.env.DATABASE_URL ?? "";
if (DB_URL.includes(":3307") || DB_URL.includes("api.elorae.cloud")) {
  throw new Error(
    "REFUSING: this integration test writes rows to Store/StoreVisit/User. " +
    "DATABASE_URL points at prod tunnel :3307 or api.elorae.cloud. " +
    "Run against the local docker testbed :3308 only.",
  );
}

// Mock auth() to return a stable test user session
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "TEST_USER_ID", email: "test@example.com", permissions: ["pwa:access"] },
  })),
}));

// Mock next/navigation redirect so it throws a recognizable error we can catch
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    redirect: (url: string) => { throw new Error(`__REDIRECT__:${url}`); },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { checkIn, checkOut } from "./actions";

const TEST_USER_ID = "TEST_USER_ID";

async function ensureTestUser() {
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: {
      id: TEST_USER_ID,
      email: "test@example.com",
      passwordHash: "x",
      name: "Test User",
    },
  });
}

async function makeStore(code: string, opts: { active?: boolean } = {}) {
  return prisma.store.create({
    data: {
      code,
      name: `Store ${code}`,
      address: "Jl. Test",
      termsType: "PUTUS",
      paymentTempo: 0,
      isActive: opts.active ?? true,
    },
  });
}

async function cleanupTestData() {
  await prisma.storeVisit.deleteMany({ where: { userId: TEST_USER_ID } });
  await prisma.store.deleteMany({ where: { code: { startsWith: "TEST-" } } });
}

describe("checkIn / checkOut server actions", () => {
  beforeEach(async () => {
    await ensureTestUser();
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it("checkIn creates a fresh active visit when no prior active", async () => {
    const store = await makeStore("TEST-A");
    await expect(checkIn({ storeId: store.id, lat: 1.2, lng: 3.4 }))
      .rejects.toThrow("__REDIRECT__:/pwa");
    const visits = await prisma.storeVisit.findMany({ where: { userId: TEST_USER_ID } });
    expect(visits.length).toBe(1);
    expect(visits[0].storeId).toBe(store.id);
    expect(visits[0].checkoutAt).toBeNull();
    expect(visits[0].checkinLat.toNumber()).toBe(1.2);
  });

  it("checkIn auto-closes prior active visit at another store", async () => {
    const storeA = await makeStore("TEST-A");
    const storeB = await makeStore("TEST-B");
    await expect(checkIn({ storeId: storeA.id, lat: 1.0, lng: 2.0 }))
      .rejects.toThrow("__REDIRECT__:/pwa");
    await expect(checkIn({ storeId: storeB.id, lat: 3.0, lng: 4.0 }))
      .rejects.toThrow("__REDIRECT__:/pwa");

    const visits = await prisma.storeVisit.findMany({ where: { userId: TEST_USER_ID }, orderBy: { checkinAt: "asc" } });
    expect(visits.length).toBe(2);
    expect(visits[0].storeId).toBe(storeA.id);
    expect(visits[0].checkoutAt).not.toBeNull();
    expect(visits[0].autoClosed).toBe(true);
    expect(visits[0].checkoutLat).toBeNull();
    expect(visits[1].storeId).toBe(storeB.id);
    expect(visits[1].checkoutAt).toBeNull();
  });

  it("checkIn at the same store is a no-op", async () => {
    const store = await makeStore("TEST-A");
    await expect(checkIn({ storeId: store.id, lat: 1, lng: 2 })).rejects.toThrow("__REDIRECT__");
    await expect(checkIn({ storeId: store.id, lat: 5, lng: 6 })).rejects.toThrow("__REDIRECT__");

    const visits = await prisma.storeVisit.findMany({ where: { userId: TEST_USER_ID } });
    expect(visits.length).toBe(1);
    expect(visits[0].checkoutAt).toBeNull();
  });

  it("checkIn returns NOT_FOUND for deactivated store", async () => {
    const store = await makeStore("TEST-A", { active: false });
    await expect(checkIn({ storeId: store.id, lat: 1, lng: 2 })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("checkIn zod rejects out-of-range lat", async () => {
    const store = await makeStore("TEST-A");
    await expect(checkIn({ storeId: store.id, lat: 91, lng: 0 })).rejects.toThrow();
    const visits = await prisma.storeVisit.findMany({ where: { userId: TEST_USER_ID } });
    expect(visits.length).toBe(0);
  });

  it("checkOut sets checkoutAt + coords", async () => {
    const store = await makeStore("TEST-A");
    await expect(checkIn({ storeId: store.id, lat: 1, lng: 2 })).rejects.toThrow("__REDIRECT__");
    const [visit] = await prisma.storeVisit.findMany({ where: { userId: TEST_USER_ID } });

    const result = await checkOut({ visitId: visit.id, lat: 10, lng: 20 });
    expect(result).toEqual({ alreadyClosed: false, storeId: store.id });

    const closed = await prisma.storeVisit.findUnique({ where: { id: visit.id } });
    expect(closed?.checkoutAt).not.toBeNull();
    expect(closed?.checkoutLat?.toNumber()).toBe(10);
    expect(closed?.checkoutLng?.toNumber()).toBe(20);
  });

  it("checkOut returns alreadyClosed on already-closed visit", async () => {
    const store = await makeStore("TEST-A");
    await expect(checkIn({ storeId: store.id, lat: 1, lng: 2 })).rejects.toThrow("__REDIRECT__");
    const [visit] = await prisma.storeVisit.findMany({ where: { userId: TEST_USER_ID } });
    await checkOut({ visitId: visit.id, lat: 10, lng: 20 });

    const second = await checkOut({ visitId: visit.id, lat: 45, lng: 99 });
    expect("ok" in second && second.ok === false).toBe(false);
    expect((second as { alreadyClosed: boolean }).alreadyClosed).toBe(true);

    const row = await prisma.storeVisit.findUnique({ where: { id: visit.id } });
    // Second call must not overwrite coords.
    expect(row?.checkoutLat?.toNumber()).toBe(10);
  });

  it("checkOut returns FORBIDDEN for another user's visit", async () => {
    const otherUser = await prisma.user.create({
      data: { email: "other@example.com", passwordHash: "x", name: "Other" },
    });
    const store = await makeStore("TEST-A");
    const visit = await prisma.storeVisit.create({
      data: {
        storeId: store.id,
        userId: otherUser.id,
        checkinLat: new Prisma.Decimal(1),
        checkinLng: new Prisma.Decimal(2),
      },
    });

    await expect(checkOut({ visitId: visit.id, lat: 5, lng: 6 })).resolves.toEqual({ ok: false, code: "FORBIDDEN" });

    // Cleanup extra user
    await prisma.storeVisit.deleteMany({ where: { userId: otherUser.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });
});
