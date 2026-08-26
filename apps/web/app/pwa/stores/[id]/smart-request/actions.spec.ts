import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

// Guard: refuse to run against prod tunnel (port 3307) or api.elorae.cloud
const DB_URL = process.env.DATABASE_URL ?? "";
if (DB_URL.includes(":3307") || DB_URL.includes("api.elorae.cloud")) {
  throw new Error(
    "REFUSING: this integration test writes rows to Store/Item/ItemCategory and the shared " +
    "SystemSetting['putus.packRatio'] row. DATABASE_URL points at prod tunnel :3307 or " +
    "api.elorae.cloud. Run against the local docker testbed :3308 only.",
  );
}

// Mock auth() to return a stable test session — buildSmartRequestAction never reads
// session.user.id itself, it only gates on a session existing.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "TEST_USER_ID", email: "test@example.com", permissions: [] },
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { buildSmartRequestAction } from "./actions";

const PACK_RATIO_KEY = "putus.packRatio";

describe("buildSmartRequestAction (test bed only)", () => {
  const tag = `SMARTREQ-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = ""; let itemId = ""; let categoryId = ""; let storeId = ""; let plainStoreId = "";
  // Snapshot of the pre-existing SHARED putus.packRatio row (or null if none), restored verbatim
  // in afterEach — this key is a singleton read by every real smart-request in the dev DB, not a
  // tag-scoped fixture, so clobbering it without restoring would break dev for everyone else.
  let priorPackRatioValue: string | null = null;

  beforeEach(async () => {
    uomId = ""; itemId = ""; categoryId = ""; storeId = ""; plainStoreId = ""; priorPackRatioValue = null;

    const priorSetting = await prisma.systemSetting.findUnique({ where: { key: PACK_RATIO_KEY }, select: { value: true } });
    priorPackRatioValue = priorSetting?.value ?? null;
    await prisma.systemSetting.upsert({
      where: { key: PACK_RATIO_KEY },
      create: { key: PACK_RATIO_KEY, value: JSON.stringify([{ size: "S", qty: 1 }]) },
      update: { value: JSON.stringify([{ size: "S", qty: 1 }]) },
    });

    const category = await prisma.itemCategory.create({ data: { name: `Cat ${tag}` } });
    categoryId = category.id;

    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: {
        sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true,
        sellingPrice: 5000, categoryId, variants: [{ sku: `${tag}-S`, size: "S" }],
      },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: `${tag}-S`, qtyOnHand: 10, reservedQty: 0 } });

    const store = await prisma.store.create({
      data: { code: `${tag}-DISC`, name: "Toko Smart Request Diskon", address: "Jl. Test", termsType: "PUTUS", priceDiscountPercent: 10, isActive: true },
    });
    storeId = store.id;

    const plainStore = await prisma.store.create({
      data: { code: `${tag}-PLAIN`, name: "Toko Smart Request Biasa", address: "Jl. Test", termsType: "PUTUS", isActive: true },
    });
    plainStoreId = plainStore.id;
  });

  afterEach(async () => {
    if (priorPackRatioValue === null) {
      await prisma.systemSetting.deleteMany({ where: { key: PACK_RATIO_KEY } });
    } else {
      await prisma.systemSetting.update({ where: { key: PACK_RATIO_KEY }, data: { value: priorPackRatioValue } });
    }
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(categoryId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(plainStoreId)] } } });
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
