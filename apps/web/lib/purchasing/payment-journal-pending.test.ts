import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { paymentJournalPendingWhilePaid } from "./post-supplier-payment-journal-safely";

/* Creates PO/supplier/user/notification rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * The standing payment journal is inserted directly rather than by running the
 * payment writer, so no `JournalAccountMapping` is touched. Two throwaway chart
 * accounts (never mapped to a posting role) exist purely to hang its lines off.
 */
d("paymentJournalPendingWhilePaid (test bed only)", () => {
  const token = Math.floor(Math.random() * 10_000_000).toString();
  let userId = "";
  let supplierTypeId = "";
  let supplierId = "";
  let apAccountId = "";
  let bankAccountId = "";
  let perTestPoIds: string[] = [];
  let perTestNotificationIds: string[] = [];
  let seq = 0;

  async function seedPo(paidAt: Date | null): Promise<string> {
    seq += 1;
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-PJP-${token}-${seq}`, supplierId, createdById: userId, paidAt },
      select: { id: true },
    });
    perTestPoIds.push(po.id);
    return po.id;
  }

  async function standPaymentJournal(poId: string): Promise<void> {
    await prisma.journal.create({
      data: {
        date: new Date("2026-06-20T00:00:00.000Z"),
        description: `Supplier payment ${poId}`,
        sourceType: "SUPPLIER_PAYMENT",
        sourceId: `${poId}#1`,
        postedById: userId,
        lines: {
          create: [
            { chartAccountId: apAccountId, debit: 30_000, credit: 0 },
            { chartAccountId: bankAccountId, debit: 0, credit: 30_000 },
          ],
        },
      },
    });
  }

  async function writeRow(
    docId: string,
    kind: string,
    reason: string,
    role: string | null,
    extra: { createdAt?: Date; readAt?: Date } = {},
  ): Promise<void> {
    const row = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: "Supplier payment journal not posted",
        message: "payment-journal-pending spec",
        metadata: { docId, kind, reason, role },
        ...extra,
      },
      select: { id: true },
    });
    perTestNotificationIds.push(row.id);
  }

  beforeAll(async () => {
    userId = "";
    supplierTypeId = "";
    supplierId = "";
    apAccountId = "";
    bankAccountId = "";
    const user = await prisma.user.create({
      data: { email: `test-pjp-${token}@test.local`, name: "Test Finance User" },
    });
    userId = user.id;
    const supplierType = await prisma.supplierType.create({ data: { code: `ST-PJP-${token}`, name: "Test Type" } });
    supplierTypeId = supplierType.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-PJP-${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;
    const ap = await prisma.chartAccount.create({
      data: { code: `7${token}0`, name: "AP (pending banner test)", type: "LIABILITAS", depth: 1, isActive: true },
      select: { id: true },
    });
    apAccountId = ap.id;
    const bank = await prisma.chartAccount.create({
      data: { code: `7${token}1`, name: "Bank (pending banner test)", type: "ASET", depth: 1, isActive: true },
      select: { id: true },
    });
    bankAccountId = bank.id;
  }, 60_000);

  /* Notifications by id, then journal lines, journals and POs — each step guarded and logged. */
  afterEach(async () => {
    for (const id of perTestNotificationIds) {
      try {
        await prisma.adminNotification.delete({ where: { id: seededId(id) } });
      } catch (e) {
        console.warn("[payment-journal-pending.test.ts] failed to delete test notification", id, e);
      }
    }
    perTestNotificationIds = [];
    for (const poId of perTestPoIds) {
      try {
        const journals = await prisma.journal.findMany({
          where: { sourceType: "SUPPLIER_PAYMENT", sourceId: { startsWith: `${seededId(poId)}#` } },
          select: { id: true },
        });
        const ids = journals.map((j) => j.id);
        if (ids.length) {
          await prisma.journalLine.deleteMany({ where: { journalId: { in: ids } } });
          await prisma.journal.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.purchaseOrder.delete({ where: { id: seededId(poId) } });
      } catch (e) {
        console.warn("[payment-journal-pending.test.ts] failed to delete test PO", poId, e);
      }
    }
    perTestPoIds = [];
  });

  afterAll(async () => {
    try {
      await prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(apAccountId), seededId(bankAccountId)] } } });
    } catch (e) {
      console.warn("[payment-journal-pending.test.ts] failed to delete test chart accounts", e);
    }
    try {
      await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    } catch (e) {
      console.warn("[payment-journal-pending.test.ts] failed to delete test supplier", supplierId, e);
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: seededId(supplierTypeId) } });
    } catch (e) {
      console.warn("[payment-journal-pending.test.ts] failed to delete test supplier type", supplierTypeId, e);
    }
    try {
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    } catch (e) {
      console.warn("[payment-journal-pending.test.ts] failed to delete test user", userId, e);
    }
  });

  const PAID = new Date("2026-06-10T00:00:00.000Z");

  it("returns null for an unpaid PO even with a supplier_payment row", async () => {
    const poId = await seedPo(null);
    await writeRow(poId, "supplier_payment", "UNMAPPED_ROLE", "AP");
    await expect(paymentJournalPendingWhilePaid(poId)).resolves.toBeNull();
  });

  it("returns the recorded failure for a paid PO with no payment journal", async () => {
    const poId = await seedPo(PAID);
    await writeRow(poId, "supplier_payment", "UNMAPPED_ROLE", "AP");
    await expect(paymentJournalPendingWhilePaid(poId)).resolves.toEqual({ reason: "UNMAPPED_ROLE", role: "AP" });
  });

  it("returns the newest row when several exist for the PO", async () => {
    const poId = await seedPo(PAID);
    await writeRow(poId, "supplier_payment", "UNMAPPED_ROLE", "AP", { createdAt: new Date(Date.now() - 60_000) });
    await writeRow(poId, "supplier_payment", "GRN_APPROVAL_PENDING", null, { createdAt: new Date() });
    await expect(paymentJournalPendingWhilePaid(poId)).resolves.toEqual({ reason: "GRN_APPROVAL_PENDING", role: null });
  });

  it("still returns a row that has been read", async () => {
    const poId = await seedPo(PAID);
    await writeRow(poId, "supplier_payment", "UNBALANCED", null, { readAt: new Date() });
    await expect(paymentJournalPendingWhilePaid(poId)).resolves.toEqual({ reason: "UNBALANCED", role: null });
  });

  it("returns null once a payment journal stands at the current generation", async () => {
    const poId = await seedPo(PAID);
    await standPaymentJournal(poId);
    await writeRow(poId, "supplier_payment", "UNMAPPED_ROLE", "AP");
    await expect(paymentJournalPendingWhilePaid(poId)).resolves.toBeNull();
  });

  it("ignores a reversal-direction row", async () => {
    const poId = await seedPo(PAID);
    await writeRow(poId, "supplier_payment_reversal", "UNBALANCED", null);
    await expect(paymentJournalPendingWhilePaid(poId)).resolves.toBeNull();
  });

  it("ignores a row recorded for a different PO", async () => {
    const poId = await seedPo(PAID);
    const otherPoId = await seedPo(PAID);
    await writeRow(otherPoId, "supplier_payment", "UNMAPPED_ROLE", "AP");
    await expect(paymentJournalPendingWhilePaid(poId)).resolves.toBeNull();
  });
});
