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
  let storeId = "";
  let raisedById = "";
  let adminId = "";

  /* Retur A: claimed == received, no variance — straight to PENDING_APPROVAL. */
  let returnId = "";

  /*
   * Retur B: claimed 5, received 2 — left UNRESOLVED. receiveFieldReturn and
   * resolveFieldReturnLine keep FieldReturn.status in sync with per-line settled state on
   * every write of their own, so there is no way to reach PENDING_APPROVAL with an unsettled
   * line through the real writers. The status is hand-stamped below to simulate that drift
   * and exercise approveFieldReturn's own defense-in-depth check directly, rather than
   * leaving it untested because the app can't normally produce the state.
   */
  let mismatchedReturnId = "";

  /* Retur C: claimed 5, received 3, settled via WRITE_OFF — the short-received case. */
  let shortReturnId = "";

  /* Retur D: claimed 3 == received 3, split 1 sellable / 2 rejected. */
  let rejectedReturnId = "";

  /* Retur E: claimed 2 == received 2, fully rejected — sellableQty 0. */
  let fullyRejectedReturnId = "";

  /* Retur F: claimed 4 == received 4, all sellable, for an item with NO pre-existing InventoryValue row. */
  let noRowReturnId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    shortItemId = "";
    noRowItemId = "";
    storeId = "";
    raisedById = "";
    adminId = "";
    returnId = "";
    mismatchedReturnId = "";
    shortReturnId = "";
    rejectedReturnId = "";
    fullyRejectedReturnId = "";
    noRowReturnId = "";

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

    /* Retur A. */
    const createdA = await mkReturn({ itemId, qty: 3, reason: "UNSOLD" });
    returnId = createdA.returnId;
    const lineA = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(returnId) } });
    await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [{ lineId: lineA.id, receivedQty: 3, sellableQty: 3, rejectedQty: 0 }],
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

    /* Retur C. */
    const createdC = await mkReturn({ itemId: shortItemId, qty: 5, reason: "DAMAGED" });
    shortReturnId = createdC.returnId;
    const lineC = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(shortReturnId) } });
    await receiveFieldReturn({
      returnId: shortReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineC.id, receivedQty: 3, sellableQty: 3, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: lineC.id, type: "WRITE_OFF", createdById: adminId });

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
  });

  afterEach(async () => {
    const itemIds = [seededId(itemId), seededId(shortItemId), seededId(noRowItemId)];
    const returnIds = [
      seededId(returnId),
      seededId(mismatchedReturnId),
      seededId(shortReturnId),
      seededId(rejectedReturnId),
      seededId(fullyRejectedReturnId),
      seededId(noRowReturnId),
    ];
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.fieldReturnResolution.deleteMany({ where: { line: { returnId: { in: returnIds } } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.store.delete({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.uOM.delete({ where: { id: seededId(uomId) } });
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
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 3);
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
  });

  it("writes a POSITIVE StockAdjustment sourced FIELD_RETURN with the real before/after qty and cost", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldReturn({ returnId, approvedById: adminId });
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { itemId: seededId(itemId), source: "FIELD_RETURN" } });
    expect(adj.type).toBe("POSITIVE");
    expect(Number(adj.qtyChange)).toBe(3);
    expect(Number(adj.prevQty)).toBe(Number(before.qtyOnHand));
    expect(Number(adj.newQty)).toBe(Number(before.qtyOnHand) + 3);
    expect(Number(adj.prevAvgCost)).toBe(Number(before.avgCost));
    expect(Number(adj.newAvgCost)).toBe(Number(before.avgCost));
  });

  it("writes no StockAdjustment when a line's sellableQty is zero", async () => {
    await approveFieldReturn({ returnId: fullyRejectedReturnId, approvedById: adminId });
    const count = await prisma.stockAdjustment.count({ where: { itemId: seededId(itemId), source: "FIELD_RETURN" } });
    expect(count).toBe(0);
  });

  it("restores the RECEIVED quantity, not the claimed one", async () => {
    /* claimed 5, received 3, settled by WRITE_OFF */
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(shortItemId) } });
    await approveFieldReturn({ returnId: shortReturnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(shortItemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 3);
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
});
