import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getFieldReturnById, getInTransitAdminReturnQty, listFieldReturns, previewKonsiReturStockImpact } from "./queries";
import { createFieldReturn } from "./writer";
import { receiveFieldReturn } from "./receive-writer";

/**
 * DB-touching: the fixture writes real Item/Store/FieldSalesOrder/FieldSalesDelivery(Line)/
 * FieldReturn(Line) rows directly, bypassing the field-sales and field-retur writers (both out
 * of scope here). Never run against the shared prod DB (port 3307 tunnel / VPS host).
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Reads `FIELD_RETURN_MISMATCH` rows scoped to a set of returns, matched in JS on
 * `metadata.returnId` — this MariaDB adapter's JSON-path filtering is unreliable, and this spec
 * shares the dev DB with real notification rows, so a global count would prove nothing. Same
 * approach as `receive-writer.test.ts`'s `mismatchNotificationsFor`, generalised to a list of
 * return ids. Used by the `getInTransitAdminReturnQty` block below, whose mismatch fixture
 * writes one of these on every run.
 */
async function mismatchNotificationsFor(returnIds: string[]) {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "FIELD_RETURN_MISMATCH" },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return recent.filter((n) => returnIds.includes((n.metadata as { returnId?: string } | null)?.returnId ?? ""));
}

