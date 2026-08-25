import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldReturn } from "./writer";
import { receiveFieldReturn } from "./receive-writer";
import { resolveFieldReturnLine } from "./resolve-writer";
import { approveFieldReturn } from "./approve-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Task 2 of the admin-initiated store return feature: an ADMIN-origin retur splits its
 * StoreStock decrement across RECEIPT (receivedQty — what the warehouse physically has) and
 * APPROVE (the delta, creditedQty - receivedQty), while FIELD keeps the pre-existing single
 * full-creditedQty decrement at approve. The total decrement over a return's life must equal
 * creditedQty regardless of origin — the obvious bug is implementing the split as two FULL
 * decrements, which silently halves the store's ledger.
 */
d("admin-origin field returns (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemFieldNoDecrementId = "";
  let itemAdminReceiptId = "";
  let itemAdminCleanId = "";
  let itemAdminDeltaId = "";
  let itemAdminNegativeId = "";
  let itemAdminSalesmanBearsId = "";
  let itemAdminNoPhotoId = "";
  let konsiStoreId = "";
  let raisedById = "";
  let adminId = "";

  /* FIELD return, no variance, received but NOT approved — the receipt-time no-op case. */
  let fieldNoDecrementReturnId = "";
  let fieldNoDecrementLineId = "";

  /* ADMIN return, raised 5, received 5 (clean), NOT approved — pins the receipt-time decrement
     by receivedQty on its own, before approve ever runs. */
  let adminReceiptReturnId = "";
  let adminReceiptLineId = "";

  /* ADMIN return, raised 4, received 4 (clean), NOT approved — the test itself calls approve.
     Seeded StoreStock 10; the ONLY correct final qty is 6. A double-decrement bug gives 2. */
  let adminCleanReturnId = "";
  let adminCleanLineId = "";

  /* ADMIN return, raised 6, received 4 (shortage), settled WRITE_OFF (creditedQty = claimed =
     6), NOT approved — the test itself calls approve. Seeded StoreStock 10: receipt takes it to
     6 (10 - 4), approve's delta (6 - 4 = 2) takes it to 4. */
  let adminDeltaReturnId = "";
  let adminDeltaLineId = "";

  /* ADMIN return, raised 5, received 5 (clean), against a StoreStock row seeded already
     NEGATIVE (-3) — the receipt-time decrement must succeed, never refuse. */
  let adminNegativeReturnId = "";
  let adminNegativeLineId = "";

  /* ADMIN return, raised 6, received 4 (shortage), left UNRESOLVED — SALESMAN_BEARS is
     meaningless on an ADMIN return (no salesman raised it) and must be refused in the writer. */
  let adminSalesmanBearsReturnId = "";
  let adminSalesmanBearsLineId = "";

  /* ADMIN return raised with no nota photo and no transport at all — never received or
     approved, just pins that createFieldReturn accepts it. */
  let adminNoPhotoReturnId = "";

  beforeEach(async () => {
    uomId = "";
    itemFieldNoDecrementId = "";
    itemAdminReceiptId = "";
    itemAdminCleanId = "";
    itemAdminDeltaId = "";
    itemAdminNegativeId = "";
    itemAdminSalesmanBearsId = "";
    itemAdminNoPhotoId = "";
    konsiStoreId = "";
    raisedById = "";
    adminId = "";
    fieldNoDecrementReturnId = "";
    fieldNoDecrementLineId = "";
    adminReceiptReturnId = "";
    adminReceiptLineId = "";
    adminCleanReturnId = "";
    adminCleanLineId = "";
    adminDeltaReturnId = "";
    adminDeltaLineId = "";
    adminNegativeReturnId = "";
    adminNegativeLineId = "";
    adminSalesmanBearsReturnId = "";
    adminSalesmanBearsLineId = "";
    adminNoPhotoReturnId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FAO-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const mkItem = async (suffix: string) =>
      prisma.item.create({
        data: {
          sku: `TEST-FAO-${suffix}-${token}`,
          nameId: `Retur admin-origin item ${suffix}`,
          nameEn: `Retur admin-origin item ${suffix}`,
          type: "FINISHED_GOOD",
          uomId,
          isActive: true,
          sellingPrice: 40000,
        },
      });

    itemFieldNoDecrementId = (await mkItem("FIELD-NODEC")).id;
    itemAdminReceiptId = (await mkItem("ADMIN-RECEIPT")).id;
    itemAdminCleanId = (await mkItem("ADMIN-CLEAN")).id;
    itemAdminDeltaId = (await mkItem("ADMIN-DELTA")).id;
    itemAdminNegativeId = (await mkItem("ADMIN-NEG")).id;
    itemAdminSalesmanBearsId = (await mkItem("ADMIN-SB")).id;
    itemAdminNoPhotoId = (await mkItem("ADMIN-NOPHOTO")).id;

    const konsiStore = await prisma.store.create({
      data: { code: `TEST-FAO-KONSI-${token}`, name: "Test Admin-Origin Konsi Store", address: "Test address", termsType: "KONSI", isActive: true },
    });
    konsiStoreId = konsiStore.id;

    /* StoreStock seeds. itemAdminNegativeId is seeded already NEGATIVE on purpose. */
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: itemFieldNoDecrementId, variantSku: "", qty: 10, avgCost: 10000 } });
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: itemAdminReceiptId, variantSku: "", qty: 10, avgCost: 10000 } });
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: itemAdminCleanId, variantSku: "", qty: 10, avgCost: 10000 } });
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: itemAdminDeltaId, variantSku: "", qty: 10, avgCost: 10000 } });
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: itemAdminNegativeId, variantSku: "", qty: -3, avgCost: 10000 } });
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: itemAdminSalesmanBearsId, variantSku: "", qty: 10, avgCost: 10000 } });

    const raisedBy = await prisma.user.create({ data: { email: `test-fao-${token}@example.com`, name: "Test Retur Salesman" } });
    raisedById = raisedBy.id;

    const admin = await prisma.user.create({ data: { email: `test-fao-admin-${token}@example.com`, name: "Test Warehouse Admin" } });
    adminId = admin.id;

    /* FIELD return: claimed == received == 5, no variance. NOT approved. */
    const createdFieldNoDecrement = await createFieldReturn({
      storeId: konsiStoreId,
      raisedById,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [{ itemId: itemFieldNoDecrementId, variantSku: "", qty: 5, reason: "UNSOLD" }],
    });
    fieldNoDecrementReturnId = createdFieldNoDecrement.returnId;
    const fieldNoDecrementLine = await prisma.fieldReturnLine.findFirstOrThrow({
      where: { returnId: seededId(fieldNoDecrementReturnId) },
    });
    fieldNoDecrementLineId = fieldNoDecrementLine.id;
    await receiveFieldReturn({
      returnId: fieldNoDecrementReturnId,
      receivedById: adminId,
      counts: [{ lineId: fieldNoDecrementLineId, receivedQty: 5, sellableQty: 5, rejectedQty: 0 }],
    });

    /* ADMIN return: claimed == received == 5, no variance. NOT approved. */
    const createdAdminReceipt = await createFieldReturn({
      storeId: konsiStoreId,
      raisedById,
      origin: "ADMIN",
      lines: [{ itemId: itemAdminReceiptId, variantSku: "", qty: 5, reason: "UNSOLD" }],
    });
    adminReceiptReturnId = createdAdminReceipt.returnId;
    const adminReceiptLine = await prisma.fieldReturnLine.findFirstOrThrow({
      where: { returnId: seededId(adminReceiptReturnId) },
    });
    adminReceiptLineId = adminReceiptLine.id;
    await receiveFieldReturn({
      returnId: adminReceiptReturnId,
      receivedById: adminId,
      counts: [{ lineId: adminReceiptLineId, receivedQty: 5, sellableQty: 5, rejectedQty: 0 }],
    });

    /* ADMIN return: claimed == received == 4, no variance. Received but NOT approved — the
       test itself calls approveFieldReturn to assert the total decrement. */
    const createdAdminClean = await createFieldReturn({
      storeId: konsiStoreId,
      raisedById,
      origin: "ADMIN",
      lines: [{ itemId: itemAdminCleanId, variantSku: "", qty: 4, reason: "UNSOLD" }],
    });
    adminCleanReturnId = createdAdminClean.returnId;
    const adminCleanLine = await prisma.fieldReturnLine.findFirstOrThrow({
      where: { returnId: seededId(adminCleanReturnId) },
    });
    adminCleanLineId = adminCleanLine.id;
    await receiveFieldReturn({
      returnId: adminCleanReturnId,
      receivedById: adminId,
      counts: [{ lineId: adminCleanLineId, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });

    /* ADMIN return: claimed 6, received 4 (shortage), settled WRITE_OFF (SALESMAN_BEARS is
       refused on ADMIN returns, so WRITE_OFF is the settling resolution here) -> creditedQty
       is the claimed qty, 6. NOT approved — the test itself calls approveFieldReturn. */
    const createdAdminDelta = await createFieldReturn({
      storeId: konsiStoreId,
      raisedById,
      origin: "ADMIN",
      lines: [{ itemId: itemAdminDeltaId, variantSku: "", qty: 6, reason: "UNSOLD" }],
    });
    adminDeltaReturnId = createdAdminDelta.returnId;
    const adminDeltaLine = await prisma.fieldReturnLine.findFirstOrThrow({
      where: { returnId: seededId(adminDeltaReturnId) },
    });
    adminDeltaLineId = adminDeltaLine.id;
    await receiveFieldReturn({
      returnId: adminDeltaReturnId,
      receivedById: adminId,
      counts: [{ lineId: adminDeltaLineId, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: adminDeltaLineId, type: "WRITE_OFF", createdById: adminId });

    /* ADMIN return: claimed == received == 5, no variance, against a StoreStock row seeded
       at -3 (already negative) — receipt must succeed anyway. */
    const createdAdminNegative = await createFieldReturn({
      storeId: konsiStoreId,
      raisedById,
      origin: "ADMIN",
      lines: [{ itemId: itemAdminNegativeId, variantSku: "", qty: 5, reason: "UNSOLD" }],
    });
    adminNegativeReturnId = createdAdminNegative.returnId;
    const adminNegativeLine = await prisma.fieldReturnLine.findFirstOrThrow({
      where: { returnId: seededId(adminNegativeReturnId) },
    });
    adminNegativeLineId = adminNegativeLine.id;
    await receiveFieldReturn({
      returnId: adminNegativeReturnId,
      receivedById: adminId,
      counts: [{ lineId: adminNegativeLineId, receivedQty: 5, sellableQty: 5, rejectedQty: 0 }],
    });

    /* ADMIN return: claimed 6, received 4 (shortage), left UNRESOLVED — the test itself
       attempts SALESMAN_BEARS and expects a refusal. */
    const createdAdminSalesmanBears = await createFieldReturn({
      storeId: konsiStoreId,
      raisedById,
      origin: "ADMIN",
      lines: [{ itemId: itemAdminSalesmanBearsId, variantSku: "", qty: 6, reason: "UNSOLD" }],
    });
    adminSalesmanBearsReturnId = createdAdminSalesmanBears.returnId;
    const adminSalesmanBearsLine = await prisma.fieldReturnLine.findFirstOrThrow({
      where: { returnId: seededId(adminSalesmanBearsReturnId) },
    });
    adminSalesmanBearsLineId = adminSalesmanBearsLine.id;
    await receiveFieldReturn({
      returnId: adminSalesmanBearsReturnId,
      receivedById: adminId,
      counts: [{ lineId: adminSalesmanBearsLineId, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });

    /* ADMIN return raised with no nota photo and no transport at all — never received. */
    const createdAdminNoPhoto = await createFieldReturn({
      storeId: konsiStoreId,
      raisedById,
      origin: "ADMIN",
      lines: [{ itemId: itemAdminNoPhotoId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    });
    adminNoPhotoReturnId = createdAdminNoPhoto.returnId;
  });

  afterEach(async () => {
    const itemIds = [
      seededId(itemFieldNoDecrementId),
      seededId(itemAdminReceiptId),
      seededId(itemAdminCleanId),
      seededId(itemAdminDeltaId),
      seededId(itemAdminNegativeId),
      seededId(itemAdminSalesmanBearsId),
      seededId(itemAdminNoPhotoId),
    ];
    const returnIds = [
      seededId(fieldNoDecrementReturnId),
      seededId(adminReceiptReturnId),
      seededId(adminCleanReturnId),
      seededId(adminDeltaReturnId),
      seededId(adminNegativeReturnId),
      seededId(adminSalesmanBearsReturnId),
      seededId(adminNoPhotoReturnId),
    ];
    const storeIds = [seededId(konsiStoreId)];
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.fieldReturnResolution.deleteMany({ where: { line: { returnId: { in: returnIds } } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  it("accepts an ADMIN return with no nota photo and no transport", async () => {
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(adminNoPhotoReturnId) } });
    expect(row.origin).toBe("ADMIN");
    expect(row.transport).toBeNull();
    expect(row.notaPhotoUrl).toBeNull();
    expect(row.notaPhotoR2Key).toBeNull();
  });

  it("still REFUSES a FIELD return with no nota photo — in the writer, not the form", async () => {
    await expect(
      createFieldReturn({
        storeId: konsiStoreId,
        raisedById,
        transport: "SELF_CARRY",
        lines: [{ itemId: itemFieldNoDecrementId, variantSku: "", qty: 1, reason: "UNSOLD" }],
      } as never)
    ).rejects.toMatchObject({ code: "MISSING_NOTA_PHOTO" });
  });

  it("still REFUSES a FIELD return with no transport — in the writer, not the form", async () => {
    await expect(
      createFieldReturn({
        storeId: konsiStoreId,
        raisedById,
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
        lines: [{ itemId: itemFieldNoDecrementId, variantSku: "", qty: 1, reason: "UNSOLD" }],
      } as never)
    ).rejects.toMatchObject({ code: "MISSING_TRANSPORT" });
  });

  it("decrements StoreStock at RECEIPT for an ADMIN return, by receivedQty", async () => {
    const ss = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(itemAdminReceiptId) },
    });
    expect(Number(ss.qty)).toBe(5); /* seeded 10, received 5 */
  });

  it("does NOT decrement at receipt for a FIELD return", async () => {
    const ss = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(itemFieldNoDecrementId) },
    });
    expect(Number(ss.qty)).toBe(10); /* unchanged — FIELD only decrements at approve */
  });

  it("decrements exactly ONCE in total on a clean ADMIN count", async () => {
    await approveFieldReturn({ returnId: adminCleanReturnId, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(itemAdminCleanId) },
    });
    /* seeded 10, raised 4, received 4 -> 6. A double-decrement bug (full at receipt AND full
       at approve) would leave this at 2. */
    expect(Number(ss.qty)).toBe(6);
  });

  it("decrements fully for a FIELD return at approve", async () => {
    await approveFieldReturn({ returnId: fieldNoDecrementReturnId, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(itemFieldNoDecrementId) },
    });
    expect(Number(ss.qty)).toBe(5); /* seeded 10, credited 5, all at approve since FIELD never decrements at receipt */
  });

  it("applies only the delta at approve when resolution credited more than arrived", async () => {
    const beforeApprove = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(itemAdminDeltaId) },
    });
    expect(Number(beforeApprove.qty)).toBe(6); /* seeded 10, received 4 at receipt */

    await approveFieldReturn({ returnId: adminDeltaReturnId, approvedById: adminId });
    const afterApprove = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(itemAdminDeltaId) },
    });
    /* creditedQty (claimed, via WRITE_OFF) is 6, receivedQty is 4 -> delta 2. 6 (post-receipt) - 2 = 4.
       Total decrement over the return's life is 4 (receipt) + 2 (approve delta) = 6 = creditedQty. */
    expect(Number(afterApprove.qty)).toBe(4);
  });

  it("refuses SALESMAN_BEARS on an ADMIN return", async () => {
    await expect(
      resolveFieldReturnLine({ lineId: adminSalesmanBearsLineId, type: "SALESMAN_BEARS", createdById: adminId })
    ).rejects.toMatchObject({ code: "SALESMAN_BEARS_NOT_ALLOWED" });
    const resolutions = await prisma.fieldReturnResolution.findMany({
      where: { lineId: seededId(adminSalesmanBearsLineId) },
    });
    expect(resolutions).toHaveLength(0);
  });

  it("accepts a return against an already-negative StoreStock row", async () => {
    const ss = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(itemAdminNegativeId) },
    });
    /* seeded -3, received 5 -> -8. The row was already negative before this return; the
       receipt-time decrement must never refuse on that account. */
    expect(Number(ss.qty)).toBe(-8);
  });
});
