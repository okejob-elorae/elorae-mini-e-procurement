import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import type { POStatus } from "@elorae/db";
import { setPurchaseOrderPaymentTerms } from "./set-payment-terms";

/* Seeds PO/GRN rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("setPurchaseOrderPaymentTerms (test bed only)", () => {
  let token = "";
  let userId = "";
  let supplierTypeId = "";
  let supplierId = "";
  let poIds: string[] = [];
  let grnIds: string[] = [];

  /*
   * One monotonic per-suite counter feeds every PO/GRN document number, so no
   * two documents in this file can collide on the unique `docNumber` however
   * many cases are added later.
   */
  let docSeq = 0;
  function nextDocNumber(prefix: "PO" | "GRN"): string {
    docSeq += 1;
    return `${prefix}-TEST-${token}-${docSeq}`;
  }

  async function makePo(opts: {
    status: POStatus;
    paymentTermsDays: number | null;
    paidAt?: Date | null;
  }): Promise<string> {
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: nextDocNumber("PO"),
        supplierId,
        createdById: userId,
        status: opts.status,
        paymentTermsDays: opts.paymentTermsDays,
        paidAt: opts.paidAt ?? null,
      },
    });
    poIds.push(po.id);
    return po.id;
  }

  async function makeGrn(poId: string, opts: { grnDate: Date }): Promise<string> {
    const grn = await prisma.gRN.create({
      data: {
        docNumber: nextDocNumber("GRN"),
        poId,
        supplierId,
        receivedBy: userId,
        totalAmount: 0,
        items: [],
        grnDate: opts.grnDate,
      },
    });
    grnIds.push(grn.id);
    return grn.id;
  }

  beforeAll(async () => {
    userId = "";
    supplierTypeId = "";
    supplierId = "";
    token = Math.floor(Math.random() * 10_000_000).toString();

    const user = await prisma.user.create({
      data: { email: `test-set-terms-${token}@test.local`, name: "Test Set Terms User" },
    });
    userId = user.id;

    const supplierType = await prisma.supplierType.create({ data: { code: `ST-ST-${token}`, name: "Test Type" } });
    supplierTypeId = supplierType.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-ST-${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;
  }, 60_000);

  afterAll(async () => {
    try {
      await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    } catch (e) {
      console.warn("[set-payment-terms.test.ts] failed to delete test supplier", supplierId, e);
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: seededId(supplierTypeId) } });
    } catch (e) {
      console.warn("[set-payment-terms.test.ts] failed to delete test supplier type", supplierTypeId, e);
    }
    try {
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    } catch (e) {
      console.warn("[set-payment-terms.test.ts] failed to delete test user", userId, e);
    }
  });

  beforeEach(() => {
    poIds = [];
    grnIds = [];
  });

  /* GRNs and status history go before their POs; each step is guarded so one failure cannot skip the others. */
  afterEach(async () => {
    try {
      await prisma.gRN.deleteMany({ where: { id: { in: grnIds.map(seededId) } } });
    } catch (e) {
      console.warn("[set-payment-terms.test.ts] failed to delete test GRNs", grnIds, e);
    }
    try {
      await prisma.pOStatusHistory.deleteMany({ where: { poId: { in: poIds.map(seededId) } } });
    } catch (e) {
      console.warn("[set-payment-terms.test.ts] failed to delete test PO history", poIds, e);
    }
    try {
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds.map(seededId) } } });
    } catch (e) {
      console.warn("[set-payment-terms.test.ts] failed to delete test POs", poIds, e);
    }
    poIds = [];
    grnIds = [];
  });

  it("on a CLOSED PO writes terms, recomputes from the first receipt, and logs history", async () => {
    const po = await makePo({ status: "CLOSED", paymentTermsDays: 30 });
    await makeGrn(po, { grnDate: new Date("2026-10-12T03:00:00.000Z") });
    expect(await setPurchaseOrderPaymentTerms(po, 45, userId)).toEqual({ ok: true });
    const row = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po } });
    expect(row.paymentTermsDays).toBe(45);
    expect(row.paymentDueDate?.toISOString()).toBe("2026-11-26T00:00:00.000Z");
    const history = await prisma.pOStatusHistory.findMany({ where: { poId: po } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "CLOSED", notes: "Payment terms: 30 → 45 days" });
  });

  it("clearing terms keeps the last derived date as a manual one", async () => {
    const po = await makePo({ status: "PARTIAL", paymentTermsDays: 30 });
    await makeGrn(po, { grnDate: new Date("2026-10-12T03:00:00.000Z") });
    await setPurchaseOrderPaymentTerms(po, 30, userId);
    await setPurchaseOrderPaymentTerms(po, null, userId);
    const row = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po } });
    expect(row.paymentTermsDays).toBeNull();
    expect(row.paymentDueDate?.toISOString()).toBe("2026-11-11T00:00:00.000Z");
    const history = await prisma.pOStatusHistory.findMany({ where: { poId: po } });
    expect(history.map((h) => h.notes)).toContain("Payment terms: 30 → none");
  });

  it("logs none → N when terms were unset", async () => {
    const po = await makePo({ status: "SUBMITTED", paymentTermsDays: null });
    expect(await setPurchaseOrderPaymentTerms(po, 30, userId)).toEqual({ ok: true });
    const history = await prisma.pOStatusHistory.findMany({ where: { poId: po } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "SUBMITTED", notes: "Payment terms: none → 30 days" });
  });

  it("refuses a cancelled PO", async () => {
    const po = await makePo({ status: "CANCELLED", paymentTermsDays: 30 });
    expect(await setPurchaseOrderPaymentTerms(po, 10, userId)).toEqual({ ok: false, code: "CANCELLED" });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po } })).paymentTermsDays).toBe(30);
  });

  it("refuses a paid PO", async () => {
    const po = await makePo({ status: "CLOSED", paymentTermsDays: 30, paidAt: new Date() });
    expect(await setPurchaseOrderPaymentTerms(po, 10, userId)).toEqual({ ok: false, code: "PAID" });
  });

  it.each([-1, 1.5, 366])("refuses invalid terms %s", async (v) => {
    const po = await makePo({ status: "SUBMITTED", paymentTermsDays: null });
    expect(await setPurchaseOrderPaymentTerms(po, v, userId)).toEqual({ ok: false, code: "INVALID" });
  });

  it("returns NOT_FOUND for an unknown id", async () => {
    expect(await setPurchaseOrderPaymentTerms("does-not-exist", 10, userId)).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});
