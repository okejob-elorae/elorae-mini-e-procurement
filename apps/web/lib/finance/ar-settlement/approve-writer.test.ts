import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recordPayment } from "@/lib/finance/ar/payment-writer";
import { voidPayment } from "@/lib/finance/ar/void-writer";
import { approveSettlement } from "./approve-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

type DeductionRow = {
  type: "RETUR_OFFSET" | "PROGRAM" | "ADMIN_FEE";
  amount: number;
  percent?: number;
  fieldReturnId?: string;
  proofUrl?: string;
  proofR2Key?: string;
};

d("approveSettlement (test bed only)", () => {
  /*
   * Regenerated per test, not once per describe — Store.code / FieldSalesOrder.orderNo /
   * FieldSalesDelivery.docNo / FieldReturn.docNo / StoreSettlement.docNo are all @unique on this
   * token. A single leaked afterEach (fixture ids stay "" on a hook failure, so the teardown
   * deletes nothing) would otherwise make every remaining test in this file fail with P2002 on
   * the shared bed.
   */
  let token = "";
  let storeId = "";
  let storeOtherId = "";
  let salesmanId = "";
  let approverId = "";
  let itemId = "";
  let uomId = "";
  let retId = "";
  let retSmallId = "";
  let retNotApprovedId = "";
  let recA = "";
  let recB = "";
  let recSmall = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let settlementIds: string[] = [];
  let settlementSeq = 0;

  /* Creates one order -> delivery -> receivable chain and tracks the parent ids for teardown. */
  async function seedReceivable(label: string, amount: number, dueDate: Date): Promise<string> {
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-APV-ORD-${label}-${token}`,
        storeId,
        salesmanId,
        subtotal: amount,
        total: amount,
      },
    });
    orderIds.push(order.id);

    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-APV-DLV-${label}-${token}`,
        orderId: order.id,
        deliveredAt: new Date("2026-05-01T00:00:00.000+07:00"),
        deliveredById: salesmanId,
        invoiceDate: new Date("2026-05-01T00:00:00.000+07:00"),
        dueDate,
        subtotal: amount,
        total: amount,
      },
    });
    deliveryIds.push(delivery.id);

    const receivable = await prisma.receivable.create({
      data: {
        deliveryId: delivery.id,
        storeId,
        invoiceDate: new Date("2026-05-01T00:00:00.000+07:00"),
        dueDate,
        originalAmount: amount,
        outstandingAmount: amount,
        status: "OUTSTANDING",
      },
    });
    return receivable.id;
  }

  /**
   * Creates the settlement DIRECTLY rather than through `submitSettlement`, on purpose: the
   * approve writer is an independently callable endpoint, and several cases below (a retur
   * over-claimed across two deduction rows, an invoice claim smaller than its live balance) are
   * exactly the states submit refuses but a raw row can still hold.
   */
  async function createSettlement(args: {
    invoices: Array<{ receivableId: string; amount: number }>;
    deductions?: DeductionRow[];
    actualAmount: number;
    expectedAmount: number;
    status?: "PENDING" | "APPROVED" | "REJECTED";
  }): Promise<string> {
    settlementSeq += 1;
    const settlement = await prisma.storeSettlement.create({
      data: {
        docNo: `TEST-APV-BKM-${token}-${settlementSeq}`,
        storeId,
        salesmanId,
        expectedAmount: args.expectedAmount,
        actualAmount: args.actualAmount,
        varianceAmount: args.actualAmount - args.expectedAmount,
        isFlagged: args.actualAmount !== args.expectedAmount,
        status: args.status ?? "PENDING",
        invoices: { create: args.invoices },
        deductions: {
          create: (args.deductions ?? []).map((deduction) => ({
            type: deduction.type,
            amount: deduction.amount,
            percent: deduction.percent ?? null,
            fieldReturnId: deduction.fieldReturnId ?? null,
            proofUrl: deduction.proofUrl ?? null,
            proofR2Key: deduction.proofR2Key ?? null,
          })),
        },
      },
      select: { id: true },
    });
    settlementIds.push(settlement.id);
    return settlement.id;
  }

  function evidencedDeduction(
    type: "PROGRAM" | "ADMIN_FEE",
    amount: number,
    percent?: number,
  ): DeductionRow {
    const slug = `${type.toLowerCase()}-${amount}-${percent ?? 0}`;
    return {
      type,
      amount,
      percent,
      proofUrl: `https://cdn.test.local/settlement-proofs/${token}/${slug}`,
      proofR2Key: `settlement-proofs/${token}/${slug}`,
    };
  }

  async function paymentsForStore() {
    return prisma.payment.findMany({
      where: { storeId: seededId(storeId) },
      select: { id: true, method: true, amount: true, status: true, idempotencyKey: true, fieldReturnId: true },
      orderBy: { createdAt: "asc" },
    });
  }

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; storeOtherId = "";
    salesmanId = ""; approverId = "";
    itemId = ""; uomId = "";
    retId = ""; retSmallId = ""; retNotApprovedId = "";
    recA = ""; recB = ""; recSmall = "";
    orderIds = []; deliveryIds = []; settlementIds = [];
    settlementSeq = 0;

    const store = await prisma.store.create({
      data: { code: `TEST-APV-${token}`, name: `Toko ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;

    const storeOther = await prisma.store.create({
      data: { code: `TEST-APV-OTH-${token}`, name: `Toko Lain ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeOtherId = storeOther.id;

    const salesman = await prisma.user.create({
      data: { email: `apv-sales-${token}@test.local`, name: `Sales ${token}` },
    });
    salesmanId = salesman.id;
    const approver = await prisma.user.create({
      data: { email: `apv-fin-${token}@test.local`, name: `Finance ${token}` },
    });
    approverId = approver.id;

    const uom = await prisma.uOM.create({ data: { code: `TEST-APV-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-APV-ITEM-${token}`, nameId: "Retur item", nameEn: "Retur item", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;

    /* recA is the OLDER invoice — oldest-due-first allocation must reach it before recB. */
    recA = await seedReceivable("A", 1000, new Date("2026-06-01T00:00:00.000+07:00"));
    recB = await seedReceivable("B", 500, new Date("2026-07-01T00:00:00.000+07:00"));
    recSmall = await seedReceivable("SMALL", 100, new Date("2026-06-15T00:00:00.000+07:00"));

    const fieldReturn = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-APV-RET-${token}`, storeId, raisedById: salesmanId,
        status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE",
        totalValue: 300, appliedValue: 0,
        lines: { create: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }] },
      },
    });
    retId = fieldReturn.id;

    /* Only 100 of headroom — two 100 draws against it exhaust it on the second. */
    const retSmall = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-APV-RETS-${token}`, storeId, raisedById: salesmanId,
        status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE",
        totalValue: 100, appliedValue: 0,
        lines: { create: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }] },
      },
    });
    retSmallId = retSmall.id;

    const retNotApproved = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-APV-RETNA-${token}`, storeId, raisedById: salesmanId,
        status: "PENDING_APPROVAL", valuationStatus: "VALUED", offsetStatus: "AVAILABLE",
        totalValue: 300, appliedValue: 0,
        lines: { create: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }] },
      },
    });
    retNotApprovedId = retNotApproved.id;
  });

  afterEach(async () => {
    /*
     * Payments (and their allocations) come out FIRST: PaymentAllocation points at Receivable
     * with no onDelete override, so deleting a receivable underneath a live allocation is refused.
     */
    const payments = await prisma.payment.findMany({
      where: { storeId: { in: [seededId(storeId), seededId(storeOtherId)] } },
      select: { id: true },
    });
    const paymentIds = payments.map((payment) => payment.id);
    await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });

    await prisma.auditLog.deleteMany({ where: { userId: seededId(approverId) } });

    const ids = settlementIds.map(seededId);
    await prisma.storeSettlementDeduction.deleteMany({ where: { settlementId: { in: ids } } });
    await prisma.storeSettlementInvoice.deleteMany({ where: { settlementId: { in: ids } } });
    await prisma.storeSettlement.deleteMany({ where: { id: { in: ids } } });

    const returIds = [seededId(retId), seededId(retSmallId), seededId(retNotApprovedId)];
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returIds } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });

    await prisma.receivable.deleteMany({
      where: { id: { in: [recA, recB, recSmall].map(seededId) } },
    });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds.map(seededId) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds.map(seededId) } } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(salesmanId), seededId(approverId)] } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(storeOtherId)] } } });
  });

  it("resumes after a partial failure without double-paying", async () => {
    /**
     * The test this task exists for. The CASH component is posted BY HAND under the exact
     * deterministic key the writer itself would use, so the writer must recognise it, skip it, and
     * post only the trade-program component that a crash left behind. A resume test that lets the
     * writer create both payments proves nothing about resumability.
     */
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [evidencedDeduction("PROGRAM", 200)],
      actualAmount: 800,
      expectedAmount: 800,
    });

    const handPosted = await recordPayment({
      storeId,
      paidAt: new Date(),
      method: "CASH",
      amount: 800,
      recordedById: approverId,
      allocations: [{ receivableId: recA, amount: 800 }],
      idempotencyKey: `settlement-${settlementId}-CASH`,
    });

    const before = await prisma.receivable.findUnique({ where: { id: recA } });
    expect(Number(before!.outstandingAmount)).toBe(200);

    const result = await approveSettlement({ settlementId, approvedById: approverId });

    expect(result.ok).toBe(true);
    expect(result.paymentIds).toContain(handPosted.paymentId);
    expect(result.paymentIds).toHaveLength(2);

    const payments = await paymentsForStore();
    expect(payments.filter((payment) => payment.method === "CASH")).toHaveLength(1);
    expect(payments.filter((payment) => payment.method === "PROGRAM_DEDUCTION")).toHaveLength(1);
    expect(payments).toHaveLength(2);

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("APPROVED");
    expect(settlement!.reviewedById).toBe(approverId);
    expect(settlement!.reviewedAt).not.toBeNull();

    const after = await prisma.receivable.findUnique({ where: { id: recA } });
    expect(Number(after!.outstandingAmount)).toBe(0);
    expect(after!.status).toBe("PAID");
  });

  it("posts one payment per non-zero component and leaves none for a zero one", async () => {
    /*
     * invoiceTotal 1000 - retur 100 - program 100 = adminFeeBase 800; a 0% admin fee is 0, so the
     * ADMIN_FEE component must post nothing at all. expected = 800 = actualAmount.
     */
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [
        { type: "RETUR_OFFSET", amount: 100, fieldReturnId: retId },
        evidencedDeduction("PROGRAM", 100),
        evidencedDeduction("ADMIN_FEE", 0, 0),
      ],
      actualAmount: 800,
      expectedAmount: 800,
    });

    const result = await approveSettlement({ settlementId, approvedById: approverId });
    expect(result.paymentIds).toHaveLength(3);

    const payments = await paymentsForStore();
    const methods = payments.map((payment) => payment.method).sort();
    expect(methods).toEqual(["CASH", "PROGRAM_DEDUCTION", "RETUR_OFFSET"]);
    expect(payments.some((payment) => payment.method === "ADMIN_FEE")).toBe(false);

    const receivable = await prisma.receivable.findUnique({ where: { id: recA } });
    expect(Number(receivable!.outstandingAmount)).toBe(0);
  });

  it("charges the admin fee on the netted base and posts it as its own component", async () => {
    /*
     * invoiceTotal 1000 - program 200 = adminFeeBase 800; a 5% fee is 40 on the NETTED base, not
     * 50 on the gross. expected = 760.
     */
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [evidencedDeduction("PROGRAM", 200), evidencedDeduction("ADMIN_FEE", 40, 5)],
      actualAmount: 760,
      expectedAmount: 760,
    });

    await approveSettlement({ settlementId, approvedById: approverId });

    const payments = await paymentsForStore();
    const fee = payments.find((payment) => payment.method === "ADMIN_FEE");
    expect(fee).toBeDefined();
    expect(Number(fee!.amount)).toBe(40);
    expect(fee!.idempotencyKey).toBe(`settlement-${settlementId}-ADMIN_FEE`);
  });

  it("clears the receivable's outstanding through recordPayment, not by hand", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 1000,
      expectedAmount: 1000,
    });

    const result = await approveSettlement({ settlementId, approvedById: approverId });

    const receivable = await prisma.receivable.findUnique({ where: { id: recA } });
    expect(Number(receivable!.paidAmount)).toBe(1000);
    expect(Number(receivable!.outstandingAmount)).toBe(0);
    expect(receivable!.status).toBe("PAID");

    /* The allocation row is what proves the decrement came from recordPayment's own path. */
    const allocations = await prisma.paymentAllocation.findMany({
      where: { paymentId: { in: result.paymentIds } },
      select: { receivableId: true, amount: true },
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0].receivableId).toBe(recA);
    expect(Number(allocations[0].amount)).toBe(1000);
  });

  it("flips to APPROVED only after every component has posted", async () => {
    /**
     * Two retur draws of 100 against a retur holding only 100 of value. The invoice-side pre-flight
     * cannot see that — the invoice has plenty of headroom — so the first draw posts and the SECOND
     * dies inside `recordPayment`'s own retur ceiling. The settlement must be left `PENDING` with
     * one real payment behind it, which is precisely the resumable state the design promises: a
     * settlement reading `APPROVED` means every component committed.
     */
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [
        { type: "RETUR_OFFSET", amount: 100, fieldReturnId: retSmallId },
        { type: "RETUR_OFFSET", amount: 100, fieldReturnId: retSmallId },
      ],
      actualAmount: 800,
      expectedAmount: 800,
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "EXCEEDS_REMAINING",
    });

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("PENDING");
    expect(settlement!.reviewedAt).toBeNull();

    const payments = await paymentsForStore();
    expect(payments).toHaveLength(1);
    expect(payments[0].method).toBe("RETUR_OFFSET");
    expect(payments.some((payment) => payment.method === "CASH")).toBe(false);
  });

  it("is idempotent — re-approving posts nothing new and returns the same payments", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [evidencedDeduction("PROGRAM", 200)],
      actualAmount: 800,
      expectedAmount: 800,
    });

    const first = await approveSettlement({ settlementId, approvedById: approverId });
    expect(first.alreadyApproved).toBeUndefined();

    const second = await approveSettlement({ settlementId, approvedById: approverId });
    expect(second.alreadyApproved).toBe(true);
    expect([...second.paymentIds].sort()).toEqual([...first.paymentIds].sort());

    const payments = await paymentsForStore();
    expect(payments).toHaveLength(2);

    const receivable = await prisma.receivable.findUnique({ where: { id: recA } });
    expect(Number(receivable!.outstandingAmount)).toBe(0);
  });

  it("draws the retur through applyReturnOffset keyed on the deduction row id", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [{ type: "RETUR_OFFSET", amount: 300, fieldReturnId: retId }],
      actualAmount: 700,
      expectedAmount: 700,
    });

    const deduction = await prisma.storeSettlementDeduction.findFirst({
      where: { settlementId, type: "RETUR_OFFSET" },
      select: { id: true },
    });

    await approveSettlement({ settlementId, approvedById: approverId });

    const draw = await prisma.payment.findUnique({
      where: { idempotencyKey: `returoffset-${retId}-${deduction!.id}` },
      select: { method: true, amount: true, fieldReturnId: true, status: true },
    });
    expect(draw).not.toBeNull();
    expect(draw!.method).toBe("RETUR_OFFSET");
    expect(Number(draw!.amount)).toBe(300);
    expect(draw!.fieldReturnId).toBe(retId);
    expect(draw!.status).toBe("POSTED");

    /* projectReturnOffset ran: appliedValue is the SET projection of the posted draws. */
    const fieldReturn = await prisma.fieldReturn.findUnique({ where: { id: retId } });
    expect(Number(fieldReturn!.appliedValue)).toBe(300);
    expect(fieldReturn!.offsetStatus).toBe("APPLIED");
  });

  it("refuses a non-zero variance without an override reason", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 900,
      expectedAmount: 1000,
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "VARIANCE_REQUIRES_REASON",
    });

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("PENDING");
    expect(await paymentsForStore()).toHaveLength(0);
  });

  it("refuses an override reason made only of invisible characters", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 900,
      expectedAmount: 1000,
    });

    await expect(
      approveSettlement({ settlementId, approvedById: approverId, overrideReason: "\u200B \u2800" }),
    ).rejects.toMatchObject({ code: "VARIANCE_REQUIRES_REASON" });
  });

  it("accepts a non-zero variance WITH an override reason and records it", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 900,
      expectedAmount: 1000,
    });

    const result = await approveSettlement({
      settlementId,
      approvedById: approverId,
      overrideReason: "Toko kurang bayar 100, disetujui kepala keuangan",
    });
    expect(result.paymentIds).toHaveLength(1);

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("APPROVED");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "StoreSettlement", entityId: settlementId, action: "SETTLEMENT_VARIANCE_OVERRIDE" },
      select: { reason: true, userId: true },
    });
    expect(audit).not.toBeNull();
    expect(audit!.reason).toBe("Toko kurang bayar 100, disetujui kepala keuangan");
    expect(audit!.userId).toBe(approverId);
  });

  it("records no override audit row when the variance is zero", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 1000,
      expectedAmount: 1000,
    });

    await approveSettlement({
      settlementId,
      approvedById: approverId,
      overrideReason: "tidak diperlukan",
    });

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "StoreSettlement", entityId: settlementId },
    });
    expect(audit).toBeNull();
  });

  it("refuses a settlement that is not PENDING", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 1000,
      expectedAmount: 1000,
      status: "REJECTED",
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "NOT_PENDING",
    });
    expect(await paymentsForStore()).toHaveLength(0);
  });

  it("refuses when a linked retur is no longer APPROVED", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [{ type: "RETUR_OFFSET", amount: 100, fieldReturnId: retNotApprovedId }],
      actualAmount: 900,
      expectedAmount: 900,
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "RETURN_NOT_APPROVED",
    });

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("PENDING");
    expect(await paymentsForStore()).toHaveLength(0);
  });

  it("refuses when a deduction lost its evidence after submission", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [{ type: "PROGRAM", amount: 200 }],
      actualAmount: 800,
      expectedAmount: 800,
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "MISSING_EVIDENCE",
    });
    expect(await paymentsForStore()).toHaveLength(0);
  });

  it("refuses when a selected receivable was settled elsewhere before approval", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 1000,
      expectedAmount: 1000,
    });

    await prisma.receivable.update({
      where: { id: recA },
      data: { outstandingAmount: 0, paidAmount: 1000, status: "PAID" },
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "NOT_OUTSTANDING",
    });
    expect(await paymentsForStore()).toHaveLength(0);
  });

  it("leaves AR partially settled when the store underpaid", async () => {
    /*
     * invoiceTotal 1000 - program 100 = expected 900, but the store handed over 700. Components sum
     * to 800, so exactly 200 must be left outstanding — an underpayment is the correct outcome
     * here, not an error.
     */
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [evidencedDeduction("PROGRAM", 100)],
      actualAmount: 700,
      expectedAmount: 900,
    });

    await approveSettlement({
      settlementId,
      approvedById: approverId,
      overrideReason: "Sisa ditagih minggu depan",
    });

    const receivable = await prisma.receivable.findUnique({ where: { id: recA } });
    expect(Number(receivable!.paidAmount)).toBe(800);
    expect(Number(receivable!.outstandingAmount)).toBe(200);
    expect(receivable!.status).toBe("PARTIAL");
  });

  it("recomputes the headroom between components instead of snapshotting it once", async () => {
    /**
     * The failure this guards: two components each equal to the OLDEST invoice's full balance. A
     * headroom snapshotted once up front hands both of them recA, and the second `recordPayment`
     * dies on `OVER_ALLOCATED` with the first already committed. Recomputed per component, the
     * trade-program deduction takes recA and the cash spills into recB.
     */
    const settlementId = await createSettlement({
      invoices: [
        { receivableId: recA, amount: 500 },
        { receivableId: recB, amount: 500 },
      ],
      deductions: [evidencedDeduction("PROGRAM", 500)],
      actualAmount: 500,
      expectedAmount: 500,
    });

    const result = await approveSettlement({ settlementId, approvedById: approverId });
    expect(result.paymentIds).toHaveLength(2);

    const payments = await paymentsForStore();
    const program = payments.find((payment) => payment.method === "PROGRAM_DEDUCTION");
    const cash = payments.find((payment) => payment.method === "CASH");
    expect(program).toBeDefined();
    expect(cash).toBeDefined();

    const programAllocations = await prisma.paymentAllocation.findMany({
      where: { paymentId: program!.id },
      select: { receivableId: true, amount: true },
    });
    expect(programAllocations).toHaveLength(1);
    expect(programAllocations[0].receivableId).toBe(recA);
    expect(Number(programAllocations[0].amount)).toBe(500);

    const cashAllocations = await prisma.paymentAllocation.findMany({
      where: { paymentId: cash!.id },
      select: { receivableId: true, amount: true },
    });
    expect(cashAllocations).toHaveLength(1);
    expect(cashAllocations[0].receivableId).toBe(recB);
    expect(Number(cashAllocations[0].amount)).toBe(500);

    const settledA = await prisma.receivable.findUnique({ where: { id: recA } });
    const settledB = await prisma.receivable.findUnique({ where: { id: recB } });
    expect(Number(settledA!.outstandingAmount)).toBe(500);
    expect(Number(settledB!.outstandingAmount)).toBe(0);
  });

  it("caps each invoice at the amount the store agreed to settle, not its live balance", async () => {
    /**
     * recA still owes 1000 but this document claims only 400 of it. Without the
     * `StoreSettlementInvoice.amount` cap the 800 cash tender would drain recA alone, settling
     * more of an invoice than the store ever agreed to at the counter.
     */
    const settlementId = await createSettlement({
      invoices: [
        { receivableId: recA, amount: 400 },
        { receivableId: recB, amount: 400 },
      ],
      actualAmount: 800,
      expectedAmount: 800,
    });

    const result = await approveSettlement({ settlementId, approvedById: approverId });
    expect(result.paymentIds).toHaveLength(1);

    const allocations = await prisma.paymentAllocation.findMany({
      where: { paymentId: result.paymentIds[0] },
      select: { receivableId: true, amount: true },
    });
    const byReceivable = new Map(allocations.map((a) => [a.receivableId, Number(a.amount)]));
    expect(byReceivable.get(recA)).toBe(400);
    expect(byReceivable.get(recB)).toBe(400);

    const settledA = await prisma.receivable.findUnique({ where: { id: recA } });
    expect(Number(settledA!.outstandingAmount)).toBe(600);
    expect(settledA!.status).toBe("PARTIAL");
  });

  it("refuses before moving any money when the components exceed the invoice headroom", async () => {
    /*
     * A 100 invoice cannot absorb a 100 program deduction AND a 100 cash tender. The refusal must
     * land before the first component posts, not halfway through.
     */
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recSmall, amount: 100 }],
      deductions: [evidencedDeduction("PROGRAM", 100)],
      actualAmount: 100,
      expectedAmount: 0,
    });

    await expect(
      approveSettlement({ settlementId, approvedById: approverId, overrideReason: "kelebihan setor" }),
    ).rejects.toMatchObject({ code: "COMPONENT_EXCEEDS_HEADROOM" });

    expect(await paymentsForStore()).toHaveLength(0);
    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("PENDING");
  });

  it("refuses to resume onto a component payment that was voided", async () => {
    /**
     * `recordPayment`'s own idempotency lookup would hand a VOIDED row straight back and report
     * success for a component that moved no money — the cash/program/fee twin of
     * `applyReturnOffset`'s own `PAYMENT_VOIDED` guard.
     */
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 1000,
      expectedAmount: 1000,
    });

    const handPosted = await recordPayment({
      storeId,
      paidAt: new Date(),
      method: "CASH",
      amount: 1000,
      recordedById: approverId,
      allocations: [{ receivableId: recA, amount: 1000 }],
      idempotencyKey: `settlement-${settlementId}-CASH`,
    });
    await voidPayment({ paymentId: handPosted.paymentId, reason: "salah input", voidedById: approverId });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "COMPONENT_VOIDED",
    });

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("PENDING");
  });

  it("refuses an unknown settlement", async () => {
    await expect(
      approveSettlement({ settlementId: "does-not-exist", approvedById: approverId }),
    ).rejects.toMatchObject({ code: "SETTLEMENT_NOT_FOUND" });
  });

  it("refuses an approver that is not a real user", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 1000,
      expectedAmount: 1000,
    });

    await expect(
      approveSettlement({ settlementId, approvedById: "no-such-user" }),
    ).rejects.toMatchObject({ code: "APPROVER_NOT_FOUND" });
    expect(await paymentsForStore()).toHaveLength(0);
  });
});
