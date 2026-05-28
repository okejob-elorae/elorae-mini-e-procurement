import { Test } from "@nestjs/testing";
import { WebhookProcessor } from "./webhook-processor.service";
import { JubelioEventRouter } from "./event-router";
import { AdminNotificationService } from "../../admin/notification.service";
import { PRISMA } from "../../db/prisma.module";
import { WEBHOOK_STATUS } from "./webhook-status";
import { NonRetryableError } from "./errors";

function rowFixture(overrides: any = {}) {
  return {
    id: "r1",
    event: "stock",
    rawPayload: {},
    status: WEBHOOK_STATUS.RECEIVED,
    attempts: 0,
    ...overrides,
  };
}

describe("WebhookProcessor", () => {
  let processor: WebhookProcessor;
  let prisma: any;
  let router: { route: jest.Mock };
  let admin: { write: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioWebhookEvent: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    router = { route: jest.fn() };
    admin = { write: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        WebhookProcessor,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioEventRouter, useValue: router },
        { provide: AdminNotificationService, useValue: admin },
      ],
    }).compile();
    processor = mod.get(WebhookProcessor);
  });

  it("returns silently when row not found", async () => {
    prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(null);
    await processor.process({ data: { rowId: "missing" } } as any);
    expect(router.route).not.toHaveBeenCalled();
  });

  it.each([WEBHOOK_STATUS.PROCESSED, WEBHOOK_STATUS.DEAD, WEBHOOK_STATUS.SKIPPED])(
    "early-returns when row already %s",
    async (status) => {
      prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(rowFixture({ status }));
      await processor.process({ data: { rowId: "r1" } } as any);
      expect(router.route).not.toHaveBeenCalled();
    },
  );

  it("transitions RECEIVED → PROCESSING → PROCESSED on success", async () => {
    prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "processed" });

    await processor.process({ data: { rowId: "r1" } } as any);

    const updates = prisma.jubelioWebhookEvent.update.mock.calls;
    expect(updates[0][0].data).toMatchObject({ status: WEBHOOK_STATUS.PROCESSING });
    expect(updates[updates.length - 1][0].data).toMatchObject({
      status: WEBHOOK_STATUS.PROCESSED,
    });
    expect(updates[updates.length - 1][0].data.processedAt).toBeInstanceOf(Date);
  });

  it("transitions to SKIPPED with reason", async () => {
    prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "skipped", reason: "orphan_sku:X" });

    await processor.process({ data: { rowId: "r1" } } as any);

    const updates = prisma.jubelioWebhookEvent.update.mock.calls;
    expect(updates[updates.length - 1][0].data).toMatchObject({
      status: WEBHOOK_STATUS.SKIPPED,
      skipReason: "orphan_sku:X",
    });
  });

  it("transitions to DEAD on NonRetryableError without rethrowing", async () => {
    prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(rowFixture());
    router.route.mockRejectedValue(new NonRetryableError("bad payload"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).resolves.not.toThrow();

    const updates = prisma.jubelioWebhookEvent.update.mock.calls;
    expect(updates.some((c: any[]) => c[0].data.status === WEBHOOK_STATUS.DEAD)).toBe(true);
    expect(admin.write).toHaveBeenCalledWith(
      expect.objectContaining({ category: "jubelio-webhook", severity: "ERROR" }),
    );
  });

  it("rethrows generic errors for BullMQ retry", async () => {
    prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(rowFixture());
    router.route.mockRejectedValue(new Error("transient"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).rejects.toThrow(/transient/);
    expect(admin.write).not.toHaveBeenCalled();
  });
});
