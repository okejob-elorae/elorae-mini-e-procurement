import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { approveFieldSalesOrder, createFieldSalesOrder } from "./writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
/* Stubbed so the writer's post-commit fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

d("approveFieldSalesOrder — konsi added lines (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let neverSentItemId = "";
  let alreadySentItemId = "";
  let variantItemId = "";
  let storeId = "";
  let putusStoreId = "";
  let userId = "";
  let visitId = "";
  let putusVisitId = "";
  let orderId = "";
  let putusOrderId = "";
  let priorOrderId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    neverSentItemId = "";
    alreadySentItemId = "";
    variantItemId = "";
    storeId = "";
    putusStoreId = "";
    userId = "";
    visitId = "";
    putusVisitId = "";
    orderId = "";
    putusOrderId = "";
    priorOrderId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KAL-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-KAL-${token}`, nameId: "On order item", nameEn: "On order item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 1000, totalValue: 50000 } });

    const neverSentItem = await prisma.item.create({
      data: { sku: `TEST-KAL-NS-${token}`, nameId: "Never sent item", nameEn: "Never sent item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 50000 },
    });
    neverSentItemId = neverSentItem.id;
    await prisma.inventoryValue.create({ data: { itemId: neverSentItemId, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 1500, totalValue: 75000 } });

    const alreadySentItem = await prisma.item.create({
      data: { sku: `TEST-KAL-AS-${token}`, nameId: "Already sent item", nameEn: "Already sent item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 30000 },
    });
    alreadySentItemId = alreadySentItem.id;
    await prisma.inventoryValue.create({ data: { itemId: alreadySentItemId, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 900, totalValue: 45000 } });

    const variantItem = await prisma.item.create({
      data: { sku: `TEST-KAL-VAR-${token}`, nameId: "Variant item", nameEn: "Variant item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000 },
    });
    variantItemId = variantItem.id;
    await prisma.inventoryValue.create({ data: { itemId: variantItemId, variantSku: "RED", qtyOnHand: 20, reservedQty: 0, avgCost: 800, totalValue: 16000 } });
    await prisma.inventoryValue.create({ data: { itemId: variantItemId, variantSku: "BLUE", qtyOnHand: 20, reservedQty: 0, avgCost: 800, totalValue: 16000 } });

    const store = await prisma.store.create({
      data: { code: `TEST-KAL-STORE-${token}`, name: "Test Konsi Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    storeId = store.id;

    const putusStore = await prisma.store.create({
      data: { code: `TEST-KAL-PSTORE-${token}`, name: "Test Putus Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    putusStoreId = putusStore.id;

    const user = await prisma.user.create({ data: { email: `test-kal-${token}@example.com`, name: "Test KAL Salesman" } });
    userId = user.id;

    const visit = await prisma.storeVisit.create({ data: { storeId, userId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;
    const putusVisit = await prisma.storeVisit.create({ data: { storeId: putusStoreId, userId, checkinLat: 0, checkinLng: 0 } });
    putusVisitId = putusVisit.id;

    const { orderId: newOrderId } = await createFieldSalesOrder({
      storeId,
      salesmanId: userId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "On order item", qty: 2, unitPrice: 0 }],
    });
    orderId = newOrderId;

    const { orderId: newPutusOrderId } = await createFieldSalesOrder({
      storeId: putusStoreId,
      salesmanId: userId,
      visitId: putusVisitId,
      lines: [{ itemId, variantSku: "", productName: "On order item", qty: 6, unitPrice: 40000 }],
    });
    putusOrderId = newPutusOrderId;

    /* A separate, already-APPROVED konsi order for the same store, carrying an item not on `orderId`. */
    const priorOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-KAL-PRIOR-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: 1000,
        total: 1000,
        lines: {
          create: [{ itemId: alreadySentItemId, variantSku: "", productName: "Already sent item", qty: 1, unitPrice: 1000, lineTotal: 1000 }],
        },
      },
    });
    priorOrderId = priorOrder.id;
  });

  afterEach(async () => {
    const allItemIds = [seededId(itemId), seededId(neverSentItemId), seededId(alreadySentItemId), seededId(variantItemId)];
    const allOrderIds = [seededId(orderId), seededId(putusOrderId), seededId(priorOrderId)];
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: allOrderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: allOrderIds } } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: [seededId(visitId), seededId(putusVisitId)] } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(putusStoreId)] } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: allItemIds } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("creates the added line with addedById set and leaves the salesman's line null", async () => {
    await approveFieldSalesOrder({
      orderId,
      approvedById: userId,
      addedLines: [{ itemId: neverSentItemId, variantSku: "", qty: 3 }],
    });

    const lines = await prisma.fieldSalesOrderLine.findMany({
      where: { orderId: seededId(orderId) },
      select: { itemId: true, qty: true, addedById: true, unitPrice: true },
    });
    expect(lines).toHaveLength(2);
    const added = lines.find((l) => l.itemId === neverSentItemId)!;
    const requested = lines.find((l) => l.itemId === itemId)!;
    expect(added.addedById).toBe(userId);
    expect(added.qty).toBe(3);
    expect(requested.addedById).toBeNull();
  });

  it("prices the added line with the konsi gross-up, not zero", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: userId, addedLines: [{ itemId: neverSentItemId, variantSku: "", qty: 2 }] });
    const added = await prisma.fieldSalesOrderLine.findFirst({
      where: { orderId: seededId(orderId), itemId: neverSentItemId },
      select: { unitPrice: true, lineTotal: true },
    });
    expect(Number(added!.unitPrice)).toBeGreaterThan(0);
    expect(Number(added!.lineTotal)).toBe(Number(added!.unitPrice) * 2);
  });

  it("includes the added line in the order total", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: userId, addedLines: [{ itemId: neverSentItemId, variantSku: "", qty: 2 }] });
    const [order, lines] = await Promise.all([
      prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) }, select: { total: true } }),
      prisma.fieldSalesOrderLine.findMany({ where: { orderId: seededId(orderId) }, select: { lineTotal: true } }),
    ]);
    const sum = lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    expect(Number(order.total)).toBe(sum);
  });

  it("rejects an item already on the order", async () => {
    await expect(
      approveFieldSalesOrder({ orderId, approvedById: userId, addedLines: [{ itemId, variantSku: "", qty: 1 }] }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) }, select: { status: true } });
    expect(order.status).toBe("PENDING_APPROVAL");
  });

  it("rejects duplicate items within the same addedLines payload", async () => {
    await expect(
      approveFieldSalesOrder({
        orderId,
        approvedById: userId,
        addedLines: [
          { itemId: neverSentItemId, variantSku: "", qty: 1 },
          { itemId: neverSentItemId, variantSku: "", qty: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    const lines = await prisma.fieldSalesOrderLine.findMany({ where: { orderId: seededId(orderId) } });
    expect(lines).toHaveLength(1);
  });

  it("accepts two different variants of the same item as distinct, non-duplicate lines", async () => {
    await approveFieldSalesOrder({
      orderId,
      approvedById: userId,
      addedLines: [
        { itemId: variantItemId, variantSku: "RED", qty: 1 },
        { itemId: variantItemId, variantSku: "BLUE", qty: 1 },
      ],
    });
    const lines = await prisma.fieldSalesOrderLine.findMany({
      where: { orderId: seededId(orderId), itemId: variantItemId },
      select: { variantSku: true },
    });
    expect(lines.map((l) => l.variantSku).sort()).toEqual(["BLUE", "RED"]);
  });

  it("rejects a non-positive qty and creates nothing", async () => {
    await expect(
      approveFieldSalesOrder({ orderId, approvedById: userId, addedLines: [{ itemId: neverSentItemId, variantSku: "", qty: 0 }] }),
    ).rejects.toMatchObject({ code: "BAD_QTY" });
    const lines = await prisma.fieldSalesOrderLine.findMany({ where: { orderId: seededId(orderId) } });
    expect(lines).toHaveLength(1);
  });

  it("rejects an item already sent to the store on a different konsi order", async () => {
    await expect(
      approveFieldSalesOrder({ orderId, approvedById: userId, addedLines: [{ itemId: alreadySentItemId, variantSku: "", qty: 1 }] }),
    ).rejects.toMatchObject({ code: "ALREADY_SENT" });
    const lines = await prisma.fieldSalesOrderLine.findMany({ where: { orderId: seededId(orderId) } });
    expect(lines).toHaveLength(1);
  });

  it("rejects an unknown item and creates nothing", async () => {
    await expect(
      approveFieldSalesOrder({ orderId, approvedById: userId, addedLines: [{ itemId: "does-not-exist", variantSku: "", qty: 1 }] }),
    ).rejects.toMatchObject({ code: "UNKNOWN_ITEM" });
    const lines = await prisma.fieldSalesOrderLine.findMany({ where: { orderId: seededId(orderId) } });
    expect(lines).toHaveLength(1);
  });

  it("rejects addedLines on a PUTUS order", async () => {
    await expect(
      approveFieldSalesOrder({ orderId: putusOrderId, approvedById: userId, addedLines: [{ itemId: neverSentItemId, variantSku: "", qty: 1 }] }),
    ).rejects.toMatchObject({ code: "NOT_KONSI" });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(putusOrderId) }, select: { status: true } });
    expect(order.status).toBe("PENDING_APPROVAL");
  });
});
