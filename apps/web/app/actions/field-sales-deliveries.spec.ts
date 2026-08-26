import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

const { mockAuth, staleSnapshot, mockUpdateMany, mockAdminNotificationCreate, mockFanOut, mockLogAudit, notaDeliveryLookup } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    staleSnapshot: { value: null as { invoiceDate: Date; dueDate: Date } | null },
    mockUpdateMany: vi.fn(),
    mockAdminNotificationCreate: vi.fn(),
    mockFanOut: vi.fn(),
    mockLogAudit: vi.fn(),
    notaDeliveryLookup: { impl: null as ((args: unknown) => Promise<unknown>) | null },
  }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: mockFanOut }));
vi.mock("./audit", () => ({ logPrint: mockLogAudit }));

/**
 * `TaxInvoice` and `AdminNotification` on `recordNotaTagihanPrinted`'s path need mocking, not the
 * real test bed: `prisma.taxInvoice` does not exist in the generated client yet (`prisma
 * generate` has not run since the model was added — see the task brief), so a real call would
 * throw before any assertion runs. `fieldSalesDelivery` is patched too, but only its `findUnique`
 * — everything else (`create`, `findUniqueOrThrow`, `deleteMany`, `$transaction`, every other
 * model) still goes to the real client via `actual.prisma`, which is itself a `get`-only Proxy
 * (see `packages/db/src/index.ts`) — spreading it (`{ ...actual.prisma }`) would silently copy
 * NOTHING, since its trap ignores its own empty target. Building a second Proxy that forwards
 * unknown props to `actual.prisma[prop]` is what keeps every other test in this file (which needs
 * the real DB) working unchanged.
 *
 * Touching `patchedPrisma.fieldSalesDelivery` — from either suite, on every access — runs the
 * real client's lazy getter, which constructs a `PrismaClient` against whatever `DATABASE_URL`
 * is set if one isn't already cached. Construction only: no connection is opened and no query
 * runs until a method is actually awaited, so this is inert for the mocked describe block below,
 * which never lets a call reach the real delegate.
 */
vi.mock("@elorae/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elorae/db")>();
  const patchedPrisma = new Proxy({} as typeof actual.prisma, {
    get(_target, prop) {
      if (prop === "taxInvoice") return { updateMany: mockUpdateMany };
      if (prop === "adminNotification") return { create: mockAdminNotificationCreate };
      if (prop === "fieldSalesDelivery") {
        const real = actual.prisma.fieldSalesDelivery as unknown as Record<string, unknown>;
        return new Proxy({} as typeof actual.prisma.fieldSalesDelivery, {
          get(_t, p) {
            if (p === "findUnique" && notaDeliveryLookup.impl) return notaDeliveryLookup.impl;
            return real[p as string];
          },
        });
      }
      return (actual.prisma as unknown as Record<string, unknown>)[prop as string];
    },
  });
  return { ...actual, prisma: patchedPrisma };
});

/**
 * A lost-update race cannot be produced by two real transactions here: the action's snapshot read
 * happens INSIDE its own serializable transaction, so a competing writer on another connection
 * blocks on the lock instead of interleaving. What the compare-and-swap actually defends against
 * is a snapshot that no longer describes the row, so that is what this fakes — `staleSnapshot`
 * makes the transaction's read return dates the row does not hold, while every write still goes to
 * the real table. Null (the default) leaves the real `runSerializable` untouched for every other
 * test in this file.
 */
vi.mock("@/lib/db/tx-retry", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/tx-retry")>();
  type TxCallback = Parameters<typeof actual.runSerializable>[0];
  return {
    ...actual,
    runSerializable: async (cb: TxCallback) => {
      const stale = staleSnapshot.value;
      if (!stale) return actual.runSerializable(cb);
      const { prisma: db } = await import("@elorae/db");
      const tx = {
        fieldSalesDelivery: {
          findUnique: async (args: { where: { id: string } }) => {
            const row = await db.fieldSalesDelivery.findUnique({
              where: { id: args.where.id },
              select: { id: true, orderId: true },
            });
            return row === null ? null : { ...row, invoiceDate: stale.invoiceDate, dueDate: stale.dueDate };
          },
          updateMany: (args: Parameters<typeof db.fieldSalesDelivery.updateMany>[0]) =>
            db.fieldSalesDelivery.updateMany(args),
        },
        auditLog: {
          create: (args: Parameters<typeof db.auditLog.create>[0]) => db.auditLog.create(args),
        },
      } as unknown as Parameters<TxCallback>[0];
      return cb(tx);
    },
  };
});