d("getFieldReturnById — pricing fields (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let deliveryId = "";
  let deliveryLineId = "";
  let returnId = "";
  let lineId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    userId = "";
    orderId = "";
    deliveryId = "";
    deliveryLineId = "";
    returnId = "";
    lineId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRQ-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: {
        sku: `TEST-FRQ-${token}`,
        nameId: "Retur query item",
        nameEn: "Retur query item",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        sellingPrice: 40000,
      },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FRQ-STORE-${token}`, name: "Test Query Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({ data: { email: `test-frq-${token}@example.com`, name: "Test Query User" } });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FRQ-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 1_000_000,
        total: 1_000_000,
        lines: {
          create: [{ itemId, variantSku: "M", productName: "Test Item M", qty: 5, unitPrice: 200_000, lineTotal: 1_000_000 }],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    const orderLine = order.lines[0];

    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-FRQ-DLV-${token}`,
        orderId,
        deliveredAt: new Date("2026-08-01T00:00:00.000Z"),
        deliveredById: userId,
        invoiceDate: new Date("2026-08-01T00:00:00.000Z"),
        dueDate: new Date("2026-08-08T00:00:00.000Z"),
        subtotal: 1_000_000,
        total: 1_000_000,
        lines: {
          create: [
            { orderLineId: orderLine.id, itemId, variantSku: "M", productName: "Test Item M", qty: 5, unitPrice: 200_000, lineTotal: 1_000_000 },
          ],
        },
      },
      include: { lines: true },
    });
    deliveryId = delivery.id;
    deliveryLineId = delivery.lines[0].id;

    const ret = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-FRQ-RET-${token}`,
        storeId,
        raisedById: userId,
        status: "PENDING_APPROVAL",
        transport: "SELF_CARRY",
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
      },
    });
    returnId = ret.id;

    const line = await prisma.fieldReturnLine.create({
      data: { returnId, itemId, variantSku: "M", qty: 2, reason: "UNSOLD" },
    });
    lineId = line.id;
  });

  afterEach(async () => {
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returnId) } });
    await prisma.fieldReturn.deleteMany({ where: { id: seededId(returnId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: seededId(deliveryId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("resolves priceState AUTO and attaches priceCandidates for a not-yet-approved line, for a canManage viewer", async () => {
    const detail = await getFieldReturnById(returnId, { canManage: true });
    expect(detail).not.toBeNull();
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(line.priceState).toBe("AUTO");
    expect(line.priceCandidates).toHaveLength(1);
    expect(line.priceCandidates![0].deliveryLineId).toBe(deliveryLineId);
  });

  /*
   * A viewer without field_returns:manage can never see LinePriceControls, so resolving
   * candidates for them is pure waste — and, since priceState falls back to computing itself
   * from those candidates, it also means priceState is NOT a reliable read of "would this
   * auto-resolve" for such a viewer. This pins the gate itself: same open, genuinely AUTO line
   * as the test above, but with no canManage (and with `opts` omitted entirely, the real
   * default every existing non-manage caller gets).
   */
  it("omits priceCandidates for a viewer without canManage, even on an open, priceable line", async () => {
    const detail = await getFieldReturnById(returnId);
    expect(detail).not.toBeNull();
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(line.priceCandidates).toBeUndefined();
  });

  it("reports priceState SET once an admin has chosen a price, not re-derived from candidates", async () => {
    await prisma.fieldReturnLine.update({
      where: { id: lineId },
      data: { priceSource: "MANUAL", unitPrice: 5000, priceNote: "manual price" },
    });
    const detail = await getFieldReturnById(returnId, { canManage: true });
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(line.priceState).toBe("SET");
    expect(line.priceSource).toBe("MANUAL");
    expect(line.unitPrice).toBe(5000);
    expect(line.priceNote).toBe("manual price");
  });

  it("resolves priceDeliveryDocNo for a line priced from a real delivery", async () => {
    await prisma.fieldReturnLine.update({
      where: { id: lineId },
      data: { priceSource: "DELIVERY", priceDeliveryLineId: deliveryLineId },
    });
    const detail = await getFieldReturnById(returnId, { canManage: true });
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(line.priceDeliveryDocNo).toBe(`TEST-FRQ-DLV-${token}`);
  });

  it("renders a line whose provenance delivery line no longer exists", async () => {
    /*
     * priceDeliveryLineId carries no foreign key (relationMode = "prisma"), so the delivery it
     * names can be deleted out from under an approved retur. Provenance must degrade to "not
     * shown", never to a thrown detail page — the same fail-open rule the tax-invoice queue uses
     * for its own orphans.
     */
    await prisma.fieldReturnLine.update({
      where: { id: lineId },
      data: { priceSource: "DELIVERY", priceDeliveryLineId: "does-not-exist-anywhere" },
    });
    const detail = await getFieldReturnById(returnId, { canManage: true });
    expect(detail).not.toBeNull();
    expect(detail?.lines[0].priceDeliveryDocNo).toBeNull();
  });

  it("coerces Decimal money fields to numbers and exposes header totalValue/valuationStatus", async () => {
    await prisma.fieldReturn.update({
      where: { id: returnId },
      data: { totalValue: 10000, valuationStatus: "VALUED" },
    });
    await prisma.fieldReturnLine.update({
      where: { id: lineId },
      data: { creditedQty: 2, unitPrice: 5000, lineValue: 10000 },
    });
    const detail = await getFieldReturnById(returnId);
    expect(typeof detail!.totalValue).toBe("number");
    expect(detail!.totalValue).toBe(10000);
    expect(detail!.valuationStatus).toBe("VALUED");
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(typeof line.unitPrice).toBe("number");
    expect(line.unitPrice).toBe(5000);
    expect(typeof line.lineValue).toBe("number");
    expect(line.lineValue).toBe(10000);
    expect(line.creditedQty).toBe(2);
  });

  it("omits priceCandidates once the retur is APPROVED, even for a canManage viewer where real candidates exist", async () => {
    /*
     * The item/variant on this line genuinely has a delivery candidate (deliveryLineId) — an
     * implementation that forgot to gate on approval status would attach it here too, so this
     * assertion is falsifiable rather than vacuously true. canManage: true here proves this is
     * the STATUS gate at work, not just the canManage gate the test above already pins.
     */
    await prisma.fieldReturn.update({ where: { id: returnId }, data: { status: "APPROVED" } });
    const detail = await getFieldReturnById(returnId, { canManage: true });
    const line = detail!.lines.find((l) => l.id === lineId)!;
    expect(line.priceCandidates).toBeUndefined();
  });
});

d("previewKonsiReturStockImpact (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let konsiStoreId = "";
  let putusStoreId = "";
  let userId = "";

  /* Single StoreStock row (qty 5) shared by every return below — previewKonsiReturStockImpact is
     read-only, so seeding it once in beforeEach and reading it from several independent returns
     within the same test run is safe; nothing here ever mutates it. */
  let sufficientReturnId = "";
  let shortReturnId = "";
  let shortLineId = "";
  let putusReturnId = "";
  let dualLineReturnId = "";
  let dualLineFirstId = "";
  let dualLineSecondId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    konsiStoreId = "";
    putusStoreId = "";
    userId = "";
    sufficientReturnId = "";
    shortReturnId = "";
    shortLineId = "";
    putusReturnId = "";
    dualLineReturnId = "";
    dualLineFirstId = "";
    dualLineSecondId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KRP-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-KRP-${token}`, nameId: "Konsi retur preview item", nameEn: "Konsi retur preview item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;

    const konsiStore = await prisma.store.create({
      data: { code: `TEST-KRP-KONSI-${token}`, name: "Test Konsi Preview Store", address: "Test address", termsType: "KONSI", isActive: true },
    });
    konsiStoreId = konsiStore.id;

    const putusStore = await prisma.store.create({
      data: { code: `TEST-KRP-PUTUS-${token}`, name: "Test Putus Preview Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    putusStoreId = putusStore.id;

    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId, variantSku: "", qty: 5, avgCost: 10000 } });

    const user = await prisma.user.create({ data: { email: `test-krp-${token}@example.com`, name: "Test Konsi Preview User" } });
    userId = user.id;

    const mkReturn = async (opts: { storeId: string; qty: number }) =>
      createFieldReturn({
        storeId: opts.storeId,
        raisedById: userId,
        transport: "SELF_CARRY",
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
        lines: [{ itemId, variantSku: "", qty: opts.qty, reason: "UNSOLD" }],
      });

    /* Sufficient: claimed == received == 2, store holds 5 -> no impact. */
    const createdSufficient = await mkReturn({ storeId: konsiStoreId, qty: 2 });
    sufficientReturnId = createdSufficient.returnId;
    const lineSufficient = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(sufficientReturnId) } });
    await receiveFieldReturn({
      returnId: sufficientReturnId,
      receivedById: userId,
      counts: [{ lineId: lineSufficient.id, receivedQty: 2, sellableQty: 2, rejectedQty: 0 }],
    });

    /* Short: claimed == received == 8, store holds only 5 -> shortfall 3. */
    const createdShort = await mkReturn({ storeId: konsiStoreId, qty: 8 });
    shortReturnId = createdShort.returnId;
    const lineShort = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(shortReturnId) } });
    shortLineId = lineShort.id;
    await receiveFieldReturn({
      returnId: shortReturnId,
      receivedById: userId,
      counts: [{ lineId: shortLineId, receivedQty: 8, sellableQty: 8, rejectedQty: 0 }],
    });

    /* PUTUS store, same shape as the short KONSI return above — must still report [] regardless
       of the numbers, since approveFieldReturn never touches StoreStock for a PUTUS store. */
    const createdPutus = await mkReturn({ storeId: putusStoreId, qty: 8 });
    putusReturnId = createdPutus.returnId;
    const linePutus = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(putusReturnId) } });
    await receiveFieldReturn({
      returnId: putusReturnId,
      receivedById: userId,
      counts: [{ lineId: linePutus.id, receivedQty: 8, sellableQty: 8, rejectedQty: 0 }],
    });

    /*
     * Two lines on the SAME (itemId, variantSku): createFieldReturn only dedupes itemId for its
     * existence check, never forbids a duplicate (itemId, variantSku) pair across lines. Store
     * holds 5; each line claims == receives 3. The FIRST line alone would not go negative
     * (3 <= 5), but approveFieldReturn's writer reads/writes StoreStock SEQUENTIALLY, so the
     * SECOND line is actually evaluated against what the first already left behind (5 - 3 = 2),
     * not the row's original value — 3 > 2, so only the second line goes negative.
     */
    const createdDualLine = await createFieldReturn({
      storeId: konsiStoreId,
      raisedById: userId,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [
        { itemId, variantSku: "", qty: 3, reason: "UNSOLD" },
        { itemId, variantSku: "", qty: 3, reason: "UNSOLD" },
      ],
    });
    dualLineReturnId = createdDualLine.returnId;
    const dualLines = await prisma.fieldReturnLine.findMany({
      where: { returnId: seededId(dualLineReturnId) },
      orderBy: { id: "asc" },
    });
    dualLineFirstId = dualLines[0].id;
    dualLineSecondId = dualLines[1].id;
    await receiveFieldReturn({
      returnId: dualLineReturnId,
      receivedById: userId,
      counts: [
        { lineId: dualLineFirstId, receivedQty: 3, sellableQty: 3, rejectedQty: 0 },
        { lineId: dualLineSecondId, receivedQty: 3, sellableQty: 3, rejectedQty: 0 },
      ],
    });
  });

  afterEach(async () => {
    const returnIds = [
      seededId(sufficientReturnId),
      seededId(shortReturnId),
      seededId(putusReturnId),
      seededId(dualLineReturnId),
    ];
    const storeIds = [seededId(konsiStoreId), seededId(putusStoreId)];
    await prisma.storeStock.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("returns null for a nonexistent returnId, distinguishable from a real no-impact result", async () => {
    const unseededReturnId = "clnonexistentreturnid00000001";
    const result = await previewKonsiReturStockImpact(unseededReturnId);
    expect(result).toBeNull();
  });

  it("returns [] for a non-KONSI store regardless of the numbers", async () => {
    const result = await previewKonsiReturStockImpact(putusReturnId);
    expect(result).toEqual([]);
  });

  it("returns [] for a KONSI store when the store holds enough stock", async () => {
    const result = await previewKonsiReturStockImpact(sufficientReturnId);
    expect(result).toEqual([]);
  });

  it("reports a line that would drive the row negative, with the correct creditedQty/storeQty/shortfall", async () => {
    const result = await previewKonsiReturStockImpact(shortReturnId);
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({
      lineId: shortLineId,
      variantSku: "",
      creditedQty: 8,
      storeQty: 5,
      shortfall: 3,
    });
  });

  it("evaluates a second line on the same (itemId, variantSku) against what the first line already left behind, not the row's original value", async () => {
    /*
     * Store holds 5; two lines of 3 each, same (itemId, variantSku). Fetching ret.lines does not
     * specify an ORDER BY (neither does the real writer's own select), so which physical row
     * counts as "first" vs "second" is not something this test can assert from the outside — the
     * lineId is deliberately checked only for membership, not identity. What actually
     * distinguishes accumulation from the bug: a naive implementation that evaluates every line
     * against the ORIGINAL row value would find shortfall = 3 - 5 = -2 for BOTH lines and report
     * NOTHING (result === []). Accumulating one running value per key instead means exactly ONE
     * line is evaluated against what the other already left behind (5 - 3 = 2), so 3 > 2 and
     * exactly one line is reported at storeQty 2 / shortfall 1 — impossible to produce without a
     * running per-key quantity.
     */
    const result = await previewKonsiReturStockImpact(dualLineReturnId);
    expect(result).toHaveLength(1);
    expect([dualLineFirstId, dualLineSecondId]).toContain(result![0].lineId);
    expect(result![0]).toMatchObject({
      creditedQty: 3,
      storeQty: 2,
      shortfall: 1,
    });
  });
});

