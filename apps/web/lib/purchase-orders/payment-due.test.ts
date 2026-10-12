import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recomputePaymentDueDate } from "./payment-due";

/* Seeds PO/GRN rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("recomputePaymentDueDate (test bed only)", () => {
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

  async function makePo(opts: { paymentTermsDays: number | null; paymentDueDate?: Date | null }): Promise<string> {
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: nextDocNumber("PO"),
        supplierId,
        createdById: userId,
        paymentTermsDays: opts.paymentTermsDays,
        paymentDueDate: opts.paymentDueDate ?? null,
      },
    });
    poIds.push(po.id);
    return po.id;
  }

  async function makeGrn(
    poId: string,
    opts: { grnDate: Date; requiresOwnerApproval?: boolean; ownerDeclinedAt?: Date | null },
  ): Promise<string> {
    const grn = await prisma.gRN.create({
      data: {
        docNumber: nextDocNumber("GRN"),
        poId,
        supplierId,
        receivedBy: userId,
        totalAmount: 0,
        items: [],
        grnDate: opts.grnDate,
        requiresOwnerApproval: opts.requiresOwnerApproval ?? false,
        ownerDeclinedAt: opts.ownerDeclinedAt ?? null,
      },
    });
    grnIds.push(grn.id);
    return grn.id;
  }

  async function dueOf(poId: string): Promise<Date | null> {
    const po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: poId },
      select: { paymentDueDate: true },
    });
    return po.paymentDueDate;
  }

  beforeAll(async () => {
    userId = "";
    supplierTypeId = "";
    supplierId = "";
    token = Math.floor(Math.random() * 10_000_000).toString();

    const user = await prisma.user.create({
      data: { email: `test-payment-due-${token}@test.local`, name: "Test Payment Due User" },
    });
    userId = user.id;

    const supplierType = await prisma.supplierType.create({ data: { code: `ST-PD-${token}`, name: "Test Type" } });
    supplierTypeId = supplierType.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-PD-${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;
  }, 60_000);

  afterAll(async () => {
    try {
      await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    } catch (e) {
      console.warn("[payment-due.test.ts] failed to delete test supplier", supplierId, e);
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: seededId(supplierTypeId) } });
    } catch (e) {
      console.warn("[payment-due.test.ts] failed to delete test supplier type", supplierTypeId, e);
    }
    try {
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    } catch (e) {
      console.warn("[payment-due.test.ts] failed to delete test user", userId, e);
    }
  });

  beforeEach(() => {
    poIds = [];
    grnIds = [];
  });

  /* GRNs go before their POs; each step is guarded so one failure cannot skip the other. */
  afterEach(async () => {
    try {
      await prisma.gRN.deleteMany({ where: { id: { in: grnIds.map(seededId) } } });
    } catch (e) {
      console.warn("[payment-due.test.ts] failed to delete test GRNs", grnIds, e);
    }
    try {
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds.map(seededId) } } });
    } catch (e) {
      console.warn("[payment-due.test.ts] failed to delete test POs", poIds, e);
    }
    poIds = [];
    grnIds = [];
  });

  it("terms set, first GRN → due = WIB day of first GRN + terms", async () => {
    const po = await makePo({ paymentTermsDays: 30 });
    await makeGrn(po, { grnDate: new Date("2026-10-12T03:00:00.000Z") });
    await recomputePaymentDueDate(prisma, po);
    expect((await dueOf(po))?.toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });

  it("a later GRN does not move the date", async () => {
    const po = await makePo({ paymentTermsDays: 30 });
    await makeGrn(po, { grnDate: new Date("2026-10-12T03:00:00.000Z") });
    await makeGrn(po, { grnDate: new Date("2026-10-20T03:00:00.000Z") });
    await recomputePaymentDueDate(prisma, po);
    expect((await dueOf(po))?.toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });

  it("skips a declined GRN and falls back to the next surviving one", async () => {
    const po = await makePo({ paymentTermsDays: 10 });
    await makeGrn(po, { grnDate: new Date("2026-10-01T03:00:00.000Z"), ownerDeclinedAt: new Date() });
    await makeGrn(po, { grnDate: new Date("2026-10-05T03:00:00.000Z") });
    await recomputePaymentDueDate(prisma, po);
    expect((await dueOf(po))?.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });

  it("only declined GRNs → due date null", async () => {
    const po = await makePo({ paymentTermsDays: 10, paymentDueDate: new Date("2026-10-30T00:00:00.000Z") });
    await makeGrn(po, { grnDate: new Date("2026-10-01T03:00:00.000Z"), ownerDeclinedAt: new Date() });
    await recomputePaymentDueDate(prisma, po);
    expect(await dueOf(po)).toBeNull();
  });

  it("a pending over-receive GRN counts as the first receipt", async () => {
    const po = await makePo({ paymentTermsDays: 7 });
    await makeGrn(po, { grnDate: new Date("2026-10-01T03:00:00.000Z"), requiresOwnerApproval: true });
    await recomputePaymentDueDate(prisma, po);
    expect((await dueOf(po))?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it("two GRNs at the same instant resolve deterministically by id", async () => {
    const po = await makePo({ paymentTermsDays: 1 });
    const same = new Date("2026-10-01T03:00:00.000Z");
    await makeGrn(po, { grnDate: same });
    await makeGrn(po, { grnDate: same });
    await recomputePaymentDueDate(prisma, po);
    expect((await dueOf(po))?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("terms null → a manual date is left untouched", async () => {
    const manual = new Date("2026-12-01T00:00:00.000Z");
    const po = await makePo({ paymentTermsDays: null, paymentDueDate: manual });
    await makeGrn(po, { grnDate: new Date("2026-10-01T03:00:00.000Z") });
    await recomputePaymentDueDate(prisma, po);
    expect((await dueOf(po))?.toISOString()).toBe(manual.toISOString());
  });

  it("terms set, no GRN yet → due date null", async () => {
    const po = await makePo({ paymentTermsDays: 30, paymentDueDate: new Date("2026-12-01T00:00:00.000Z") });
    await recomputePaymentDueDate(prisma, po);
    expect(await dueOf(po)).toBeNull();
  });

  it("an unknown PO id is a no-op", async () => {
    await expect(recomputePaymentDueDate(prisma, "does-not-exist")).resolves.toBeUndefined();
  });
});