import { recordNotaTagihanPrinted, updateDeliveryDatesAction } from "./field-sales-deliveries";

/* Writes to real rows — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("updateDeliveryDatesAction (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";
  let deliveryId = "";
  let docNo = "";

  const INVOICE = new Date("2026-04-01T00:00:00.000+07:00");
  const DUE = new Date("2026-05-01T00:00:00.000+07:00");

  beforeEach(async () => {
    uomId = ""; itemId = ""; storeId = ""; userId = ""; orderId = ""; lineId = ""; deliveryId = ""; docNo = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-FSDA-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FSDA-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 1000 },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FSDA-STORE-${token}`, name: "Test FSDA Store", address: "Test address", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `test-fsda-${token}@example.com`, name: "Test FSDA Admin" },
    });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FSDA-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 1000,
        total: 1000,
        lines: { create: [{ itemId, variantSku: "", productName: "Test FSDA Product", qty: 1, unitPrice: 1000, lineTotal: 1000 }] },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;

    docNo = `DLV/TEST-FSDA-${token}`;
    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo,
        orderId,
        deliveredAt: new Date(),
        deliveredById: userId,
        invoiceDate: INVOICE,
        dueDate: DUE,
        subtotal: 1000,
        discountAmount: 0,
        total: 1000,
        lines: { create: [{ orderLineId: lineId, itemId, variantSku: "", productName: "Test FSDA Product", qty: 1, unitPrice: 1000, discountAmount: 0, lineTotal: 1000 }] },
      },
    });
    deliveryId = delivery.id;

    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["field_sales_orders:deliver"] } });
  });

  afterEach(async () => {
    /**
     * Cleared here rather than in `beforeEach` so the fake can never outlive this suite: a
     * `beforeEach` reset only protects tests that run after one in the SAME suite, and a stale
     * snapshot leaking into another file would silently fake a race there. Mirrors how
     * `notaDeliveryLookup.impl` is reset.
     */
    staleSnapshot.value = null;

    await prisma.auditLog.deleteMany({ where: { entityId: seededId(deliveryId) } });
    await prisma.journalLine.deleteMany({ where: { journal: { sourceId: seededId(deliveryId) } } });
    await prisma.journal.deleteMany({ where: { sourceId: seededId(deliveryId) } });
    await prisma.receivable.deleteMany({ where: { deliveryId: seededId(deliveryId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function currentDates() {
    const row = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    return { invoiceDate: row.invoiceDate.toISOString(), dueDate: row.dueDate.toISOString(), docNo: row.docNo };
  }

  it("refuses without the deliver permission and writes nothing", async () => {
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: [] } });

    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-20",
      reason: "correcting the tempo",
    });

    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await currentDates()).toMatchObject({ invoiceDate: INVOICE.toISOString() });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(deliveryId) } })).toBe(0);
  });

  it("rejects an empty reason before writing anything", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-20",
      reason: "   ",
    });

    expect(result).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(await currentDates()).toMatchObject({ dueDate: DUE.toISOString() });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(deliveryId) } })).toBe(0);
  });

  it("rejects a due date earlier than the invoice date", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-09",
      reason: "typo",
    });

    expect(result).toEqual({ ok: false, reason: "INVALID_DATES" });
    expect(await currentDates()).toMatchObject({ dueDate: DUE.toISOString() });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(deliveryId) } })).toBe(0);
  });

  it("stores both dates and writes one audit row carrying before, after and the reason", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-20",
      reason: "store agreed a shorter tempo",
    });

    expect(result).toEqual({ ok: true });

    const after = await currentDates();
    expect(after.invoiceDate).toBe(new Date("2026-04-10T00:00:00.000+07:00").toISOString());
    expect(after.dueDate).toBe(new Date("2026-04-20T00:00:00.000+07:00").toISOString());
    /* The document number is the one thing the client said must never move. */
    expect(after.docNo).toBe(docNo);

    const logs = await prisma.auditLog.findMany({ where: { entityId: seededId(deliveryId) } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("UPDATE_DELIVERY_DATES");
    expect(logs[0].entityType).toBe("FieldSalesDelivery");
    expect(logs[0].reason).toBe("store agreed a shorter tempo");
    expect(logs[0].changes).toMatchObject({
      before: { invoiceDate: INVOICE.toISOString(), dueDate: DUE.toISOString() },
      after: {
        invoiceDate: new Date("2026-04-10T00:00:00.000+07:00").toISOString(),
        dueDate: new Date("2026-04-20T00:00:00.000+07:00").toISOString(),
      },
    });
  });

  it("rejects a payload whose reason is not a string instead of throwing on it", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-20",
    } as unknown as Parameters<typeof updateDeliveryDatesAction>[0]);

    expect(result).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(await currentDates()).toMatchObject({ invoiceDate: INVOICE.toISOString() });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(deliveryId) } })).toBe(0);
  });

  /* `new Date("2026-02-30")` rolls over to 2 March; without the round-trip check that day is STORED. */
  it("rejects a date that is not a real calendar day and stores nothing", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-02-30",
      dueDate: "2026-04-20",
      reason: "crafted payload",
    });

    expect(result).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(await currentDates()).toMatchObject({
      invoiceDate: INVOICE.toISOString(),
      dueDate: DUE.toISOString(),
    });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(deliveryId) } })).toBe(0);
  });

  it("reports CONFLICT and writes nothing when the row moved under the snapshot", async () => {
    staleSnapshot.value = {
      invoiceDate: new Date("2026-01-01T00:00:00.000+07:00"),
      dueDate: new Date("2026-02-01T00:00:00.000+07:00"),
    };

    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-20",
      reason: "correcting the tempo",
    });

    expect(result).toEqual({ ok: false, reason: "CONFLICT" });
    /* The other operator's values survive, and no audit row claims a `before` nobody ever held. */
    expect(await currentDates()).toMatchObject({
      invoiceDate: INVOICE.toISOString(),
      dueDate: DUE.toISOString(),
    });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(deliveryId) } })).toBe(0);
  });

  /**
   * Pins the compare-and-swap's one assumption: the mariadb driver reports MATCHED rows, not
   * changed ones, so re-submitting the identical pair is a hit rather than a phantom CONFLICT.
   * If this ever fails, the CAS is misreading an unchanged row as someone else's write.
   */
  it("still succeeds when the correction re-submits the dates the nota already holds", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-04-01",
      dueDate: "2026-05-01",
      reason: "re-confirming the dates",
    });

    expect(result).toEqual({ ok: true });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(deliveryId) } })).toBe(1);
  });

  it("reports NOT_FOUND for an unknown delivery and writes no audit row", async () => {
    const result = await updateDeliveryDatesAction({
      deliveryId: "does-not-exist",
      invoiceDate: "2026-04-10",
      dueDate: "2026-04-20",
      reason: "typo",
    });

    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await prisma.auditLog.count({ where: { entityId: "does-not-exist" } })).toBe(0);
  });

  it("moves the receivable's dates with the delivery's", async () => {
    const receivable = await prisma.receivable.create({
      data: {
        deliveryId,
        storeId,
        invoiceDate: new Date("2026-01-01T00:00:00.000+07:00"),
        dueDate: new Date("2026-01-08T00:00:00.000+07:00"),
        originalAmount: 1000,
        outstandingAmount: 1000,
      },
    });

    const result = await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-02-01",
      dueDate: "2026-02-15",
      reason: "wrong month keyed",
    });
    expect(result.ok).toBe(true);

    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: receivable.id } });
    expect(after.invoiceDate.toISOString().slice(0, 10)).toBe("2026-01-31");
    expect(after.dueDate.toISOString().slice(0, 10)).toBe("2026-02-14");
    expect(Number(after.originalAmount)).toBe(1000);
  });

  it("re-dates the delivery's posted journals to the new invoice date", async () => {
    await prisma.receivable.create({
      data: {
        deliveryId,
        storeId,
        invoiceDate: new Date("2026-01-01T00:00:00.000+07:00"),
        dueDate: new Date("2026-01-08T00:00:00.000+07:00"),
        originalAmount: 1000,
        outstandingAmount: 1000,
      },
    });
    const journal = await prisma.journal.create({
      data: {
        date: new Date("2026-01-01T00:00:00.000+07:00"),
        description: "test revenue",
        sourceType: "FIELD_DELIVERY_REVENUE",
        sourceId: deliveryId,
        postedById: userId,
      },
    });

    await updateDeliveryDatesAction({
      deliveryId,
      invoiceDate: "2026-02-01",
      dueDate: "2026-02-15",
      reason: "wrong month keyed",
    });

    const after = await prisma.journal.findUniqueOrThrow({ where: { id: journal.id } });
    expect(after.date.toISOString().slice(0, 10)).toBe("2026-01-31");
  });
});