d("getInTransitAdminReturnQty (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let userId = "";
  let storeUnreceivedId = "";
  let storeReceivedId = "";
  let storeMismatchId = "";
  let storeFieldOnlyId = "";
  let storeScopeAId = "";
  let storeScopeBId = "";
  let unreceivedReturnId = "";
  let receivedReturnId = "";
  let mismatchReturnId = "";
  let fieldReturnId = "";
  let scopeAReturnId = "";
  let scopeBReturnId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    userId = "";
    storeUnreceivedId = "";
    storeReceivedId = "";
    storeMismatchId = "";
    storeFieldOnlyId = "";
    storeScopeAId = "";
    storeScopeBId = "";
    unreceivedReturnId = "";
    receivedReturnId = "";
    mismatchReturnId = "";
    fieldReturnId = "";
    scopeAReturnId = "";
    scopeBReturnId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-ITQ-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: {
        sku: `TEST-ITQ-${token}`,
        nameId: "In-transit query item",
        nameEn: "In-transit query item",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        sellingPrice: 40000,
      },
    });
    itemId = item.id;

    const user = await prisma.user.create({ data: { email: `test-itq-${token}@example.com`, name: "Test In-Transit User" } });
    userId = user.id;

    const mkStore = (suffix: string) =>
      prisma.store.create({
        data: {
          code: `TEST-ITQ-${suffix}-${token}`,
          name: `Test In-Transit Store ${suffix} ${token}`,
          address: "Test address",
          termsType: "KONSI",
          isActive: true,
        },
      });

    storeUnreceivedId = (await mkStore("UNRECEIVED")).id;
    storeReceivedId = (await mkStore("RECEIVED")).id;
    storeMismatchId = (await mkStore("MISMATCH")).id;
    storeFieldOnlyId = (await mkStore("FIELDONLY")).id;
    storeScopeAId = (await mkStore("SCOPE-A")).id;
    storeScopeBId = (await mkStore("SCOPE-B")).id;

    /* Left in PENDING_WAREHOUSE_RECEIVING — the one case that must count. */
    const createdUnreceived = await createFieldReturn({
      storeId: storeUnreceivedId,
      raisedById: userId,
      origin: "ADMIN",
      lines: [{ itemId, variantSku: "", qty: 4, reason: "UNSOLD" }],
    });
    unreceivedReturnId = createdUnreceived.returnId;

    /*
     * Raised the same way, then received CLEAN (claimed == received) — lands PENDING_APPROVAL.
     * The receipt-time decrement (`receive-writer.ts`) has already applied, and the return has
     * not reached APPROVED yet, so this must now move from `raisedQty` to `receivedQty` rather
     * than being excluded outright: the units are off the shelf but there is still no
     * `RETUR_OUT` movement row to explain the drop until approval.
     */
    const createdReceived = await createFieldReturn({
      storeId: storeReceivedId,
      raisedById: userId,
      origin: "ADMIN",
      lines: [{ itemId, variantSku: "", qty: 6, reason: "UNSOLD" }],
    });
    receivedReturnId = createdReceived.returnId;
    const receivedLine = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(receivedReturnId) } });
    await receiveFieldReturn({
      returnId: receivedReturnId,
      receivedById: userId,
      counts: [{ lineId: receivedLine.id, receivedQty: 6, sellableQty: 6, rejectedQty: 0 }],
    });

    /*
     * Raised 6, received 4 (shortage), left UNRESOLVED — lands MISMATCH_PENDING_RESOLUTION,
     * which an INVESTIGATE resolution can hold indefinitely. `receivedQty` must count what was
     * actually counted in (4), never the claimed qty (6) — that's the whole point of splitting
     * this from `raisedQty`, which is claimed-qty based.
     */
    const createdMismatch = await createFieldReturn({
      storeId: storeMismatchId,
      raisedById: userId,
      origin: "ADMIN",
      lines: [{ itemId, variantSku: "", qty: 6, reason: "UNSOLD" }],
    });
    mismatchReturnId = createdMismatch.returnId;
    const mismatchLine = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(mismatchReturnId) } });
    await receiveFieldReturn({
      returnId: mismatchReturnId,
      receivedById: userId,
      counts: [{ lineId: mismatchLine.id, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });

    /*
     * FIELD origin, left in the SAME PENDING_WAREHOUSE_RECEIVING status a counting ADMIN return
     * would have — isolates origin, not status, as the excluding factor.
     */
    const createdField = await createFieldReturn({
      storeId: storeFieldOnlyId,
      raisedById: userId,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [{ itemId, variantSku: "", qty: 5, reason: "UNSOLD" }],
    });
    fieldReturnId = createdField.returnId;

    const createdScopeA = await createFieldReturn({
      storeId: storeScopeAId,
      raisedById: userId,
      origin: "ADMIN",
      lines: [{ itemId, variantSku: "", qty: 3, reason: "UNSOLD" }],
    });
    scopeAReturnId = createdScopeA.returnId;

    const createdScopeB = await createFieldReturn({
      storeId: storeScopeBId,
      raisedById: userId,
      origin: "ADMIN",
      lines: [{ itemId, variantSku: "", qty: 8, reason: "UNSOLD" }],
    });
    scopeBReturnId = createdScopeB.returnId;
  });

  afterEach(async () => {
    const returnIds = [
      seededId(unreceivedReturnId),
      seededId(receivedReturnId),
      seededId(mismatchReturnId),
      seededId(fieldReturnId),
      seededId(scopeAReturnId),
      seededId(scopeBReturnId),
    ];
    const storeIds = [
      seededId(storeUnreceivedId),
      seededId(storeReceivedId),
      seededId(storeMismatchId),
      seededId(storeFieldOnlyId),
      seededId(storeScopeAId),
      seededId(storeScopeBId),
    ];
    const notifications = await mismatchNotificationsFor(returnIds);
    if (notifications.length) {
      await prisma.adminNotification.deleteMany({ where: { id: { in: notifications.map((n) => n.id) } } });
    }
    await prisma.storeStock.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("counts an ADMIN return raised but not yet received, under raisedQty", async () => {
    expect(await getInTransitAdminReturnQty(storeUnreceivedId)).toEqual({ raisedQty: 4, receivedQty: 0 });
  });

  it("moves an ADMIN return from raisedQty to receivedQty once the warehouse has received it clean, rather than excluding it — it is not APPROVED yet", async () => {
    expect(await getInTransitAdminReturnQty(storeReceivedId)).toEqual({ raisedQty: 0, receivedQty: 6 });
  });

  it("counts receivedQty by what was actually counted in, not the claimed qty, for a received-but-unresolved mismatch", async () => {
    expect(await getInTransitAdminReturnQty(storeMismatchId)).toEqual({ raisedQty: 0, receivedQty: 4 });
  });

  it("never counts a FIELD-origin return, even sitting in the same PENDING_WAREHOUSE_RECEIVING status an ADMIN return would count in", async () => {
    expect(await getInTransitAdminReturnQty(storeFieldOnlyId)).toEqual({ raisedQty: 0, receivedQty: 0 });
  });

  it("scopes to the one store, not picking up another store's ADMIN returns", async () => {
    expect(await getInTransitAdminReturnQty(storeScopeAId)).toEqual({ raisedQty: 3, receivedQty: 0 });
    expect(await getInTransitAdminReturnQty(storeScopeBId)).toEqual({ raisedQty: 8, receivedQty: 0 });
  });
});

