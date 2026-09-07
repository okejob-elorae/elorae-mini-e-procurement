import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recordPayment } from "@/lib/finance/ar/payment-writer";
import { voidPayment } from "@/lib/finance/ar/void-writer";
import { approveSettlement } from "./approve-writer";
import { VARIANCE_TOLERANCE_SETTING_KEY } from "./variance-tolerance";

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
  let retWrongStoreId = "";
  let recA = "";
  let recB = "";
  let recSmall = "";
  let recOtherStore = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let settlementIds: string[] = [];
  let settlementSeq = 0;
  /**
   * `settlement.varianceToleranceRupiah` is a GLOBAL row shared with whatever the dev bed already
   * holds. Snapshot it and put it back — `parseVarianceTolerance` fails open, so an unconditional
   * delete would silently revert an operator's configured tolerance with nothing ever surfacing
   * the loss.
   */
  let toleranceSnapshot: string | null = null;

  /* Creates one order -> delivery -> receivable chain and tracks the parent ids for teardown. */
  async function seedReceivable(
    label: string,
    amount: number,
    dueDate: Date,
    receivableStoreId: string = storeId,
  ): Promise<string> {
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-APV-ORD-${label}-${token}`,
        storeId: receivableStoreId,
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
        storeId: receivableStoreId,
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
    retId = ""; retSmallId = ""; retNotApprovedId = ""; retWrongStoreId = "";
    recA = ""; recB = ""; recSmall = ""; recOtherStore = "";
    orderIds = []; deliveryIds = []; settlementIds = [];
    settlementSeq = 0;

    const existingTolerance = await prisma.systemSetting.findUnique({
      where: { key: VARIANCE_TOLERANCE_SETTING_KEY },
      select: { value: true },
    });
    toleranceSnapshot = existingTolerance?.value ?? null;

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
    recOtherStore = await seedReceivable("OTH", 500, new Date("2026-06-01T00:00:00.000+07:00"), storeOtherId);

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

    const retWrongStore = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-APV-RETWS-${token}`, storeId: storeOtherId, raisedById: salesmanId,
        status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE",
        totalValue: 300, appliedValue: 0,
        lines: { create: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }] },
      },
    });
    retWrongStoreId = retWrongStore.id;
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

    const returIds = [
      seededId(retId), seededId(retSmallId), seededId(retNotApprovedId), seededId(retWrongStoreId),
    ];
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returIds } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });

    await prisma.receivable.deleteMany({
      where: { id: { in: [recA, recB, recSmall, recOtherStore].map(seededId) } },
    });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds.map(seededId) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds.map(seededId) } } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(salesmanId), seededId(approverId)] } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(storeOtherId)] } } });

    if (toleranceSnapshot === null) {
      await prisma.systemSetting.deleteMany({ where: { key: VARIANCE_TOLERANCE_SETTING_KEY } });
    } else {
      await prisma.systemSetting.upsert({
        where: { key: VARIANCE_TOLERANCE_SETTING_KEY },
        create: { key: VARIANCE_TOLERANCE_SETTING_KEY, value: toleranceSnapshot },
        update: { value: toleranceSnapshot },
      });
    }
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
     * The state a crash BETWEEN components leaves behind, built by hand: the trade-program
     * component posted and closed `recA`, the cash component never ran, and the status flip — the
     * LAST write — never happened. A settlement in that state reads `PENDING`, which is the whole
     * point: `APPROVED` means every component committed.
     *
     * Resuming must then post only what is owed. The naive re-validation refuses here, because
     * `recSmall` is now `PAID` — by this settlement's own component — and the document could never
     * reach `APPROVED` again with 100 already moved.
     */
    const settlementId = await createSettlement({
      invoices: [
        { receivableId: recSmall, amount: 100 },
        { receivableId: recB, amount: 500 },
      ],
      deductions: [evidencedDeduction("PROGRAM", 100)],
      actualAmount: 500,
      expectedAmount: 500,
    });

    /* recSmall is the older invoice and its whole 100 balance is claimed, so this closes it. */
    const program = await recordPayment({
      storeId,
      paidAt: new Date(),
      method: "PROGRAM_DEDUCTION",
      amount: 100,
      recordedById: approverId,
      allocations: [{ receivableId: recSmall, amount: 100 }],
      idempotencyKey: `settlement-${settlementId}-PROGRAM_DEDUCTION`,
    });

    const midway = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(midway!.status).toBe("PENDING");
    expect(midway!.reviewedAt).toBeNull();
    const closedSmall = await prisma.receivable.findUnique({ where: { id: recSmall } });
    expect(closedSmall!.status).toBe("PAID");

    const result = await approveSettlement({ settlementId, approvedById: approverId });
    expect(result.paymentIds).toContain(program.paymentId);
    expect(result.paymentIds).toHaveLength(2);

    const payments = await paymentsForStore();
    expect(payments).toHaveLength(2);
    const cash = payments.find((payment) => payment.method === "CASH");
    expect(cash).toBeDefined();

    const cashAllocations = await prisma.paymentAllocation.findMany({
      where: { paymentId: cash!.id },
      select: { receivableId: true, amount: true },
    });
    expect(cashAllocations).toHaveLength(1);
    expect(cashAllocations[0].receivableId).toBe(recB);

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("APPROVED");
  });

  it("resumes when every component posted but the flip never committed", async () => {
    /**
     * The narrowest crash window there is: both components committed and the CAS `updateMany`
     * never ran. Every receivable this document names is now closed, so a re-validation that
     * checks collectibility unconditionally refuses forever. The retry must post nothing new and
     * simply flip.
     */
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [evidencedDeduction("PROGRAM", 200)],
      actualAmount: 800,
      expectedAmount: 800,
    });

    const program = await recordPayment({
      storeId, paidAt: new Date(), method: "PROGRAM_DEDUCTION", amount: 200,
      recordedById: approverId,
      allocations: [{ receivableId: recA, amount: 200 }],
      idempotencyKey: `settlement-${settlementId}-PROGRAM_DEDUCTION`,
    });
    const cash = await recordPayment({
      storeId, paidAt: new Date(), method: "CASH", amount: 800,
      recordedById: approverId,
      allocations: [{ receivableId: recA, amount: 800 }],
      idempotencyKey: `settlement-${settlementId}-CASH`,
    });

    const closed = await prisma.receivable.findUnique({ where: { id: recA } });
    expect(closed!.status).toBe("PAID");

    const result = await approveSettlement({ settlementId, approvedById: approverId });
    expect([...result.paymentIds].sort()).toEqual([program.paymentId, cash.paymentId].sort());

    expect(await paymentsForStore()).toHaveLength(2);
    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("APPROVED");
    expect(settlement!.reviewedById).toBe(approverId);
  });

  it("resumes when its own component closed a receivable whose agreed share is still partly unspent", async () => {
    /**
     * The half of the resume scoping that `agreedRemaining` alone cannot express, and the state
     * every other resume test here misses because it never sets up `agreed > live`.
     *
     * recA is claimed at its full 1000, then a verified `CollectionSubmission` pays 600 of it off
     * between submission and approval — a documented path, since that writer and this one
     * deliberately do not net each other. The trade-program component then takes the remaining 400
     * and closes recA, while this settlement's AGREED share of it still has 600 unspent. Scoping
     * collectibility on `agreedRemaining` alone therefore sees 600 still owed against a PAID row
     * and throws `NOT_OUTSTANDING` on every retry, forever — over a receivable `min(live,
     * agreedRemaining)` puts at zero headroom, so no `recordPayment` call would ever be made
     * against it.
     */
    const settlementId = await createSettlement({
      invoices: [
        { receivableId: recA, amount: 1000 },
        { receivableId: recB, amount: 500 },
      ],
      deductions: [evidencedDeduction("PROGRAM", 400)],
      actualAmount: 500,
      expectedAmount: 1100,
    });

    /* The other channel: 600 of recA collected and verified after this settlement was filed. */
    await prisma.receivable.update({
      where: { id: recA },
      data: { outstandingAmount: 400, paidAmount: 600, status: "PARTIAL" },
    });

    /* recA is the oldest invoice, so the trade-program component takes its whole 400 remainder. */
    const program = await recordPayment({
      storeId, paidAt: new Date(), method: "PROGRAM_DEDUCTION", amount: 400,
      recordedById: approverId,
      allocations: [{ receivableId: recA, amount: 400 }],
      idempotencyKey: `settlement-${settlementId}-PROGRAM_DEDUCTION`,
    });

    const closed = await prisma.receivable.findUnique({ where: { id: recA } });
    expect(closed!.status).toBe("PAID");

    const result = await approveSettlement({
      settlementId,
      approvedById: approverId,
      overrideReason: "Sisa ditagih minggu depan",
    });
    expect(result.paymentIds).toContain(program.paymentId);
    expect(result.paymentIds).toHaveLength(2);

    /* The cash spills into recB, the only invoice with headroom left. */
    const payments = await paymentsForStore();
    const cash = payments.find((payment) => payment.method === "CASH");
    expect(cash).toBeDefined();
    const cashAllocations = await prisma.paymentAllocation.findMany({
      where: { paymentId: cash!.id },
      select: { receivableId: true, amount: true },
    });
    expect(cashAllocations).toHaveLength(1);
    expect(cashAllocations[0].receivableId).toBe(recB);
    expect(Number(cashAllocations[0].amount)).toBe(500);

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("APPROVED");
  });

  it("re-projects a resumed retur draw whose appliedValue was never written", async () => {
    /**
     * The failure a uniform resume skip hides. `recordPayment` commits the draw; the projection
     * onto `FieldReturn.appliedValue` is a SEPARATE `runSerializable` inside
     * `projectReturnOffset`, so a serialization failure between the two leaves 300 of credit spent
     * and the retur still reading `appliedValue: 0` / `offsetStatus: "AVAILABLE"`. Nothing
     * re-projects except voiding that very draw — and `submitSettlement` computes retur headroom
     * as `totalValue - appliedValue - other PENDING claims`, so every later settlement over-claims
     * at submit and then dies at approval on `EXCEEDS_REMAINING`.
     *
     * Re-entering `applyReturnOffset` is what recovers it: its replay branch re-runs the
     * projection before returning.
     */
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

    /* The draw commits; the projection never runs — recordPayment does not project. */
    const draw = await recordPayment({
      storeId,
      paidAt: new Date(),
      method: "RETUR_OFFSET",
      amount: 300,
      recordedById: approverId,
      allocations: [{ receivableId: recA, amount: 300 }],
      idempotencyKey: `returoffset-${retId}-${deduction!.id}`,
      fieldReturnId: retId,
    });

    const stale = await prisma.fieldReturn.findUnique({ where: { id: retId } });
    expect(Number(stale!.appliedValue)).toBe(0);
    expect(stale!.offsetStatus).toBe("AVAILABLE");

    const result = await approveSettlement({ settlementId, approvedById: approverId });
    expect(result.paymentIds).toContain(draw.paymentId);

    const reprojected = await prisma.fieldReturn.findUnique({ where: { id: retId } });
    expect(Number(reprojected!.appliedValue)).toBe(300);
    expect(reprojected!.offsetStatus).toBe("APPLIED");

    /* And no second draw was created for the same deduction row. */
    const draws = (await paymentsForStore()).filter((payment) => payment.method === "RETUR_OFFSET");
    expect(draws).toHaveLength(1);
  });

  it("refuses a retur draw that no longer has headroom, before any component posts", async () => {
    /**
     * A backoffice offset sheet drawing part of the same retur between submission and approval.
     * The invoice-side pre-flight cannot see it — the invoice has plenty of room — so without a
     * retur-side aggregate the shortfall surfaces inside `recordPayment`'s own in-transaction
     * ceiling, mid-sequence, with earlier draws already committed.
     */
    await recordPayment({
      storeId,
      paidAt: new Date(),
      method: "RETUR_OFFSET",
      amount: 200,
      recordedById: approverId,
      allocations: [{ receivableId: recA, amount: 200 }],
      idempotencyKey: `returoffset-${retId}-elsewhere-${token}`,
      fieldReturnId: retId,
    });

    const settlementId = await createSettlement({
      invoices: [{ receivableId: recB, amount: 500 }],
      deductions: [{ type: "RETUR_OFFSET", amount: 300, fieldReturnId: retId }],
      actualAmount: 200,
      expectedAmount: 200,
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "RETUR_OVERCLAIMED",
    });

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("PENDING");
    /* Only the pre-existing draw exists — the approval posted nothing. */
    expect(await paymentsForStore()).toHaveLength(1);
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

    /*
     * `SETTLEMENT_APPROVE` is written unconditionally by every successful approval, so the
     * override-specific claim here is scoped to `action`, not to "no audit row at all".
     */
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "StoreSettlement", entityId: settlementId, action: "SETTLEMENT_VARIANCE_OVERRIDE" },
    });
    expect(audit).toBeNull();
  });

  it("writes a SETTLEMENT_APPROVE audit row inside the same transaction as the status flip", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 1000,
      expectedAmount: 1000,
    });

    const result = await approveSettlement({ settlementId, approvedById: approverId });

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "StoreSettlement", entityId: settlementId, action: "SETTLEMENT_APPROVE" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(approverId);
    expect((audit!.metadata as { paymentIds?: string[] } | null)?.paymentIds).toEqual(result.paymentIds);
  });

  it("does not duplicate the SETTLEMENT_APPROVE row on an alreadyApproved replay", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 1000,
      expectedAmount: 1000,
    });

    await approveSettlement({ settlementId, approvedById: approverId });
    const replay = await approveSettlement({ settlementId, approvedById: approverId });
    expect(replay.alreadyApproved).toBe(true);

    const audits = await prisma.auditLog.findMany({
      where: { entityType: "StoreSettlement", entityId: settlementId, action: "SETTLEMENT_APPROVE" },
    });
    expect(audits).toHaveLength(1);
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

  it("refuses an over-tender on its own terms, not as an allocation shortfall", async () => {
    /**
     * A 100 invoice fully consumed by a 100 program deduction, and the store hands over 100 cash
     * on top. The components sum to `invoiceTotal + variance` by construction and the headroom is
     * bounded by `invoiceTotal`, so a positive variance can never allocate — `recordPayment`
     * supports no unapplied credit. Typing an override reason changes nothing, which is exactly
     * why this needs a code of its own rather than reading as a headroom problem.
     */
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recSmall, amount: 100 }],
      deductions: [evidencedDeduction("PROGRAM", 100)],
      actualAmount: 100,
      expectedAmount: 0,
    });

    await expect(
      approveSettlement({ settlementId, approvedById: approverId, overrideReason: "kelebihan setor" }),
    ).rejects.toMatchObject({ code: "OVER_TENDER" });

    expect(await paymentsForStore()).toHaveLength(0);
    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("PENDING");
  });

  it("refuses before moving any money when a partly-paid invoice cannot absorb the components", async () => {
    /*
     * Variance is zero, so this is not an over-tender — the invoice was simply paid down elsewhere
     * to 400 while the document still claims 1000 of it. Nothing may post.
     */
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 1000,
      expectedAmount: 1000,
    });

    await prisma.receivable.update({
      where: { id: recA },
      data: { outstandingAmount: 400, paidAmount: 600, status: "PARTIAL" },
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "COMPONENT_EXCEEDS_HEADROOM",
    });

    expect(await paymentsForStore()).toHaveLength(0);
    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("PENDING");
  });

  it("approves a variance inside the configured tolerance with no override reason", async () => {
    /**
     * The permitting direction of the feature. `parseVarianceTolerance` is unit-tested on its own,
     * but the writer's `SystemSetting` read and the `|variance| - tolerance > EPSILON` gate are
     * only ever exercised at the shipped default of 0 otherwise.
     */
    await prisma.systemSetting.upsert({
      where: { key: VARIANCE_TOLERANCE_SETTING_KEY },
      create: { key: VARIANCE_TOLERANCE_SETTING_KEY, value: "500" },
      update: { value: "500" },
    });

    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 900,
      expectedAmount: 1000,
    });

    const result = await approveSettlement({ settlementId, approvedById: approverId });
    expect(result.paymentIds).toHaveLength(1);

    const settlement = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(settlement!.status).toBe("APPROVED");

    /*
     * Inside tolerance is not an override, so nothing is audited as one — scoped to `action`
     * since `SETTLEMENT_APPROVE` itself is still written unconditionally.
     */
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "StoreSettlement", entityId: settlementId, action: "SETTLEMENT_VARIANCE_OVERRIDE" },
    });
    expect(audit).toBeNull();

    const receivable = await prisma.receivable.findUnique({ where: { id: recA } });
    expect(Number(receivable!.outstandingAmount)).toBe(100);
  });

  it("still demands a reason for a variance outside the configured tolerance", async () => {
    await prisma.systemSetting.upsert({
      where: { key: VARIANCE_TOLERANCE_SETTING_KEY },
      create: { key: VARIANCE_TOLERANCE_SETTING_KEY, value: "50" },
      update: { value: "50" },
    });

    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      actualAmount: 900,
      expectedAmount: 1000,
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "VARIANCE_REQUIRES_REASON",
    });
    expect(await paymentsForStore()).toHaveLength(0);
  });

  it("refuses a receivable belonging to another store", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recOtherStore, amount: 500 }],
      actualAmount: 500,
      expectedAmount: 500,
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "WRONG_STORE",
    });
    expect(await paymentsForStore()).toHaveLength(0);
  });

  it("refuses a retur belonging to another store", async () => {
    const settlementId = await createSettlement({
      invoices: [{ receivableId: recA, amount: 1000 }],
      deductions: [{ type: "RETUR_OFFSET", amount: 100, fieldReturnId: retWrongStoreId }],
      actualAmount: 900,
      expectedAmount: 900,
    });

    await expect(approveSettlement({ settlementId, approvedById: approverId })).rejects.toMatchObject({
      code: "RETUR_WRONG_STORE",
    });
    expect(await paymentsForStore()).toHaveLength(0);
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
