import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@elorae/db";

/* Creates PO/supplier/user rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { postSupplierPaymentReversalJournalAction } from "@/app/actions/purchase-orders";

/*
 * The standing-payment reversal retry is the one control on this flow that is not
 * the paid toggle, so its guards are what stop it from posting a reversal for a
 * PO that does not need one. Both are asserted here because the warning banner's
 * visibility cannot be one: this action is an independently callable endpoint.
 *
 * No journals are posted by these cases — every one of them is refused before the
 * writer is reached — so this file needs no chart-account or mapping fixture, and
 * cannot disturb the GL config the sibling spec snapshots.
 */
d("postSupplierPaymentReversalJournalAction (test bed only)", () => {
  const token = Math.floor(Math.random() * 10_000_000).toString();
  let userId: string;
  let supplierTypeId: string;
  let supplierId: string;
  let unpaidPoId: string;
  let paidPoId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-sp-reversal-${token}@test.local`, name: "Test Finance User" },
    });
    userId = user.id;
    const supplierType = await prisma.supplierType.create({ data: { code: `ST-SPR-${token}`, name: "Test Type" } });
    supplierTypeId = supplierType.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-SPR-${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;

    /* Unpaid with no journal of any kind, and paid with no journal either: two
       different ways the state the action requires does NOT hold. */
    const unpaid = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-SPR-${token}-1`, supplierId, createdById: userId },
      select: { id: true },
    });
    unpaidPoId = unpaid.id;
    const paid = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-SPR-${token}-2`, supplierId, createdById: userId, paidAt: new Date("2026-06-10T00:00:00.000Z") },
      select: { id: true },
    });
    paidPoId = paid.id;
  }, 60_000);

  /* Each step guarded so one failure cannot skip the rest, and logged so a
     leaked test row stays discoverable on the shared dev DB. */
  afterAll(async () => {
    try {
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: [unpaidPoId, paidPoId] } } });
    } catch (e) {
      console.warn("[supplier-payment-reversal-action.test.ts] failed to delete test POs", [unpaidPoId, paidPoId], e);
    }
    try {
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
    } catch (e) {
      console.warn("[supplier-payment-reversal-action.test.ts] failed to delete test supplier", supplierId, e);
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: supplierTypeId } });
    } catch (e) {
      console.warn("[supplier-payment-reversal-action.test.ts] failed to delete test supplier type", supplierTypeId, e);
    }
    try {
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch (e) {
      console.warn("[supplier-payment-reversal-action.test.ts] failed to delete test user", userId, e);
    }
  });

  beforeEach(() => {
    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["journals:manage"] } });
  });

  it("refuses BAD_STATE for an unpaid PO with no standing payment journal", async () => {
    const r = await postSupplierPaymentReversalJournalAction(unpaidPoId);
    expect(r).toEqual({ ok: false, code: "BAD_STATE" });
  });

  it("refuses BAD_STATE for a PO that is marked paid", async () => {
    const r = await postSupplierPaymentReversalJournalAction(paidPoId);
    expect(r).toEqual({ ok: false, code: "BAD_STATE" });
  });

  it("refuses BAD_STATE for a PO that does not exist", async () => {
    const r = await postSupplierPaymentReversalJournalAction(`missing-${token}`);
    expect(r).toEqual({ ok: false, code: "BAD_STATE" });
  });

  it("refuses FORBIDDEN without journals:manage, before any state read", async () => {
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["purchase_orders:edit"] } });
    const r = await postSupplierPaymentReversalJournalAction(unpaidPoId);
    expect(r).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("refuses FORBIDDEN without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await postSupplierPaymentReversalJournalAction(unpaidPoId);
    expect(r).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});