d("listFieldReturns — origin + credit filters (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let userId = "";
  let storeId = "";
  let storeName = "";
  let adminReturnId = "";
  let fieldReturnId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    userId = "";
    storeId = "";
    storeName = "";
    adminReturnId = "";
    fieldReturnId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-LFO-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: {
        sku: `TEST-LFO-${token}`,
        nameId: "List filter item",
        nameEn: "List filter item",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        sellingPrice: 40000,
      },
    });
    itemId = item.id;

    const user = await prisma.user.create({ data: { email: `test-lfo-${token}@example.com`, name: "Test List Filter User" } });
    userId = user.id;

    /*
     * `listFieldReturns` has no storeId param of its own — a token-suffixed store name is what
     * isolates this fixture's rows from real dev data and other specs on the shared test bed,
     * via the same `q` (docNo/store-name contains) filter the register's own search box uses.
     */
    storeName = `Test List Filter Store ${token}`;
    const store = await prisma.store.create({
      data: { code: `TEST-LFO-STORE-${token}`, name: storeName, address: "Test address", termsType: "KONSI", isActive: true },
    });
    storeId = store.id;

    const createdAdmin = await createFieldReturn({
      storeId,
      raisedById: userId,
      origin: "ADMIN",
      lines: [{ itemId, variantSku: "", qty: 2, reason: "UNSOLD" }],
    });
    adminReturnId = createdAdmin.returnId;

    const createdField = await createFieldReturn({
      storeId,
      raisedById: userId,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [{ itemId, variantSku: "", qty: 2, reason: "UNSOLD" }],
    });
    fieldReturnId = createdField.returnId;
  });

  afterEach(async () => {
    const returnIds = [seededId(adminReturnId), seededId(fieldReturnId)];
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it(`filters to origin: "ADMIN" and returns only the admin-origin row`, async () => {
    const { rows, total } = await listFieldReturns({ q: storeName, origin: "ADMIN", page: 1, perPage: 50 });
    expect(total).toBe(1);
    expect(rows.map((r) => r.id)).toEqual([adminReturnId]);
    expect(rows[0].origin).toBe("ADMIN");
  });

  it("returns both the admin- and field-origin rows when no origin filter is given", async () => {
    const { rows, total } = await listFieldReturns({ q: storeName, page: 1, perPage: 50 });
    expect(total).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual([adminReturnId, fieldReturnId].sort());
  });

  it(`filters creditFilter: "AVAILABLE" on all three offsettability conditions, not offsetStatus alone`, async () => {
    /*
     * Both rows carry the schema default offsetStatus AVAILABLE and both are APPROVED — they
     * differ ONLY in valuationStatus. A predicate reading offsetStatus alone (or omitting the
     * valuationStatus leg) would return both, which is exactly the regression this guards.
     */
    await prisma.fieldReturn.update({
      where: { id: adminReturnId },
      data: { status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE", totalValue: 500 },
    });
    await prisma.fieldReturn.update({
      where: { id: fieldReturnId },
      data: { status: "APPROVED", valuationStatus: "PENDING", offsetStatus: "AVAILABLE", totalValue: null },
    });

    const { rows, total } = await listFieldReturns({ q: storeName, creditFilter: "AVAILABLE", page: 1, perPage: 50 });
    expect(total).toBe(1);
    expect(rows.map((r) => r.id)).toEqual([adminReturnId]);
    expect(rows[0].offsetStatus).toBe("AVAILABLE");
    expect(rows[0].valuationStatus).toBe("VALUED");
  });
});
