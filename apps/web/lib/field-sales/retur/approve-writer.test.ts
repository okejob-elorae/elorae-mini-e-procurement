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

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    shortItemId = "";
    storeId = "";
    raisedById = "";
    adminId = "";
    returnId = "";
    mismatchedReturnId = "";
    shortReturnId = "";
    rejectedReturnId = "";

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
  });

  afterEach(async () => {
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: [seededId(itemId), seededId(shortItemId)] } } });
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: { in: [seededId(itemId), seededId(shortItemId)] } } });
    await prisma.fieldReturnResolution.deleteMany({
      where: { line: { returnId: { in: [seededId(returnId), seededId(mismatchedReturnId), seededId(shortReturnId), seededId(rejectedReturnId)] } } },
    });
    await prisma.fieldReturnLine.deleteMany({
      where: { returnId: { in: [seededId(returnId), seededId(mismatchedReturnId), seededId(shortReturnId), seededId(rejectedReturnId)] } },
    });
    await prisma.fieldReturn.deleteMany({
      where: { id: { in: [seededId(returnId), seededId(mismatchedReturnId), seededId(shortReturnId), seededId(rejectedReturnId)] } },
    });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: [seededId(itemId), seededId(shortItemId)] } } });
    await prisma.store.delete({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemId), seededId(shortItemId)] } } });
    await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  it("refuses while any line is unsettled", async () => {
    await expect(approveFieldReturn({ returnId: mismatchedReturnId, approvedById: adminId }))
      .rejects.toMatchObject({ code: "UNRESOLVED_LINES" });
  });

  it("restores sellableQty to qtyOnHand", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldReturn({ returnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 3);
  });

  it("writes a POSITIVE StockAdjustment sourced FIELD_RETURN", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { itemId: seededId(itemId), source: "FIELD_RETURN" } });
    expect(adj.type).toBe("POSITIVE");
    expect(Number(adj.qtyChange)).toBe(3);
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

  it("refuses a second approve", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    await expect(approveFieldReturn({ returnId, approvedById: adminId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
