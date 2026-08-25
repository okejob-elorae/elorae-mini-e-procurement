import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldReturn } from "./writer";
import { receiveFieldReturn } from "./receive-writer";
import { resolveFieldReturnLine } from "./resolve-writer";
import { approveFieldReturn } from "./approve-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("approveFieldReturn (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let shortItemId = "";
  let noRowItemId = "";
  let unpricedItemId = "";
  let ambiguousItemId = "";
  let storeId = "";
  let raisedById = "";
  let adminId = "";

  /*
   * Retur A: claimed == received == 12, no variance — straight to PENDING_APPROVAL. Priced by
   * a real delivery of the SAME 12 pcs for 10.000.000 to the same store/item/variant, so
   * creditedQty (12) matches the delivery's own qty exactly — required for the "unit price
   * doesn't multiply back" test, which needs the full delivered qty, not a partial claim.
   */
  let returnId = "";
  let lineId = "";

  /* The 12-pcs-for-10.000.000 delivery line that prices Retur A (and, by store+item+variant,
     any other retur line against the same item). */
  let deliveryLineId = "";

  /*
   * Retur B: claimed 5, received 2 — left UNRESOLVED. receiveFieldReturn and
   * resolveFieldReturnLine keep FieldReturn.status in sync with per-line settled state on
   * every write of their own, so there is no way to reach PENDING_APPROVAL with an unsettled
   * line through the real writers. The status is hand-stamped below to simulate that drift
   * and exercise approveFieldReturn's own defense-in-depth check directly, rather than
   * leaving it untested because the app can't normally produce the state.
   */
  let mismatchedReturnId = "";

  /* Retur C: claimed 12, received 10, settled via SALESMAN_BEARS — the short-received case,
     priced by its own 12-pcs-for-10.000.000 delivery. */
  let shortReturnId = "";
  let shortLineId = "";

  /* Retur D: claimed 3 == received 3, split 1 sellable / 2 rejected. */
  let rejectedReturnId = "";

  /* Retur E: claimed 2 == received 2, fully rejected — sellableQty 0. */
  let fullyRejectedReturnId = "";

  /* Retur F: claimed 4 == received 4, all sellable, for an item with NO pre-existing InventoryValue row. */
  let noRowReturnId = "";

  /* Retur G: claimed 2, received 4 (surplus of 2), settled via ACCEPT_SURPLUS. */
  let surplusReturnId = "";
  let surplusLineId = "";

  /* Retur H: claimed == received == 3, for an item that has NEVER been delivered — the line
     stays unpriced (UNPRICEABLE) unless an admin later sets a MANUAL price on it. */
  let unpricedReturnId = "";
  let unpricedLineId = "";

  /* Retur I: claimed == received == 3, for an item TWO deliveries priced differently
     (AMBIGUOUS) — the line stays unpriced unless an admin retargets it to one delivery. */
  let ambiguousReturnId = "";
  let ambiguousLineId = "";
  /* The cheaper of the two disagreeing deliveries (3 pcs for 6.000.000 -> 2.000.000/unit). */
  let cheaperDeliveryLineId = "";

  /* Retur J: claimed 5, received 2, settled via INVESTIGATE — INVESTIGATE never settles, so
     this retur can never leave MISMATCH_PENDING_RESOLUTION and approveFieldReturn must refuse
     it, exactly like the never-received-a-resolution case. */
  let investigatingReturnId = "";
  let investigatingLineId = "";

  /* Order/delivery scaffolding created only to price the returs above — tracked as arrays
     because there are several, and torn down before the orders/items/users they reference. */
  let deliveryIds: string[] = [];
  let orderIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    shortItemId = "";
    noRowItemId = "";
    unpricedItemId = "";
    ambiguousItemId = "";
    storeId = "";
    raisedById = "";
    adminId = "";
    returnId = "";
    lineId = "";
    deliveryLineId = "";
    mismatchedReturnId = "";
    shortReturnId = "";
    shortLineId = "";
    rejectedReturnId = "";
    fullyRejectedReturnId = "";
    noRowReturnId = "";
    surplusReturnId = "";
    surplusLineId = "";
    unpricedReturnId = "";
    unpricedLineId = "";
    ambiguousReturnId = "";
    ambiguousLineId = "";
    cheaperDeliveryLineId = "";
    investigatingReturnId = "";
    investigatingLineId = "";
    deliveryIds = [];
    orderIds = [];

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRA-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FRA-${token}`, nameId: "Retur approve item", nameEn: "Retur approve item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;

    const shortItem = await prisma.item.create({
      data: { sku: `TEST-FRA-SHORT-${token}`, nameId: "Retur approve item short", nameEn: "Retur approve item short", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    shortItemId = shortItem.id;

    const noRowItem = await prisma.item.create({
      data: { sku: `TEST-FRA-NOROW-${token}`, nameId: "Retur approve item no row", nameEn: "Retur approve item no row", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    noRowItemId = noRowItem.id;
    /* Deliberately no InventoryValue row seeded for noRowItemId — this fixture pins the
       no-row → avgCost 0 path. */

    const unpricedItem = await prisma.item.create({
      data: { sku: `TEST-FRA-UNPRICED-${token}`, nameId: "Retur approve item unpriced", nameEn: "Retur approve item unpriced", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    unpricedItemId = unpricedItem.id;
    /* Deliberately never delivered — resolveLinePrice must report UNPRICEABLE for it. */

    const ambiguousItem = await prisma.item.create({
      data: { sku: `TEST-FRA-AMBIG-${token}`, nameId: "Retur approve item ambiguous", nameEn: "Retur approve item ambiguous", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    ambiguousItemId = ambiguousItem.id;

    /*
     * Seed the main inventory row with variantSku: null — the real shape a Jubelio-ingested
     * variantless row takes — so the writer's OR-tolerant lookup is genuinely exercised, not
     * just a "" row a strict lookup would also have found.
     */
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 50, reservedQty: 0, avgCost: 10000, totalValue: 500000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId: shortItemId, variantSku: null, qtyOnHand: 20, reservedQty: 0, avgCost: 5000, totalValue: 100000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId: unpricedItemId, variantSku: null, qtyOnHand: 15, reservedQty: 0, avgCost: 7000, totalValue: 105000 },
    });

    const store = await prisma.store.create({
      data: { code: `TEST-FRA-STORE-${token}`, name: "Test Retur Approve Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const raisedBy = await prisma.user.create({ data: { email: `test-fra-${token}@example.com`, name: "Test Retur Salesman" } });
    raisedById = raisedBy.id;

    const admin = await prisma.user.create({ data: { email: `test-fra-admin-${token}@example.com`, name: "Test Warehouse Admin" } });
    adminId = admin.id;

    const mkReturn = async (opts: { itemId: string; qty: number; reason: "DAMAGED" | "UNSOLD" }) =>
      createFieldReturn({
        storeId,
        raisedById,
        transport: "SELF_CARRY",
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
        lines: [{ itemId: opts.itemId, variantSku: "", qty: opts.qty, reason: opts.reason }],
      });

    /*
     * Builds a real FieldSalesOrder + FieldSalesDelivery + FieldSalesDeliveryLine to this
     * store for the given item, at variantSku "" (the same convention mkReturn's lines use),
     * so resolveLinePrice's store+item+variant lookup finds it. Bypasses the delivery writer
     * (out of scope here), same as pricing.test.ts's fixture.
     */
    const mkDelivery = async (opts: { itemId: string; qty: number; lineTotal: number; suffix: string }) => {
      const unitPrice = opts.lineTotal / opts.qty;
      const order = await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `PUTUS/TEST-FRA-${opts.suffix}-${token}`,
          storeId,
          salesmanId: raisedById,
          status: "APPROVED",
          orderType: "PUTUS",
          subtotal: opts.lineTotal,
          total: opts.lineTotal,
          lines: {
            create: [{ itemId: opts.itemId, variantSku: "", productName: "Test delivery line", qty: opts.qty, unitPrice, lineTotal: opts.lineTotal }],
          },
        },
        include: { lines: true },
      });
      orderIds.push(order.id);
      const orderLine = order.lines[0];
      const delivery = await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `TEST-FRA-DLV-${opts.suffix}-${token}`,
          orderId: order.id,
          deliveredAt: new Date("2026-08-01T00:00:00.000Z"),
          deliveredById: raisedById,
          invoiceDate: new Date("2026-08-01T00:00:00.000Z"),
          dueDate: new Date("2026-08-08T00:00:00.000Z"),
          subtotal: opts.lineTotal,
          total: opts.lineTotal,
          lines: {
            create: [{ orderLineId: orderLine.id, itemId: opts.itemId, variantSku: "", productName: "Test delivery line", qty: opts.qty, unitPrice, lineTotal: opts.lineTotal }],
          },
        },
        include: { lines: true },
      });
      deliveryIds.push(delivery.id);
      return delivery.lines[0].id;
    };

    /* Retur A — claimed and received in full (12 pcs), priced by a real delivery of the same
       12 pcs for 10.000.000 to this store. */
    deliveryLineId = await mkDelivery({ itemId, qty: 12, lineTotal: 10_000_000, suffix: "MAIN" });
    const createdA = await mkReturn({ itemId, qty: 12, reason: "UNSOLD" });
    returnId = createdA.returnId;
    const lineA = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(returnId) } });
    lineId = lineA.id;
    await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [{ lineId: lineA.id, receivedQty: 12, sellableQty: 12, rejectedQty: 0 }],
    });

    /* Retur B — left unresolved, then hand-stamped (see comment above the declaration). */
    const createdB = await mkReturn({ itemId, qty: 5, reason: "UNSOLD" });
    mismatchedReturnId = createdB.returnId;
    const lineB = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(mismatchedReturnId) } });
    await receiveFieldReturn({
      returnId: mismatchedReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineB.id, receivedQty: 2, sellableQty: 2, rejectedQty: 0 }],
    });
    await prisma.fieldReturn.update({ where: { id: mismatchedReturnId }, data: { status: "PENDING_APPROVAL" } });

    /* Retur C — claimed 12, received 10, settled via SALESMAN_BEARS. Priced by its own
       12-pcs-for-10.000.000 delivery (same ratio as Retur A, different item). */
    await mkDelivery({ itemId: shortItemId, qty: 12, lineTotal: 10_000_000, suffix: "SHORT" });
    const createdC = await mkReturn({ itemId: shortItemId, qty: 12, reason: "DAMAGED" });
    shortReturnId = createdC.returnId;
    const lineC = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(shortReturnId) } });
    shortLineId = lineC.id;
    await receiveFieldReturn({
      returnId: shortReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineC.id, receivedQty: 10, sellableQty: 10, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: lineC.id, type: "SALESMAN_BEARS", createdById: adminId });

    /* Retur D. */
    const createdD = await mkReturn({ itemId, qty: 3, reason: "DAMAGED" });
    rejectedReturnId = createdD.returnId;
    const lineD = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(rejectedReturnId) } });
    await receiveFieldReturn({
      returnId: rejectedReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineD.id, receivedQty: 3, sellableQty: 1, rejectedQty: 2 }],
    });

    /* Retur E — fully rejected, sellableQty 0. */
    const createdE = await mkReturn({ itemId, qty: 2, reason: "DAMAGED" });
    fullyRejectedReturnId = createdE.returnId;
    const lineE = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(fullyRejectedReturnId) } });
    await receiveFieldReturn({
      returnId: fullyRejectedReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineE.id, receivedQty: 2, sellableQty: 0, rejectedQty: 2 }],
    });

    /* Retur F — no pre-existing InventoryValue row for noRowItemId. */
    const createdF = await mkReturn({ itemId: noRowItemId, qty: 4, reason: "UNSOLD" });
    noRowReturnId = createdF.returnId;
    const lineF = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(noRowReturnId) } });
    await receiveFieldReturn({
      returnId: noRowReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineF.id, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });

    /* Retur G — claimed 2, received 4 (surplus of 2), settled via ACCEPT_SURPLUS. Priced by
       the same itemId delivery as Retur A/C; the resolution stamps no amount for a surplus. */
    const createdG = await mkReturn({ itemId, qty: 2, reason: "UNSOLD" });
    surplusReturnId = createdG.returnId;
    const lineG = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(surplusReturnId) } });
    surplusLineId = lineG.id;
    await receiveFieldReturn({
      returnId: surplusReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineG.id, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: lineG.id, type: "ACCEPT_SURPLUS", createdById: adminId });

    /* Retur H — claimed == received == 3, for an item that has never been delivered. */
    const createdH = await mkReturn({ itemId: unpricedItemId, qty: 3, reason: "UNSOLD" });
    unpricedReturnId = createdH.returnId;
    const lineH = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(unpricedReturnId) } });
    unpricedLineId = lineH.id;
    await receiveFieldReturn({
      returnId: unpricedReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineH.id, receivedQty: 3, sellableQty: 3, rejectedQty: 0 }],
    });

    /*
     * Retur I — claimed == received == 3, for an item TWO deliveries priced differently:
     * 1 pc for 3.000.000 (3.000.000/unit) and 3 pcs for 6.000.000 (2.000.000/unit, the
     * cheaper one). resolveLinePrice reports AMBIGUOUS and the line stays unpriced unless
     * an admin retargets it to one delivery.
     */
    await mkDelivery({ itemId: ambiguousItemId, qty: 1, lineTotal: 3_000_000, suffix: "AMBIG-EXP" });
    cheaperDeliveryLineId = await mkDelivery({ itemId: ambiguousItemId, qty: 3, lineTotal: 6_000_000, suffix: "AMBIG-CHEAP" });
    const createdI = await mkReturn({ itemId: ambiguousItemId, qty: 3, reason: "UNSOLD" });
    ambiguousReturnId = createdI.returnId;
    const lineI = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(ambiguousReturnId) } });
    ambiguousLineId = lineI.id;
    await receiveFieldReturn({
      returnId: ambiguousReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineI.id, receivedQty: 3, sellableQty: 3, rejectedQty: 0 }],
    });

    /* Retur J — claimed 5, received 2, settled via INVESTIGATE. INVESTIGATE never settles, so
       this retur holds in MISMATCH_PENDING_RESOLUTION and can never reach approval. */
    const createdJ = await mkReturn({ itemId, qty: 5, reason: "DAMAGED" });
    investigatingReturnId = createdJ.returnId;
    const lineJ = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(investigatingReturnId) } });
    investigatingLineId = lineJ.id;
    await receiveFieldReturn({
      returnId: investigatingReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineJ.id, receivedQty: 2, sellableQty: 2, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: lineJ.id, type: "INVESTIGATE", createdById: adminId });
  });

  afterEach(async () => {
    const itemIds = [
      seededId(itemId),
      seededId(shortItemId),
      seededId(noRowItemId),
      seededId(unpricedItemId),
      seededId(ambiguousItemId),
    ];
    const returnIds = [
      seededId(returnId),
      seededId(mismatchedReturnId),
      seededId(shortReturnId),
      seededId(rejectedReturnId),
      seededId(fullyRejectedReturnId),
      seededId(noRowReturnId),
      seededId(surplusReturnId),
      seededId(unpricedReturnId),
      seededId(ambiguousReturnId),
      seededId(investigatingReturnId),
    ];
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.fieldReturnResolution.deleteMany({ where: { line: { returnId: { in: returnIds } } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds } } });
    /* Delivery lines before deliveries, order lines before orders — FieldSalesDeliveryLine's
       orderLineId FK is real and enforced. */
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: { in: deliveryIds } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  it("refuses a retur whose status has drifted out of sync with its lines", async () => {
    await expect(approveFieldReturn({ returnId: mismatchedReturnId, approvedById: adminId }))
      .rejects.toMatchObject({ code: "UNRESOLVED_LINES" });
  });

  it("refuses a nonexistent retur with NOT_FOUND, not INVALID_STATE", async () => {
    /* Syntactically cuid-shaped but never seeded — must not be created and then deleted. */
    const unseededReturnId = "clnonexistentreturnid00000000";
    await expect(approveFieldReturn({ returnId: unseededReturnId, approvedById: adminId }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("restores sellableQty to qtyOnHand", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldReturn({ returnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 12);
  });

  it("does not fork a phantom variantSku row on the OR-tolerant lookup", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const count = await prisma.inventoryValue.count({ where: { itemId: seededId(itemId) } });
    expect(count).toBe(1);
  });

  it("restores stock at the current average cost, unchanged — never a blend", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldReturn({ returnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(after.avgCost)).toBe(Number(before.avgCost));
    expect(Number(after.totalValue)).toBe(Number(after.qtyOnHand) * Number(after.avgCost));
  });

  it("lands a brand-new inventory row at avgCost 0 when none existed", async () => {
    const beforeCount = await prisma.inventoryValue.count({ where: { itemId: seededId(noRowItemId) } });
    expect(beforeCount).toBe(0);
    await approveFieldReturn({ returnId: noRowReturnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(noRowItemId) } });
    expect(Number(after.qtyOnHand)).toBe(4);
    expect(Number(after.avgCost)).toBe(0);
    expect(Number(after.totalValue)).toBe(0);
    /* A fresh variantless row must land at null, not "" — the shape the OR-tolerant lookup
       (and every other writer) expects, not a phantom "" row alongside a null one. */
    expect(after.variantSku).toBeNull();
  });

  it("stamps approvedAt and approvedById on approve", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(row.approvedAt).not.toBeNull();
    expect(row.approvedById).toBe(adminId);
  });

  it("writes a POSITIVE StockAdjustment sourced FIELD_RETURN with the real before/after qty and cost", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldReturn({ returnId, approvedById: adminId });
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { itemId: seededId(itemId), source: "FIELD_RETURN" } });
    expect(adj.type).toBe("POSITIVE");
    expect(Number(adj.qtyChange)).toBe(12);
    expect(Number(adj.prevQty)).toBe(Number(before.qtyOnHand));
    expect(Number(adj.newQty)).toBe(Number(before.qtyOnHand) + 12);
    expect(Number(adj.prevAvgCost)).toBe(Number(before.avgCost));
    expect(Number(adj.newAvgCost)).toBe(Number(before.avgCost));
  });

  it("writes no StockAdjustment when a line's sellableQty is zero", async () => {
    await approveFieldReturn({ returnId: fullyRejectedReturnId, approvedById: adminId });
    const count = await prisma.stockAdjustment.count({ where: { itemId: seededId(itemId), source: "FIELD_RETURN" } });
    expect(count).toBe(0);
  });

  it("restores the RECEIVED quantity, not the claimed one", async () => {
    /* claimed 12, received 10, settled by SALESMAN_BEARS */
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(shortItemId) } });
    await approveFieldReturn({ returnId: shortReturnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(shortItemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 10);
  });

  it("routes rejectedQty to the rejected ledger with variantSku normalised to null", async () => {
    await approveFieldReturn({ returnId: rejectedReturnId, approvedById: adminId });
    const led = await prisma.rejectedGoodsLedger.findFirstOrThrow({ where: { itemId: seededId(itemId), refType: "FIELD_RETURN" } });
    expect(Number(led.qty)).toBe(2);
    expect(led.variantSku).toBeNull();
  });

  it("does not add rejected units to sellable stock", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldReturn({ returnId: rejectedReturnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    /* received 3 = 1 sellable + 2 rejected; only the 1 lands in stock */
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 1);
  });

  it("writes no RejectedGoodsLedger row when a line's rejectedQty is zero", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const count = await prisma.rejectedGoodsLedger.count({ where: { itemId: seededId(itemId) } });
    expect(count).toBe(0);
  });

  it("refuses a second approve", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    await expect(approveFieldReturn({ returnId, approvedById: adminId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("stamps the line value from the delivered price", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineId) } });
    expect(Number(line.lineValue)).toBe(10_000_000);
    expect(line.priceSource).toBe("DELIVERY");
    expect(line.priceDeliveryLineId).toBe(deliveryLineId);
  });

  it("ties out exactly even though the unit price does not multiply back", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineId) } });
    /* 10.000.000 / 12 = 833.333,33 at 2dp, and 12 x 833.333,33 = 9.999.999,96 */
    expect(Number(line.unitPrice)).toBe(833_333.33);
    expect(Number(line.lineValue)).toBe(10_000_000);
    expect(Number(line.creditedQty) * Number(line.unitPrice)).not.toBe(Number(line.lineValue));
  });

  it("credits the CLAIMED qty when the salesman bears the shortfall", async () => {
    /* claimed 12, received 10, settled SALESMAN_BEARS */
    await approveFieldReturn({ returnId: shortReturnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(shortLineId) } });
    expect(line.creditedQty).toBe(12);
    expect(Number(line.lineValue)).toBe(10_000_000);
  });

  it("stamps what the salesman owes on the resolution that settled it", async () => {
    await approveFieldReturn({ returnId: shortReturnId, approvedById: adminId });
    const res = await prisma.fieldReturnResolution.findFirstOrThrow({
      where: { lineId: seededId(shortLineId) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    /* 2 missing units at 833.333,3333 */
    expect(Number(res.amount)).toBe(1_666_666.67);
  });

  it("stamps no amount on an accepted surplus", async () => {
    await approveFieldReturn({ returnId: surplusReturnId, approvedById: adminId });
    const res = await prisma.fieldReturnResolution.findFirstOrThrow({
      where: { lineId: seededId(surplusLineId) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(res.amount).toBeNull();
  });

  it("sums the header total and marks the retur VALUED", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(Number(row.totalValue)).toBe(10_000_000);
    expect(row.valuationStatus).toBe("VALUED");
  });

  it("approves and restores stock even when a line cannot be priced", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(unpricedItemId) } });
    await approveFieldReturn({ returnId: unpricedReturnId, approvedById: adminId });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(unpricedReturnId) } });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(unpricedItemId) } });
    expect(row.status).toBe("APPROVED");
    expect(row.valuationStatus).toBe("PENDING");
    expect(row.totalValue).toBeNull();
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 3);
  });

  it("leaves an ambiguous line unpriced rather than guessing", async () => {
    await approveFieldReturn({ returnId: ambiguousReturnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(ambiguousLineId) } });
    expect(line.lineValue).toBeNull();
    expect(line.priceSource).toBeNull();
  });

  it("honours a price an admin already retargeted", async () => {
    await prisma.fieldReturnLine.update({
      where: { id: seededId(ambiguousLineId) },
      data: { priceSource: "DELIVERY", priceDeliveryLineId: cheaperDeliveryLineId },
    });
    await approveFieldReturn({ returnId: ambiguousReturnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(ambiguousLineId) } });
    expect(line.priceDeliveryLineId).toBe(cheaperDeliveryLineId);
    expect(Number(line.lineValue)).toBe(6_000_000);
  });

  it("honours a manual price and keeps its note", async () => {
    await prisma.fieldReturnLine.update({
      where: { id: seededId(unpricedLineId) },
      data: { priceSource: "MANUAL", unitPrice: 500_000, priceNote: "harga nota lama" },
    });
    await approveFieldReturn({ returnId: unpricedReturnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(unpricedLineId) } });
    expect(Number(line.lineValue)).toBe(1_500_000);
    expect(line.priceSource).toBe("MANUAL");
  });

  it("never values a retur held under investigation — it cannot reach approval at all", async () => {
    /*
     * INVESTIGATE is non-settling, so the retur holds in MISMATCH_PENDING_RESOLUTION and the
     * valuation path never runs. Asserting the refusal AND that nothing was stamped is the point:
     * a future change that let it approve would otherwise value it silently.
     */
    await expect(approveFieldReturn({ returnId: investigatingReturnId, approvedById: adminId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(investigatingLineId) } });
    expect(line.lineValue).toBeNull();
    expect(line.creditedQty).toBeNull();
  });

  it("freezes the value — changing the delivery price afterwards does not move it", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    await prisma.fieldSalesDeliveryLine.update({
      where: { id: seededId(deliveryLineId) },
      data: { lineTotal: 1 },
    });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineId) } });
    expect(Number(line.lineValue)).toBe(10_000_000);
  });
});
