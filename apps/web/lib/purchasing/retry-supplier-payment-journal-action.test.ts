import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/* Creates PO/supplier/user/notification rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const { mockAuth, postMock } = vi.hoisted(() => ({ mockAuth: vi.fn(), postMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
/* Only the GL writer is replaced; the generation readers the state check uses stay real. */
vi.mock("@/lib/purchasing/supplier-payment-journal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/purchasing/supplier-payment-journal")>()),
  postSupplierPaymentJournal: postMock,
}));

import { retrySupplierPaymentJournalAction } from "@/app/actions/purchase-orders";

/*
 * The retry's gate is a recorded failed attempt, never "paid without a journal",
 * and it must post at the PO's stored `paidAt`. The GL writer is mocked so no
 * `JournalAccountMapping` or chart account is touched; what is asserted is what
 * the action hands the writer and what it records when the writer refuses.
 */
d("retrySupplierPaymentJournalAction (test bed only)", () => {
  const token = Math.floor(Math.random() * 10_000_000).toString();
  let userId = "";
  let supplierTypeId = "";
  let supplierId = "";
  let perTestPoIds: string[] = [];
  let seq = 0;

  const PAID = new Date("2026-06-10T03:04:05.678Z");

  async function seedPo(paidAt: Date | null): Promise<string> {
    seq += 1;
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-RSP-${token}-${seq}`, supplierId, createdById: userId, paidAt },
      select: { id: true },
    });
    perTestPoIds.push(po.id);
    return po.id;
  }

  async function writeRow(poId: string, reason: string, role: string | null): Promise<void> {
    await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: "Supplier payment journal not posted",
        message: "retry action spec",
        metadata: { docId: poId, kind: "supplier_payment", reason, role },
      },
    });
  }

  async function paymentRowsFor(poId: string) {
    const rows = await prisma.adminNotification.findMany({
      where: { category: "JOURNAL_PENDING" },
      select: { id: true, metadata: true },
    });
    return rows.filter((r) => {
      const m = r.metadata as { docId?: unknown; kind?: unknown } | null;
      return m?.docId === poId && m?.kind === "supplier_payment";
    });
  }

  beforeAll(async () => {
    userId = "";
    supplierTypeId = "";
    supplierId = "";
    const user = await prisma.user.create({
      data: { email: `test-rsp-${token}@test.local`, name: "Test Finance User" },
    });
    userId = user.id;
    const supplierType = await prisma.supplierType.create({ data: { code: `ST-RSP-${token}`, name: "Test Type" } });
    supplierTypeId = supplierType.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-RSP-${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;
  }, 60_000);

  beforeEach(() => {
    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["journals:manage"] } });
    postMock.mockReset();
  });

  /* Every notification naming a per-test PO (matched in JS, deleted by id), then the POs. */
  afterEach(async () => {
    const ids = new Set(perTestPoIds.map(seededId).filter((id) => id !== ""));
    try {
      const rows = await prisma.adminNotification.findMany({
        where: { category: "JOURNAL_PENDING" },
        select: { id: true, metadata: true },
      });
      for (const r of rows) {
        const docId = (r.metadata as { docId?: unknown } | null)?.docId;
        if (typeof docId === "string" && ids.has(docId)) await prisma.adminNotification.delete({ where: { id: r.id } });
      }
    } catch (e) {
      console.warn("[retry-supplier-payment-journal-action.test.ts] failed to delete test notifications", e);
    }
    for (const poId of perTestPoIds) {
      try {
        await prisma.purchaseOrder.delete({ where: { id: seededId(poId) } });
      } catch (e) {
        console.warn("[retry-supplier-payment-journal-action.test.ts] failed to delete test PO", poId, e);
      }
    }
    perTestPoIds = [];
  });

  afterAll(async () => {
    try {
      await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    } catch (e) {
      console.warn("[retry-supplier-payment-journal-action.test.ts] failed to delete test supplier", supplierId, e);
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: seededId(supplierTypeId) } });
    } catch (e) {
      console.warn("[retry-supplier-payment-journal-action.test.ts] failed to delete test supplier type", supplierTypeId, e);
    }
    try {
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    } catch (e) {
      console.warn("[retry-supplier-payment-journal-action.test.ts] failed to delete test user", userId, e);
    }
  });

  it("refuses FORBIDDEN without journals:manage and never posts", async () => {
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: [] } });
    const poId = await seedPo(PAID);
    await writeRow(poId, "UNMAPPED_ROLE", "AP");
    await expect(retrySupplierPaymentJournalAction(poId)).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("refuses BAD_STATE for an unpaid PO", async () => {
    const poId = await seedPo(null);
    await writeRow(poId, "UNMAPPED_ROLE", "AP");
    await expect(retrySupplierPaymentJournalAction(poId)).resolves.toEqual({ ok: false, code: "BAD_STATE" });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("refuses BAD_STATE for a paid PO with no recorded failure", async () => {
    const poId = await seedPo(PAID);
    await expect(retrySupplierPaymentJournalAction(poId)).resolves.toEqual({ ok: false, code: "BAD_STATE" });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("posts at the PO's stored paidAt, not now", async () => {
    postMock.mockResolvedValue({ ok: true, journalId: "j", created: true });
    const poId = await seedPo(PAID);
    await writeRow(poId, "UNMAPPED_ROLE", "AP");
    await expect(retrySupplierPaymentJournalAction(poId)).resolves.toEqual({ ok: true });
    expect(postMock).toHaveBeenCalledTimes(1);
    const [calledPoId, calledActorId, calledPaidAt] = postMock.mock.calls[0];
    expect(calledPoId).toBe(poId);
    expect(calledActorId).toBe(userId);
    expect((calledPaidAt as Date).getTime()).toBe(PAID.getTime());
  });

  it("reports and records a new failure reason", async () => {
    postMock.mockResolvedValue({ ok: false, code: "GRN_JOURNALS_INCOMPLETE" });
    const poId = await seedPo(PAID);
    await writeRow(poId, "GRN_APPROVAL_PENDING", null);
    await expect(retrySupplierPaymentJournalAction(poId)).resolves.toEqual({
      ok: false,
      code: "JOURNAL_FAILED",
      failure: { code: "GRN_JOURNALS_INCOMPLETE", role: null },
    });
    const rows = await paymentRowsFor(poId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => (r.metadata as { reason?: unknown }).reason === "GRN_JOURNALS_INCOMPLETE")).toHaveLength(1);
  });

  it("does not record the same failure twice", async () => {
    postMock.mockResolvedValue({ ok: false, code: "GRN_JOURNALS_INCOMPLETE" });
    const poId = await seedPo(PAID);
    await writeRow(poId, "GRN_APPROVAL_PENDING", null);
    await retrySupplierPaymentJournalAction(poId);
    await retrySupplierPaymentJournalAction(poId);
    const rows = await paymentRowsFor(poId);
    expect(rows.filter((r) => (r.metadata as { reason?: unknown }).reason === "GRN_JOURNALS_INCOMPLETE")).toHaveLength(1);
  });
});
