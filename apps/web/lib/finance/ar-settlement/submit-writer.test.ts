import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { submitSettlement, type SubmitSettlementInput } from "./submit-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("submitSettlement (test bed only)", () => {
  /*
   * Regenerated per test, not once per describe — Store.code / FieldSalesOrder.orderNo /
   * FieldSalesDelivery.docNo / FieldReturn.docNo are all @unique on this token. A single leaked
   * afterEach (fixture ids stay "" on a hook failure, so the teardown deletes nothing) would
   * otherwise make every remaining test in this file fail with P2002 on the shared bed.
   */
  let token = "";
  let storeId = "";
  let storeOtherId = "";
  let salesmanAId = "";
  let salesmanBId = "";
  let itemId = "";
  let uomId = "";
  let retId = "";
  let retNotApprovedId = "";
  let retNotValuedId = "";
  let retWrongStoreId = "";
  let recA = "";
  let recB = "";
  let recWrongStore = "";
  let recPaid = "";
  let recWrittenOff = "";
  let recSmall = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let baseInput: SubmitSettlementInput;
  let otherInput: SubmitSettlementInput;

  function returDeduction(amount: number, fieldReturnId = retId) {
    return { type: "RETUR_OFFSET" as const, amount, fieldReturnId };
  }

  /* Creates one order -> delivery -> receivable chain and tracks the parent ids for teardown. */
  async function seedReceivable(
    label: string,
    amount: number,
    status: "OUTSTANDING" | "PARTIAL" | "PAID" | "WRITTEN_OFF" = "OUTSTANDING",
    receivableStoreId: string = storeId,
  ): Promise<string> {
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-STL-ORD-${label}-${token}`,
        storeId: receivableStoreId,
        salesmanId: salesmanAId,
        subtotal: amount,
        total: amount,
      },
    });
    orderIds.push(order.id);

    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-STL-DLV-${label}-${token}`,
        orderId: order.id,
        deliveredAt: new Date("2026-05-01T00:00:00.000+07:00"),
        deliveredById: salesmanAId,
        invoiceDate: new Date("2026-05-01T00:00:00.000+07:00"),
        dueDate: new Date("2026-06-01T00:00:00.000+07:00"),
        subtotal: amount,
        total: amount,
      },
    });
    deliveryIds.push(delivery.id);

    const outstandingAmount = status === "PAID" || status === "WRITTEN_OFF" ? 0 : amount;
    const receivable = await prisma.receivable.create({
      data: {
        deliveryId: delivery.id,
        storeId: receivableStoreId,
        invoiceDate: new Date("2026-05-01T00:00:00.000+07:00"),
        dueDate: new Date("2026-06-01T00:00:00.000+07:00"),
        originalAmount: amount,
        outstandingAmount,
        status,
      },
    });
    return receivable.id;
  }

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; storeOtherId = "";
    salesmanAId = ""; salesmanBId = "";
    itemId = ""; uomId = "";
    retId = ""; retNotApprovedId = ""; retNotValuedId = ""; retWrongStoreId = "";
    recA = ""; recB = ""; recWrongStore = ""; recPaid = ""; recWrittenOff = ""; recSmall = "";
    orderIds = []; deliveryIds = [];

    const store = await prisma.store.create({
      data: { code: `TEST-STL-${token}`, name: `Toko ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;

    const storeOther = await prisma.store.create({
      data: { code: `TEST-STL-OTH-${token}`, name: `Toko Lain ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeOtherId = storeOther.id;

    const salesmanA = await prisma.user.create({ data: { email: `stl-a-${token}@test.local`, name: `Sales A ${token}` } });
    salesmanAId = salesmanA.id;
    const salesmanB = await prisma.user.create({ data: { email: `stl-b-${token}@test.local`, name: `Sales B ${token}` } });
    salesmanBId = salesmanB.id;

    const uom = await prisma.uOM.create({ data: { code: `TEST-STL-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-STL-ITEM-${token}`, nameId: "Retur item", nameEn: "Retur item", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;

    recA = await seedReceivable("A", 1000);
    recB = await seedReceivable("B", 1000);
    recWrongStore = await seedReceivable("WRONG", 500, "OUTSTANDING", storeOtherId);
    recPaid = await seedReceivable("PAID", 400, "PAID");
    recWrittenOff = await seedReceivable("WO", 400, "WRITTEN_OFF");
    recSmall = await seedReceivable("SMALL", 100);

    /* The eligible retur: APPROVED + VALUED, 300 of headroom (totalValue 300, appliedValue 0). */
    const fieldReturn = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-STL-RET-${token}`, storeId, raisedById: salesmanAId,
        status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE",
        totalValue: 300, appliedValue: 0,
        lines: { create: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }] },
      },
    });
    retId = fieldReturn.id;

    const retNotApproved = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-STL-RETNA-${token}`, storeId, raisedById: salesmanAId,
        status: "PENDING_APPROVAL", valuationStatus: "VALUED", offsetStatus: "AVAILABLE",
        totalValue: 300, appliedValue: 0,
        lines: { create: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }] },
      },
    });
    retNotApprovedId = retNotApproved.id;

    const retNotValued = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-STL-RETNV-${token}`, storeId, raisedById: salesmanAId,
        status: "APPROVED", valuationStatus: "PENDING", offsetStatus: "AVAILABLE",
        lines: { create: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }] },
      },
    });
    retNotValuedId = retNotValued.id;

    const retWrongStore = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-STL-RETWS-${token}`, storeId: storeOtherId, raisedById: salesmanAId,
        status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE",
        totalValue: 300, appliedValue: 0,
        lines: { create: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }] },
      },
    });
    retWrongStoreId = retWrongStore.id;

    baseInput = {
      draftId: `base-${token}`,
      storeId,
      salesmanId: salesmanAId,
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [],
      actualAmount: 1000,
    };
    otherInput = {
      draftId: `other-${token}`,
      storeId,
      salesmanId: salesmanBId,
      invoices: [{ receivableId: recB, amount: 1000 }],
      deductions: [],
      actualAmount: 1000,
    };
  });

  afterEach(async () => {
    const settlements = await prisma.storeSettlement.findMany({
      where: { storeId: { in: [seededId(storeId), seededId(storeOtherId)] } },
      select: { id: true },
    });
    const settlementIds = settlements.map((s) => s.id);
    await prisma.storeSettlementDeduction.deleteMany({ where: { settlementId: { in: settlementIds } } });
    await prisma.storeSettlementInvoice.deleteMany({ where: { settlementId: { in: settlementIds } } });
    await prisma.storeSettlement.deleteMany({ where: { id: { in: settlementIds } } });

    const returIds = [
      seededId(retId), seededId(retNotApprovedId), seededId(retNotValuedId), seededId(retWrongStoreId),
    ];
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returIds } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });

    await prisma.receivable.deleteMany({
      where: { id: { in: [recA, recB, recWrongStore, recPaid, recWrittenOff, recSmall].map(seededId) } },
    });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds.map(seededId) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds.map(seededId) } } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(salesmanAId), seededId(salesmanBId)] } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(storeOtherId)] } } });
  });

  it("creates a PENDING settlement with a BKM document number", async () => {
    const result = await submitSettlement({
      ...baseInput,
      draftId: `create-${token}`,
      deductions: [
        returDeduction(100),
        { type: "PROGRAM", amount: 100, proofUrl: "u1", proofR2Key: "k1" },
        { type: "ADMIN_FEE", percent: 5, proofUrl: "u2", proofR2Key: "k2" },
      ],
      actualAmount: 760,
    });

    expect(result.settlementId).toBeTruthy();
    expect(result.docNo).toMatch(/^BKM\//);
    expect(result.alreadySubmitted).toBeUndefined();

    const settlement = await prisma.storeSettlement.findUnique({
      where: { id: result.settlementId },
      include: { invoices: true, deductions: true },
    });
    expect(settlement).not.toBeNull();
    expect(settlement!.status).toBe("PENDING");
    /* invoiceTotal 1000 - returTotal 100 - programTotal 100 = adminFeeBase 800; 5% fee = 40;
     * expected = 800 - 40 = 760. */
    expect(Number(settlement!.expectedAmount)).toBe(760);
    expect(Number(settlement!.actualAmount)).toBe(760);
    expect(Number(settlement!.varianceAmount)).toBe(0);
    expect(settlement!.isFlagged).toBe(false);
    expect(settlement!.invoices).toHaveLength(1);
    expect(Number(settlement!.invoices[0].amount)).toBe(1000);
    expect(settlement!.deductions).toHaveLength(3);

    const adminFeeRow = settlement!.deductions.find((row) => row.type === "ADMIN_FEE");
    expect(Number(adminFeeRow!.amount)).toBe(40);
    expect(Number(adminFeeRow!.percent)).toBe(5);

    const returRow = settlement!.deductions.find((row) => row.type === "RETUR_OFFSET");
    expect(returRow!.fieldReturnId).toBe(retId);
    expect(Number(returRow!.amount)).toBe(100);
  });

  it("flags a settlement when actualAmount differs from the computed expected", async () => {
    const result = await submitSettlement({ ...baseInput, draftId: `flag-${token}`, actualAmount: 950 });

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: result.settlementId } });
    expect(Number(settlement!.expectedAmount)).toBe(1000);
    expect(Number(settlement!.varianceAmount)).toBe(-50);
    expect(settlement!.isFlagged).toBe(true);
  });

  it("is idempotent on a replayed draftId", async () => {
    const input = { ...baseInput, draftId: `replay-${token}` };
    const first = await submitSettlement(input);
    const replay = await submitSettlement(input);
    expect(replay.settlementId).toBe(first.settlementId);
    expect(replay.alreadySubmitted).toBe(true);
    const count = await prisma.storeSettlement.count({ where: { storeId } });
    expect(count).toBe(1);
  });

  it("refuses a program deduction with no evidence", async () => {
    await expect(
      submitSettlement({ ...baseInput, draftId: `prog-${token}`, deductions: [{ type: "PROGRAM", amount: 100 }] }),
    ).rejects.toMatchObject({ code: "MISSING_EVIDENCE" });
  });

  it("refuses an admin fee with no evidence", async () => {
    await expect(
      submitSettlement({ ...baseInput, draftId: `fee-${token}`, deductions: [{ type: "ADMIN_FEE", percent: 5 }] }),
    ).rejects.toMatchObject({ code: "MISSING_EVIDENCE" });
  });

  it("accepts a retur offset with no upload, because it auto-links the retur's own nota", async () => {
    const result = await submitSettlement({
      ...baseInput, draftId: `noupload-${token}`, deductions: [returDeduction(50)], actualAmount: 950,
    });
    expect(result.settlementId).toBeTruthy();
  });

  it("refuses more than one admin fee", async () => {
    await expect(submitSettlement({ ...baseInput, draftId: `dupfee-${token}`, deductions: [
      { type: "ADMIN_FEE", percent: 5, proofUrl: "u", proofR2Key: "k" },
      { type: "ADMIN_FEE", percent: 5, proofUrl: "u2", proofR2Key: "k2" },
    ] })).rejects.toMatchObject({ code: "DUPLICATE_ADMIN_FEE" });
  });

  it("refuses a retur that is not APPROVED", async () => {
    await expect(
      submitSettlement({ ...baseInput, draftId: `notappr-${token}`, deductions: [returDeduction(50, retNotApprovedId)] }),
    ).rejects.toMatchObject({ code: "RETURN_NOT_APPROVED" });
  });

  it("refuses a retur that is not VALUED", async () => {
    await expect(
      submitSettlement({ ...baseInput, draftId: `notval-${token}`, deductions: [returDeduction(50, retNotValuedId)] }),
    ).rejects.toMatchObject({ code: "NOT_VALUED" });
  });

  it("refuses a retur belonging to a different store than the settlement", async () => {
    await expect(
      submitSettlement({ ...baseInput, draftId: `retwrongstore-${token}`, deductions: [returDeduction(50, retWrongStoreId)] }),
    ).rejects.toMatchObject({ code: "WRONG_STORE" });
  });

  it("refuses a receivable belonging to a different store", async () => {
    await expect(submitSettlement({
      ...baseInput, draftId: `wrongstore-${token}`, invoices: [{ receivableId: recWrongStore, amount: 500 }],
    })).rejects.toMatchObject({ code: "WRONG_STORE" });
  });

  it("refuses a PAID or WRITTEN_OFF receivable", async () => {
    await expect(submitSettlement({
      ...baseInput, draftId: `paid-${token}`, invoices: [{ receivableId: recPaid, amount: 400 }],
    })).rejects.toMatchObject({ code: "NOT_OUTSTANDING" });

    await expect(submitSettlement({
      ...baseInput, draftId: `wo-${token}`, invoices: [{ receivableId: recWrittenOff, amount: 400 }],
    })).rejects.toMatchObject({ code: "NOT_OUTSTANDING" });
  });

  it("refuses a receivable id that does not exist", async () => {
    await expect(submitSettlement({
      ...baseInput, draftId: `noreceivable-${token}`, invoices: [{ receivableId: `missing-${token}`, amount: 100 }],
    })).rejects.toMatchObject({ code: "RECEIVABLE_NOT_FOUND" });
  });

  it("refuses a fieldReturnId that does not exist", async () => {
    await expect(submitSettlement({
      ...baseInput, draftId: `noretur-${token}`, deductions: [returDeduction(50, `missing-${token}`)],
    })).rejects.toMatchObject({ code: "FIELD_RETURN_NOT_FOUND" });
  });

  it("refuses when deductions exceed the selected invoices", async () => {
    await expect(submitSettlement({
      ...baseInput,
      draftId: `exceed-${token}`,
      invoices: [{ receivableId: recSmall, amount: 100 }],
      deductions: [{ type: "PROGRAM", amount: 500, proofUrl: "u", proofR2Key: "k" }],
    })).rejects.toMatchObject({ code: "DEDUCTIONS_EXCEED_INVOICES" });
  });

  /*
   * The retur has 300 left. A first settlement claims 200 and stays PENDING. A second settlement
   * claiming 200 must be refused — 300 - 200 already claimed leaves 100.
   */
  it("nets a PENDING settlement's claim against the retur's remaining value", async () => {
    await submitSettlement({ ...baseInput, draftId: `d1-${token}`, deductions: [returDeduction(200)], actualAmount: 800 });
    await expect(
      submitSettlement({ ...otherInput, draftId: `d2-${token}`, deductions: [returDeduction(200)], actualAmount: 800 }),
    ).rejects.toMatchObject({ code: "RETUR_OVERCLAIMED" });
  });

  it("stops counting a REJECTED settlement's claim", async () => {
    await submitSettlement({ ...baseInput, draftId: `d1-${token}`, deductions: [returDeduction(200)], actualAmount: 800 });
    await prisma.storeSettlement.updateMany({ where: { idempotencyKey: `d1-${token}` }, data: { status: "REJECTED" } });
    /* the same 200 is claimable again now that the first claim is not PENDING */
    const second = await submitSettlement({ ...otherInput, draftId: `d2-${token}`, deductions: [returDeduction(200)], actualAmount: 800 });
    expect(second.settlementId).toBeTruthy();
  });
});
