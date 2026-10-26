import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

// Guard: refuse to run against prod tunnel (port 3307) or api.elorae.cloud
const DB_URL = process.env.DATABASE_URL ?? "";
if (DB_URL.includes(":3307") || DB_URL.includes("api.elorae.cloud")) {
  throw new Error(
    "REFUSING: this integration test writes rows to Store/Item/ItemCategory. " +
    "DATABASE_URL points at prod tunnel :3307 or api.elorae.cloud. " +
    "Run against the local docker testbed :3308 only.",
  );
}

// Mock auth() to return a session for the seeded salesman — the build step resolves the
// salesman's visit from session.user.id.
const session = vi.hoisted(() => ({ userId: "TEST_USER_ID" }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: session.userId, email: "test@example.com", permissions: [] },
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { buildSmartRequestAction, submitSmartRequestOrder } from "./actions";

const PACK_RATIO_KEY = "putus.packRatio";

/*
 * `putus.packRatio` is a SHARED singleton read by every real smart-request in the dev DB — NOT a
 * tag-scoped fixture. This spec must not write to it: a Ctrl-C between a snapshot and its
 * restore would leave it stuck on a test value and silently mis-plan every real smart-request
 * afterward (this exact class of bug already corrupted real rows on :3308 once, via
 * JournalAccountMapping — see the hookTimeout comment in vitest.config.ts). It also must not
 * conjure one into existence as a fallback on a bed that deliberately has none — a crash before
 * teardown would leave behind a ratio nobody configured, the same problem, just quieter.
 *
 * So: read-only, and if there is none, SKIP the whole suite — same shape as the isProd guard
 * used across this repo's specs (`const d = isProd ? describe.skip : describe`) — rather than
 * fail the run or create one. The reason and the fix are folded into the describe title itself
 * so they survive in every reporter's output, not just a console line that scrolls past.
 */
const packRatioSetting = await prisma.systemSetting.findUnique({ where: { key: PACK_RATIO_KEY }, select: { value: true } });
const packRatio: Array<{ size: string; qty: number }> = packRatioSetting ? JSON.parse(packRatioSetting.value) : [];
const hasPackRatio = packRatio.length > 0;
const d = hasPackRatio ? describe : describe.skip;
const suiteName = hasPackRatio
  ? "buildSmartRequestAction (test bed only)"
  : "buildSmartRequestAction (test bed only) — SKIPPED: no putus.packRatio configured on this DB; " +
    "configure one at Settings → Pack Ratio on the test bed, then re-run, to cover this";

d(suiteName, () => {
  const tag = `SMARTREQ-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = ""; let itemId = ""; let categoryId = ""; let storeId = ""; let plainStoreId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; categoryId = ""; storeId = ""; plainStoreId = "";

    const salesman = await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } });
    session.userId = salesman.id;

    const category = await prisma.itemCategory.create({ data: { name: `Cat ${tag}` } });
    categoryId = category.id;

    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    // One variant per size the real ratio names, with stock that exactly satisfies that size's
    // required qty — sufficient for expandPack to place one pack of this single candidate item.
    const variants = packRatio.map((row, i) => ({ sku: `${tag}-V${i}`, size: row.size }));
    const item = await prisma.item.create({
      data: {
        sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true,
        sellingPrice: 5000, categoryId, variants,
      },
    });
    itemId = item.id;
    await prisma.inventoryValue.createMany({
      data: variants.map((v, i) => ({ itemId, variantSku: v.sku, qtyOnHand: packRatio[i].qty, reservedQty: 0 })),
    });

    const store = await prisma.store.create({
      data: { code: `${tag}-DISC`, name: "Toko Smart Request Diskon", address: "Jl. Test", termsType: "PUTUS", priceDiscountPercent: 10, isActive: true },
    });
    storeId = store.id;

    const plainStore = await prisma.store.create({
      data: { code: `${tag}-PLAIN`, name: "Toko Smart Request Biasa", address: "Jl. Test", termsType: "PUTUS", isActive: true },
    });
    plainStoreId = plainStore.id;

    for (const id of [storeId, plainStoreId]) {
      await prisma.storeVisit.create({ data: { storeId: id, userId: salesman.id, checkinLat: 0, checkinLng: 0 } });
    }
  });

  afterEach(async () => {
    await prisma.storeVisit.deleteMany({ where: { storeId: { in: [storeId, plainStoreId].map(seededId) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(categoryId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: [storeId, plainStoreId].map(seededId) } } });
  });

  it("prices the smart-request preview line off the store's priceDiscountPercent", async () => {
    const res = await buildSmartRequestAction({ storeId, categories: [{ categoryId, packs: 1 }] });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const line = res.lines.find((l) => l.itemId === itemId);
    expect(line).toBeDefined();
    expect(line!.unitPrice).toBe(4500); // 5000 * (1 - 10/100)
  });

  it("prices at list for a store with no discount", async () => {
    const res = await buildSmartRequestAction({ storeId: plainStoreId, categories: [{ categoryId, packs: 1 }] });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const line = res.lines.find((l) => l.itemId === itemId);
    expect(line).toBeDefined();
    expect(line!.unitPrice).toBe(5000);
  });
});

/*
 * The refusal guards sit ahead of the pack-ratio read, so they need no ratio, item or stock — only
 * stores and visits. Their own suite, gated on the prod guard alone, so a bed with no pack ratio
 * (CI's seeded database) still runs them.
 */
const isProd = DB_URL.includes(":3307") || DB_URL.includes("api.elorae.cloud");
const g = isProd ? describe.skip : describe;

g("smart-request guards (test bed only)", () => {
  const tag = `SMARTGUARD-${Math.random().toString(36).slice(2, 10)}`;
  const categoryId = "guard-category-not-read";
  let noVisitStoreId = ""; let konsiStoreId = ""; let foreignVisitId = "";

  beforeEach(async () => {
    noVisitStoreId = ""; konsiStoreId = ""; foreignVisitId = "";

    const salesman = await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } });
    session.userId = salesman.id;

    const noVisitStore = await prisma.store.create({
      data: { code: `${tag}-NOVIS`, name: "Toko Tanpa Kunjungan", address: "Jl. Test", termsType: "PUTUS", isActive: true },
    });
    noVisitStoreId = noVisitStore.id;

    const konsiStore = await prisma.store.create({
      data: { code: `${tag}-KONSI`, name: "Toko Konsi", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    konsiStoreId = konsiStore.id;

    await prisma.storeVisit.create({ data: { storeId: konsiStoreId, userId: salesman.id, checkinLat: 0, checkinLng: 0 } });
  });

  afterEach(async () => {
    await prisma.storeVisit.deleteMany({ where: { storeId: { in: [noVisitStoreId, konsiStoreId].map(seededId) } } });
    await prisma.store.deleteMany({ where: { id: { in: [noVisitStoreId, konsiStoreId].map(seededId) } } });
  });

  it("fails fast with NO_ACTIVE_VISIT when the salesman has no open visit at the store", async () => {
    const res = await buildSmartRequestAction({ storeId: noVisitStoreId, categories: [{ categoryId, packs: 1 }] });
    expect(res).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
  });

  it("fails with NO_ACTIVE_VISIT for a visit that belongs to another user", async () => {
    const other = await prisma.user.findFirstOrThrow({ where: { email: { not: "salesman@elorae.com" } } });
    const foreign = await prisma.storeVisit.create({ data: { storeId: noVisitStoreId, userId: other.id, checkinLat: 0, checkinLng: 0 } });
    foreignVisitId = foreign.id;
    const res = await buildSmartRequestAction({ storeId: noVisitStoreId, visitId: foreignVisitId, categories: [{ categoryId, packs: 1 }] });
    expect(res).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
  });

  it("rejects a KONSI store on build, even with an open visit", async () => {
    const res = await buildSmartRequestAction({ storeId: konsiStoreId, categories: [{ categoryId, packs: 1 }] });
    expect(res).toEqual({ ok: false, code: "KONSI_NOT_SUPPORTED" });
  });

  it("rejects a KONSI store on submit before touching the order writer", async () => {
    const res = await submitSmartRequestOrder({
      storeId: konsiStoreId,
      lines: [{ itemId: "guard-item-not-read", variantSku: "", productName: "T", qty: 1, unitPrice: 5000 }],
    });
    expect(res).toEqual({ ok: false, code: "KONSI_NOT_SUPPORTED" });
  });
});
