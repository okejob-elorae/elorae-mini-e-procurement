import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { fetchActivePromosForStore } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("fetchActivePromosForStore (test bed only)", () => {
  const sku = `TEST-PROMO-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let otherStoreId = "";
  const promoIds: string[] = [];

  beforeEach(async () => {
    promoIds.length = 0;
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 } });
    itemId = item.id;
    const store = await prisma.store.create({ data: { code: `S-${sku}`, name: "T", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = store.id;
    const other = await prisma.store.create({ data: { code: `S2-${sku}`, name: "T2", address: "T", termsType: "PUTUS", isActive: true } });
    otherStoreId = other.id;
  });

  afterEach(async () => {
    await prisma.promo.deleteMany({ where: { id: { in: promoIds } } });
    await prisma.store.deleteMany({ where: { id: { in: [storeId, otherStoreId] } } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  it("returns active putus store-eligible promos as PromoInput; excludes inactive/out-of-window/other-store", async () => {
    const now = new Date("2026-07-05T00:00:00Z");
    const past = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-12-31T00:00:00Z");

    const active = await prisma.promo.create({
      data: {
        name: "Active All-Stores Putus",
        type: "TIERED",
        level: "LINE",
        termsType: "PUTUS",
        allStores: true,
        startsAt: past,
        endsAt: future,
        isActive: true,
        priority: 1,
        items: { create: [{ itemId }] },
        tiers: { create: [{ minQty: 6, unitPrice: 30000 }] },
      },
    });
    promoIds.push(active.id);

    const inactive = await prisma.promo.create({
      data: {
        name: "Inactive Promo",
        type: "PERCENT",
        level: "LINE",
        termsType: "PUTUS",
        value: 10,
        allStores: true,
        startsAt: past,
        endsAt: future,
        isActive: false,
        items: { create: [{ itemId }] },
      },
    });
    promoIds.push(inactive.id);

    const expired = await prisma.promo.create({
      data: {
        name: "Expired Promo",
        type: "PERCENT",
        level: "LINE",
        termsType: "PUTUS",
        value: 10,
        allStores: true,
        startsAt: past,
        endsAt: new Date("2026-01-31T00:00:00Z"),
        isActive: true,
        items: { create: [{ itemId }] },
      },
    });
    promoIds.push(expired.id);

    const otherStorePromo = await prisma.promo.create({
      data: {
        name: "Other Store Promo",
        type: "PERCENT",
        level: "LINE",
        termsType: "PUTUS",
        value: 10,
        allStores: false,
        startsAt: past,
        endsAt: future,
        isActive: true,
        items: { create: [{ itemId }] },
        stores: { create: [{ storeId: otherStoreId }] },
      },
    });
    promoIds.push(otherStorePromo.id);

    const result = await fetchActivePromosForStore(storeId, now);
    const ids = result.map((p) => p.id);

    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
    expect(ids).not.toContain(expired.id);
    expect(ids).not.toContain(otherStorePromo.id);

    const mapped = result.find((p) => p.id === active.id)!;
    expect(mapped.type).toBe("TIERED");
    expect(mapped.level).toBe("LINE");
    expect(mapped.value).toBeNull();
    expect(mapped.itemIds).toEqual([itemId]);
    expect(mapped.tiers).toEqual([{ minQty: 6, unitPrice: 30000 }]);
    expect(typeof mapped.tiers[0].unitPrice).toBe("number");
  });
});
