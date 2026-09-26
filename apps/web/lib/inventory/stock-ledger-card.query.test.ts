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
  let variantEntryId = "";
  let unregisteredEntryId = "";

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
    variantEntryId = "";
    unregisteredEntryId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-SLC-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-SLC-ITEM-${token}`, nameId: "Item Ledger", nameEn: "Item Ledger", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-SLC-STORE-${token}`, name: "Toko Ledger", address: "Test address", termsType: "KONSI", markupPercent: 20, isActive: true },
    });
    storeId = store.id;

    /* Minted then deleted right away, to get a genuine cuid that used to resolve — the
       "deleted store" case this test exists to cover. */
    const gone = await prisma.store.create({
      data: { code: `TEST-SLC-GONE-${token}`, name: "Toko Hilang", address: "Test address", termsType: "KONSI", markupPercent: 20, isActive: true },
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

    /* Only the RED variant of this item ever moved — variant BLUE has no row at all, under
       any date range. This is the fixture the hasAnyHistory-scoping fix exists for. */
    const variantEntry = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "MAIN",
        locationId: "",
        itemId,
        variantSku: "RED",
        type: "IN",
        qty: 5,
        balanceQty: 5,
        refType: "GRN",
        refId: `TEST-SLC-GRN-RED-${token}`,
        refDocNumber: `GRN-RED/${token}`,
        createdAt: T1,
      },
    });
    variantEntryId = variantEntry.id;

    /*
     * refType "TEST" is not a STOCK_LEDGER_REF_TYPES member — deliberately, matching the
     * kind of row ledger-ref-display.ts's own comment says genuinely exists on this
     * shared bed. Its own variant ("UNREG") keeps it in its own section, so a test can
     * assert its presence/absence without disentangling it from mainEntry1/2.
     */
    const unregisteredEntry = await prisma.stockLedgerEntry.create({
      data: {
        locationType: "MAIN",
        locationId: "",
        itemId,
        variantSku: "UNREG",
        type: "IN",
        qty: 7,
        balanceQty: 7,
        refType: "TEST",
        refId: `TEST-SLC-UNREG-${token}`,
        refDocNumber: `UNREG/${token}`,
        createdAt: T1,
      },
    });
    unregisteredEntryId = unregisteredEntry.id;
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
            seededId(variantEntryId),
            seededId(unregisteredEntryId),
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

    /* 5, not 4 — the UNREG-variant MAIN row (unregistered refType "TEST") is its own
       (locationType, locationId, variantSku) section alongside the "" and RED variant
       MAIN sections and the two STORE sections. Unfiltered means unfiltered: an
       unregistered refType renders like any other row when nothing narrows refType. */
    expect(card.sections).toHaveLength(5);
    expect(card.sections[0].locationType).toBe("MAIN");
    expect(card.sections[0].variantSku).toBe("");
    expect(card.sections[0].entries.map((e) => e.id)).toEqual([mainEntry1Id, mainEntry2Id]);
    expect(card.sections[0].closingBalance).toBe(80);

    const storeSection = card.sections.find((s) => s.locationId === storeId)!;
    expect(storeSection.locationType).toBe("STORE");
    expect(storeSection.locationLabel).toBe("Toko Ledger");
    expect(storeSection.locationResolved).toBe(true);
    expect(storeSection.closingBalance).toBe(50);

    expect(card.hasAnyHistory).toBe(true);
    expect(card.sectionLimit).toBe(500);
    /* Well under QUERY_ENTRY_LIMIT (2000) — confirms the field is wired end to end. The
       equality-based logic itself is pinned cheaply in stock-ledger-card.test.ts instead of
       seeding 2000 rows on the shared bed. */
    expect(card.queryTruncated).toBe(false);
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

  /*
   * The failure this fix exists for: an item with variants RED (has rows) and BLUE (never
   * moved). Picking BLUE with no date range must NOT tell the operator to widen a date
   * range that doesn't exist — hasAnyHistory has to be scoped to the variant filter, not
   * just itemId.
   */
  it("scopes hasAnyHistory to the variant filter — a variant with zero rows reads as no history, not an empty date range", async () => {
    const redCard = await getItemMovementCard({ itemId, variantSku: "RED" });
    expect(redCard.sections).toHaveLength(1);
    expect(redCard.hasAnyHistory).toBe(true);

    const blueCard = await getItemMovementCard({ itemId, variantSku: "BLUE" });
    expect(blueCard.sections).toEqual([]);
    expect(blueCard.hasAnyHistory).toBe(false);
  });

  /*
   * The fix round this block exists for: narrowing the movement-type filter used to make
   * an unregistered-refType row (refType "TEST", genuinely reachable on this column —
   * see RawLedgerRow's own comment) vanish with no signal, because the old filter was
   * built as `refType IN (registered subset)` with no way to opt the unregistered class
   * back in. `includeUnregisteredRefTypes` is that opt-in, and every case below also
   * asserts hasAnyHistory agrees with sections.length === 0 — the two are built from the
   * SAME buildRefTypeCondition call now, so a divergence here would mean that sharing
   * broke, not just that the option itself doesn't work.
   */
  it("includes the unregistered row when its class is selected alongside a registered subset", async () => {
    const card = await getItemMovementCard({
      itemId,
      refTypes: ["GRN"],
      includeUnregisteredRefTypes: true,
    });

    /* GRN (mainEntry1, variantEntry) + the unregistered TEST row — StockAdjustment and
       KonsiTransfer rows are registered but not GRN, so they must NOT appear. */
    const variants = card.sections.filter((s) => s.locationType === "MAIN").map((s) => s.variantSku);
    expect(variants.sort()).toEqual(["", "RED", "UNREG"]);
    expect(card.sections.some((s) => s.locationType === "STORE")).toBe(false);
    expect(card.hasAnyHistory).toBe(true);
  });

  it("excludes the unregistered row when its class is unticked, even with a registered subset selected", async () => {
    const card = await getItemMovementCard({
      itemId,
      refTypes: ["GRN"],
      includeUnregisteredRefTypes: false,
    });

    const variants = card.sections.filter((s) => s.locationType === "MAIN").map((s) => s.variantSku);
    expect(variants.sort()).toEqual(["", "RED"]);
    expect(card.hasAnyHistory).toBe(true);
  });

  it("selects only the unregistered class when no registered member is picked", async () => {
    const card = await getItemMovementCard({
      itemId,
      refTypes: [],
      includeUnregisteredRefTypes: true,
    });

    expect(card.sections).toHaveLength(1);
    expect(card.sections[0].variantSku).toBe("UNREG");
    expect(card.hasAnyHistory).toBe(true);
  });

  it("agrees between sections and hasAnyHistory when a registered filter matches nothing at all", async () => {
    /* FGReceipt has zero rows anywhere in this fixture. If historyWhere ever drifted from
       `where` (e.g. by rebuilding the condition instead of reusing the same value), this
       would read hasAnyHistory: true off the itemId/variant predicates alone. */
    const card = await getItemMovementCard({
      itemId,
      refTypes: ["FGReceipt"],
      includeUnregisteredRefTypes: false,
    });

    expect(card.sections).toEqual([]);
    expect(card.hasAnyHistory).toBe(false);
  });

  /*
   * The refType half of this predicate sharing had exactly this pair of tests; the
   * locationType half did not, which is how the two arms of buildLocationTypeCondition's
   * sibling disagreed once already on this branch. Deleting either `Object.assign(...,
   * locationTypeCondition)` call in getItemMovementCard should fail one of these two:
   * dropping the `where` one changes which sections come back (the first assertion
   * below), dropping the `historyWhere` one leaves hasAnyHistory reading the unfiltered
   * itemId/variant predicates alone (the second assertion, which is the one that proves
   * the two `where`s share the condition rather than each carrying their own copy).
   */
  it("narrows sections to MAIN when locationTypes excludes STORE, and hasAnyHistory stays true", async () => {
    const card = await getItemMovementCard({ itemId, locationTypes: ["MAIN"] });

    expect(card.sections.every((s) => s.locationType === "MAIN")).toBe(true);
    expect(card.sections.some((s) => s.locationType === "STORE")).toBe(false);
    expect(card.hasAnyHistory).toBe(true);
  });

  it("agrees between sections and hasAnyHistory when locationTypes matches nothing at all", async () => {
    /* The fixture has MAIN and STORE rows and no VAN row at all — a locationType-only
       count on `{ itemId }` would read hasAnyHistory: true regardless of this filter. */
    const card = await getItemMovementCard({ itemId, locationTypes: ["VAN"] });

    expect(card.sections).toEqual([]);
    expect(card.hasAnyHistory).toBe(false);
  });
});
