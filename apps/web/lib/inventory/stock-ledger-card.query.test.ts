import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getItemMovementCard } from "./stock-ledger-card";

/* Read-only, but the fixtures write real rows — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getItemMovementCard", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let goneStoreId = "";
  let mainEntry1Id = "";
  let mainEntry2Id = "";
  let storeEntryId = "";
  let goneStoreEntryId = "";

  const T1 = new Date("2026-01-01T00:00:00.000Z");
  const T2 = new Date("2026-01-02T00:00:00.000Z");
  const T3 = new Date("2026-01-03T00:00:00.000Z");
  const T4 = new Date("2026-01-04T00:00:00.000Z");

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    goneStoreId = "";
    mainEntry1Id = "";
    mainEntry2Id = "";
    storeEntryId = "";
    goneStoreEntryId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-SLC-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-SLC-ITEM-${token}`, nameId: "Item Ledger", nameEn: "Item Ledger", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-SLC-STORE-${token}`, name: "Toko Ledger", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    storeId = store.id;

    /* Minted then deleted right away, to get a genuine cuid that used to resolve — the
       "deleted store" case this test exists to cover. */
    const gone = await prisma.store.create({
      data: { code: `TEST-SLC-GONE-${token}`, name: "Toko Hilang", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    goneStoreId = gone.id;
    await prisma.store.delete({ where: { id: goneStoreId } });

    const mainEntry1 = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "MAIN",
        locationId: "",
        itemId,
        variantSku: "",
        type: "IN",
        qty: 100,
        balanceQty: 100,
        refType: "GRN",
        refId: `TEST-SLC-GRN-${token}`,
        refDocNumber: `GRN/${token}`,
        createdAt: T1,
      },
    });
    mainEntry1Id = mainEntry1.id;

    const mainEntry2 = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "MAIN",
        locationId: "",
        itemId,
        variantSku: "",
        type: "ADJUSTMENT",
        qty: -20,
        balanceQty: 80,
        refType: "StockAdjustment",
        refId: `TEST-SLC-ADJ-${token}`,
        refDocNumber: `ADJ/${token}`,
        createdAt: T2,
      },
    });
    mainEntry2Id = mainEntry2.id;

    const storeEntry = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "STORE",
        locationId: storeId,
        itemId,
        variantSku: "",
        type: "IN",
        qty: 50,
        balanceQty: 50,
        refType: "KonsiTransfer",
        refId: `TEST-SLC-KTF-${token}`,
        refDocNumber: `KONSITRF/${token}`,
        createdAt: T3,
      },
    });
    storeEntryId = storeEntry.id;

    const goneStoreEntry = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "STORE",
        locationId: goneStoreId,
        itemId,
        variantSku: "",
        type: "IN",
        qty: 10,
        balanceQty: 10,
        refType: "KonsiTransfer",
        refId: `TEST-SLC-KTF-GONE-${token}`,
        refDocNumber: `KONSITRF-GONE/${token}`,
        createdAt: T4,
      },
    });
    goneStoreEntryId = goneStoreEntry.id;
  });

  afterEach(async () => {
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        id: {
          in: [
            seededId(mainEntry1Id),
            seededId(mainEntry2Id),
            seededId(storeEntryId),
            seededId(goneStoreEntryId),
          ],
        },
      },
    });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("groups rows into ordered sections, resolving the real store's name", async () => {
    const card = await getItemMovementCard({ itemId });

    expect(card.sections).toHaveLength(3);
    expect(card.sections[0].locationType).toBe("MAIN");
    expect(card.sections[0].entries.map((e) => e.id)).toEqual([mainEntry1Id, mainEntry2Id]);
    expect(card.sections[0].closingBalance).toBe(80);

    const storeSection = card.sections.find((s) => s.locationId === storeId)!;
    expect(storeSection.locationType).toBe("STORE");
    expect(storeSection.locationLabel).toBe("Toko Ledger");
    expect(storeSection.locationResolved).toBe(true);
    expect(storeSection.closingBalance).toBe(50);

    expect(card.hasAnyHistory).toBe(true);
    expect(card.sectionLimit).toBe(500);
  });

  it("renders the deleted store's raw id, unresolved, rather than dropping the section", async () => {
    const card = await getItemMovementCard({ itemId });

    const goneSection = card.sections.find((s) => s.locationId === goneStoreId)!;
    expect(goneSection).toBeDefined();
    expect(goneSection.locationResolved).toBe(false);
    expect(goneSection.locationLabel).toBe(goneStoreId);
  });

  it("keeps hasAnyHistory true for a window with no matching rows, distinct from sections being empty", async () => {
    const card = await getItemMovementCard({
      itemId,
      from: new Date("2030-01-01T00:00:00.000Z"),
      to: new Date("2030-01-02T00:00:00.000Z"),
    });

    expect(card.sections).toEqual([]);
    expect(card.hasAnyHistory).toBe(true);
  });
});
