import { Test } from "@nestjs/testing";
import { ResyncProcessor } from "./resync-processor.service";
import { JubelioHttpClient } from "../jubelio-http.client";
import { JubelioWebhooksService } from "../webhooks/webhooks.service";
import { SalesOrderWebhookHandler } from "../handlers/salesorder.handler";
import { AdminNotificationService } from "../../admin/notification.service";
import { PRISMA } from "../../db/prisma.module";
import { RESYNC_STATUS } from "./resync-status";
import { RESYNC_QUEUE_DEFAULTS } from "./jubelio-resync.config";

function rowFixture(overrides: any = {}) {
  return {
    id: "r1",
    batchId: "batch1",
    salesorderNo: "SP-2606252NSQ63S0",
    salesorderId: null,
    status: RESYNC_STATUS.PENDING,
    attempts: 0,
    lastError: null,
    webhookEventId: null,
    enqueuedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("ResyncProcessor", () => {
  let processor: ResyncProcessor;
  let prisma: any;
  let client: { findSalesOrderIdByNo: jest.Mock; getSalesOrder: jest.Mock };
  let webhooks: { persist: jest.Mock };
  let handler: { handle: jest.Mock };
  let admin: { write: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioSalesOrderResync: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      jubelioWebhookEvent: {
        findUniqueOrThrow: jest.fn(),
      },
      salesOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    client = { findSalesOrderIdByNo: jest.fn(), getSalesOrder: jest.fn() };
    webhooks = { persist: jest.fn() };
    handler = { handle: jest.fn() };
    admin = { write: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        ResyncProcessor,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpClient, useValue: client },
        { provide: JubelioWebhooksService, useValue: webhooks },
        { provide: SalesOrderWebhookHandler, useValue: handler },
        { provide: AdminNotificationService, useValue: admin },
      ],
    }).compile();
    processor = mod.get(ResyncProcessor);
  });

  it("returns silently when row not found", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(null);
    await processor.process({ data: { rowId: "missing" } } as any);
    expect(client.findSalesOrderIdByNo).not.toHaveBeenCalled();
  });

  it.each([RESYNC_STATUS.DONE, RESYNC_STATUS.NOT_FOUND, RESYNC_STATUS.SKIPPED, RESYNC_STATUS.DEAD])(
    "early-returns (idempotent) when row already %s",
    async (status) => {
      prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(rowFixture({ status }));
      await processor.process({ data: { rowId: "r1" } } as any);
      expect(client.findSalesOrderIdByNo).not.toHaveBeenCalled();
      expect(client.getSalesOrder).not.toHaveBeenCalled();
      expect(webhooks.persist).not.toHaveBeenCalled();
      expect(handler.handle).not.toHaveBeenCalled();
    },
  );

  it("skips the claim silently when another worker already owns the row", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(rowFixture());
    prisma.jubelioSalesOrderResync.updateMany.mockResolvedValue({ count: 0 });

    await processor.process({ data: { rowId: "r1" } } as any);

    expect(client.findSalesOrderIdByNo).not.toHaveBeenCalled();
  });

  it("resolves no→id, fetches detail, persists a webhook event, drives the handler, marks DONE", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(rowFixture());
    client.findSalesOrderIdByNo.mockResolvedValue(999);
    const detail = { salesorder_id: 999, salesorder_no: "SP-2606252NSQ63S0", items: [] };
    client.getSalesOrder.mockResolvedValue(detail);
    webhooks.persist.mockResolvedValue({ id: "wh1", duplicate: false });
    const eventRow = { id: "wh1", event: "salesorder", rawPayload: detail };
    prisma.jubelioWebhookEvent.findUniqueOrThrow.mockResolvedValue(eventRow);
    handler.handle.mockResolvedValue({ kind: "processed" });

    await processor.process({ data: { rowId: "r1" } } as any);

    expect(client.findSalesOrderIdByNo).toHaveBeenCalledWith("SP-2606252NSQ63S0");
    expect(client.getSalesOrder).toHaveBeenCalledWith(999);
    expect(webhooks.persist).toHaveBeenCalledWith(
      expect.objectContaining({ event: "salesorder", rawBody: JSON.stringify(detail) }),
    );
    expect(handler.handle).toHaveBeenCalledWith(eventRow);

    const updates = prisma.jubelioSalesOrderResync.update.mock.calls;
    expect(updates.some((c: any[]) => c[0].data.status === RESYNC_STATUS.FETCHING)).toBe(true);
    const last = updates[updates.length - 1][0];
    expect(last.data).toMatchObject({ status: RESYNC_STATUS.DONE, webhookEventId: "wh1" });
  });

  it("marks SKIPPED (not DONE) when the handler outcome is skipped", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(rowFixture());
    client.findSalesOrderIdByNo.mockResolvedValue(999);
    const detail = { salesorder_id: 999, salesorder_no: "SP-2606252NSQ63S0", items: [] };
    client.getSalesOrder.mockResolvedValue(detail);
    webhooks.persist.mockResolvedValue({ id: "wh1", duplicate: false });
    const eventRow = { id: "wh1", event: "salesorder", rawPayload: detail };
    prisma.jubelioWebhookEvent.findUniqueOrThrow.mockResolvedValue(eventRow);
    handler.handle.mockResolvedValue({ kind: "skipped", reason: "missing_salesorder_id" });

    await processor.process({ data: { rowId: "r1" } } as any);

    const updates = prisma.jubelioSalesOrderResync.update.mock.calls;
    const last = updates[updates.length - 1][0];
    expect(last.data).toMatchObject({
      status: RESYNC_STATUS.SKIPPED,
      webhookEventId: "wh1",
      lastError: "missing_salesorder_id",
    });
    expect(last.data.status).not.toBe(RESYNC_STATUS.DONE);
  });

  it("skips resolve when salesorderId is already set on the row", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(rowFixture({ salesorderId: 555 }));
    const detail = { salesorder_id: 555, salesorder_no: "SP-2606252NSQ63S0", items: [] };
    client.getSalesOrder.mockResolvedValue(detail);
    webhooks.persist.mockResolvedValue({ id: "wh2", duplicate: false });
    prisma.jubelioWebhookEvent.findUniqueOrThrow.mockResolvedValue({ id: "wh2" });
    handler.handle.mockResolvedValue({ kind: "processed" });

    await processor.process({ data: { rowId: "r1" } } as any);

    expect(client.findSalesOrderIdByNo).not.toHaveBeenCalled();
    expect(client.getSalesOrder).toHaveBeenCalledWith(555);
  });

  it("marks NOT_FOUND when the no→id resolve comes back empty; handler never runs", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(rowFixture());
    client.findSalesOrderIdByNo.mockResolvedValue(null);

    await processor.process({ data: { rowId: "r1" } } as any);

    expect(client.getSalesOrder).not.toHaveBeenCalled();
    expect(webhooks.persist).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
    const updates = prisma.jubelioSalesOrderResync.update.mock.calls;
    expect(updates[updates.length - 1][0].data).toMatchObject({ status: RESYNC_STATUS.NOT_FOUND });
  });

  it("rethrows generic errors for BullMQ retry and records lastError", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(rowFixture());
    client.findSalesOrderIdByNo.mockResolvedValue(999);
    client.getSalesOrder.mockRejectedValue(new Error("transient Jubelio 503"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).rejects.toThrow(/transient/);

    const updates = prisma.jubelioSalesOrderResync.update.mock.calls;
    expect(updates.some((c: any[]) => c[0].data.lastError === "transient Jubelio 503")).toBe(true);
    expect(admin.write).not.toHaveBeenCalled();
  });

  it("resets a row back to PENDING (not stuck FETCHING) on a transient error, then reaches DEAD once BullMQ exhausts retries", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(rowFixture());
    client.findSalesOrderIdByNo.mockResolvedValue(999);
    client.getSalesOrder.mockRejectedValue(new Error("always fails"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).rejects.toThrow(/always fails/);

    const updates = prisma.jubelioSalesOrderResync.update.mock.calls;
    const last = updates[updates.length - 1][0];
    // Row must be reset to PENDING (re-claimable), not left stuck in FETCHING —
    // otherwise BullMQ's retry re-invokes process(), the atomic PENDING claim
    // matches 0 rows, process() returns without throwing, and BullMQ marks the
    // job completed while the row is stuck until the sweeper.
    expect(last.data).toMatchObject({ status: RESYNC_STATUS.PENDING, lastError: "always fails" });

    // Once BullMQ has exhausted all attempts, onJobFailed must still land the
    // row on DEAD (not leave it re-claimable forever).
    await processor.onJobFailed(
      { data: { rowId: "r1" }, attemptsMade: RESYNC_QUEUE_DEFAULTS.JOB_ATTEMPTS } as any,
      new Error("always fails"),
    );
    const afterFailed = prisma.jubelioSalesOrderResync.update.mock.calls;
    expect(afterFailed[afterFailed.length - 1][0].data).toMatchObject({ status: RESYNC_STATUS.DEAD });
  });

  it("marks DONE-with-warning (not DEAD) when the handler throws but the SalesOrder already landed", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(rowFixture());
    client.findSalesOrderIdByNo.mockResolvedValue(999);
    const detail = { salesorder_id: 999, salesorder_no: "SP-2606252NSQ63S0", items: [] };
    client.getSalesOrder.mockResolvedValue(detail);
    webhooks.persist.mockResolvedValue({ id: "wh9", duplicate: false });
    prisma.jubelioWebhookEvent.findUniqueOrThrow.mockResolvedValue({ id: "wh9" });
    // Handler persists the order + items, then throws on the stock reserve/consume step.
    handler.handle.mockRejectedValue(
      new Error('InventoryValue not found for (itemId=x, variantSku="27000101P-XL")'),
    );
    // The order record IS present despite the throw.
    prisma.salesOrder.findFirst.mockResolvedValue({ id: "so1" });

    // Must NOT rethrow — a landed order is a success for backfill purposes.
    await processor.process({ data: { rowId: "r1" } } as any);

    expect(prisma.salesOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salesorderId: 999 } }),
    );
    const updates = prisma.jubelioSalesOrderResync.update.mock.calls;
    const last = updates[updates.length - 1][0];
    expect(last.data.status).toBe(RESYNC_STATUS.DONE);
    expect(last.data.webhookEventId).toBe("wh9");
    expect(last.data.lastError).toMatch(/post-ingest step skipped/i);
    // Not reset to PENDING, not DEAD, no admin alert.
    expect(admin.write).not.toHaveBeenCalled();
  });

  it("still rethrows (retry path) when the handler throws AND no SalesOrder landed", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(rowFixture());
    client.findSalesOrderIdByNo.mockResolvedValue(999);
    const detail = { salesorder_id: 999, salesorder_no: "SP-2606252NSQ63S0", items: [] };
    client.getSalesOrder.mockResolvedValue(detail);
    webhooks.persist.mockResolvedValue({ id: "wh9", duplicate: false });
    prisma.jubelioWebhookEvent.findUniqueOrThrow.mockResolvedValue({ id: "wh9" });
    handler.handle.mockRejectedValue(new Error("DB write failed before order persisted"));
    prisma.salesOrder.findFirst.mockResolvedValue(null);

    await expect(processor.process({ data: { rowId: "r1" } } as any)).rejects.toThrow(/DB write failed/);

    const updates = prisma.jubelioSalesOrderResync.update.mock.calls;
    const last = updates[updates.length - 1][0];
    expect(last.data).toMatchObject({ status: RESYNC_STATUS.PENDING });
  });

  it("marks DEAD via onJobFailed when attemptsMade reaches JOB_ATTEMPTS", async () => {
    await processor.onJobFailed(
      { data: { rowId: "r1" }, attemptsMade: 5 } as any,
      new Error("final fail"),
    );
    const updates = prisma.jubelioSalesOrderResync.update.mock.calls;
    expect(updates.some((c: any[]) => c[0].data.status === RESYNC_STATUS.DEAD)).toBe(true);
    expect(admin.write).toHaveBeenCalledWith(
      expect.objectContaining({ category: "jubelio-so-resync", severity: "ERROR" }),
    );
  });

  it("does not mark DEAD via onJobFailed when attemptsMade below JOB_ATTEMPTS", async () => {
    await processor.onJobFailed(
      { data: { rowId: "r1" }, attemptsMade: 2 } as any,
      new Error("transient"),
    );
    expect(prisma.jubelioSalesOrderResync.update).not.toHaveBeenCalled();
    expect(admin.write).not.toHaveBeenCalled();
  });

  it("idempotent: re-running a DONE row does nothing (no duplicate webhook event / handler call)", async () => {
    prisma.jubelioSalesOrderResync.findUnique.mockResolvedValue(
      rowFixture({ status: RESYNC_STATUS.DONE, webhookEventId: "wh1" }),
    );

    await processor.process({ data: { rowId: "r1" } } as any);

    expect(prisma.jubelioSalesOrderResync.updateMany).not.toHaveBeenCalled();
    expect(webhooks.persist).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });
});