/**
 * Fully mocked, unlike the suite above: `recordNotaTagihanPrinted` touches `TaxInvoice` and
 * `AdminNotification`, and the generated client has no `taxInvoice` delegate yet (see the
 * `@elorae/db` mock at the top of this file), so there is no real row to write to in the first
 * place. Nothing here writes to `:3308`, so it runs regardless of which DB the environment points
 * at.
 */
describe("recordNotaTagihanPrinted", () => {
  const deliveryId = "delivery-1";
  const userId = "user-1";
  const notificationId = "notif-1";

  /*
   * A `vi.fn()`, not a bare arrow function, precisely so the CAS predicate test below can assert
   * on the `where`/`select` shape the action actually sent — a wrong relation path here would
   * throw in production and get swallowed by the outer try/catch, silently leaving a nota
   * un-notified with the test still green if this were unchecked.
   */
  const mockFindDelivery = vi.fn();

  beforeEach(() => {
    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["field_sales_orders:view"] } });

    mockUpdateMany.mockReset();
    mockAdminNotificationCreate.mockReset();
    mockAdminNotificationCreate.mockResolvedValue({
      id: notificationId,
      category: "TAX_INVOICE_PENDING",
      title: "Nota DLV/TEST-1 sudah di-print",
      message: "Nota DLV/TEST-1 untuk toko Toko Test sudah di-print. Pastikan buat faktur pajak.",
      metadata: { deliveryId, docNo: "DLV/TEST-1", storeName: "Toko Test" },
    });
    mockFanOut.mockReset();
    mockLogAudit.mockReset();
    mockLogAudit.mockResolvedValue(undefined);

    /* Stands in for the delivery + store lookup the action makes after it wins the CAS. */
    mockFindDelivery.mockReset();
    mockFindDelivery.mockResolvedValue({ docNo: "DLV/TEST-1", order: { store: { name: "Toko Test" } } });
    notaDeliveryLookup.impl = mockFindDelivery;
  });

  afterEach(() => {
    /* Never leaks into the DB-backed suite above, whose `findUnique` calls must hit the real DB. */
    notaDeliveryLookup.impl = null;
  });

  it("first print stamps notaPrintedAt and notifies", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await recordNotaTagihanPrinted(deliveryId);

    /*
     * The predicate IS the mechanism: an unconditional `updateMany({ where: { deliveryId } })`
     * would also resolve `{ count: 1 }` from a stub and pass every other assertion in this file,
     * while notifying finance on every reprint in production. Pinning the exact `where`/`data` is
     * what would catch that regression.
     */
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { deliveryId, notaPrintedAt: null },
      data: { notaPrintedAt: expect.any(Date), notaPrintedById: userId },
    });
    expect(mockFindDelivery).toHaveBeenCalledWith({
      where: { id: deliveryId },
      select: { docNo: true, order: { select: { store: { select: { name: true } } } } },
    });
    expect(mockAdminNotificationCreate).toHaveBeenCalledTimes(1);
    expect(mockFanOut).toHaveBeenCalledTimes(1);
    expect(mockFanOut).toHaveBeenCalledWith(
      expect.objectContaining({ id: notificationId, category: "TAX_INVOICE_PENDING" }),
    );
  });

  it("a reprint audits but does not notify", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    await recordNotaTagihanPrinted(deliveryId);
    expect(mockAdminNotificationCreate).not.toHaveBeenCalled();
    expect(mockFanOut).not.toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
  });

  it("never throws when the notification write fails", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockAdminNotificationCreate.mockRejectedValue(new Error("db down"));
    await expect(recordNotaTagihanPrinted(deliveryId)).resolves.toBeUndefined();
  });

  it("does nothing without the field_sales_orders:view permission", async () => {
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: [] } });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await recordNotaTagihanPrinted(deliveryId);
    expect(mockLogAudit).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockAdminNotificationCreate).not.toHaveBeenCalled();
    expect(mockFanOut).not.toHaveBeenCalled();
  });
});
