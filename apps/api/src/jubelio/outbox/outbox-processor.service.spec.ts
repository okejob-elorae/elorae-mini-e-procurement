import { Test } from "@nestjs/testing";
import { OutboxProcessor } from "./outbox-processor.service";
import { OutboxRouter } from "./outbox-router";
import { AdminNotificationService } from "../../admin/notification.service";
import { PRISMA } from "../../db/prisma.module";
import { OUTBOX_STATUS } from "./outbox-status";
import { NonRetryableError } from "../queue/errors";

function rowFixture(overrides: any = {}) {
  return {
    id: "r1",
    entityType: "stock_push",
    entityId: "item_1",
    payload: {},
    status: OUTBOX_STATUS.PENDING,
    attempts: 0,
    ...overrides,
  };
}

describe("OutboxProcessor", () => {
  let processor: OutboxProcessor;
  let prisma: any;
  let router: { route: jest.Mock };
  let admin: { write: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioOutbox: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    router = { route: jest.fn() };
    admin = { write: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        OutboxProcessor,
        { provide: PRISMA, useValue: prisma },
        { provide: OutboxRouter, useValue: router },
        { provide: AdminNotificationService, useValue: admin },
      ],
    }).compile();
    processor = mod.get(OutboxProcessor);
  });

  it("returns silently when row not found", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(null);
    await processor.process({ data: { rowId: "missing" } } as any);
    expect(router.route).not.toHaveBeenCalled();
  });

  it.each([OUTBOX_STATUS.DONE, OUTBOX_STATUS.SKIPPED, OUTBOX_STATUS.DEAD])(
    "early-returns when row already %s",
    async (status) => {
      prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture({ status }));
      await processor.process({ data: { rowId: "r1" } } as any);
      expect(router.route).not.toHaveBeenCalled();
    },
  );

  it("transitions PENDING → PROCESSING → DONE on success", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "processed" });

    await processor.process({ data: { rowId: "r1" } } as any);

    const updates = prisma.jubelioOutbox.update.mock.calls;
    expect(updates[0][0].data).toMatchObject({ status: OUTBOX_STATUS.PROCESSING });
    expect(updates[updates.length - 1][0].data).toMatchObject({ status: OUTBOX_STATUS.DONE });
    expect(updates[updates.length - 1][0].data.processedAt).toBeInstanceOf(Date);
  });

  it("transitions to SKIPPED with reason", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "skipped", reason: "missing_mapping" });

    await processor.process({ data: { rowId: "r1" } } as any);

    const updates = prisma.jubelioOutbox.update.mock.calls;
    expect(updates[updates.length - 1][0].data).toMatchObject({
      status: OUTBOX_STATUS.SKIPPED,
      skipReason: "missing_mapping",
    });
  });

  it("transitions to DEAD on NonRetryableError without rethrowing", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockRejectedValue(new NonRetryableError("bad payload"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).resolves.not.toThrow();

    const updates = prisma.jubelioOutbox.update.mock.calls;
    expect(updates.some((c: any[]) => c[0].data.status === OUTBOX_STATUS.DEAD)).toBe(true);
    expect(admin.write).toHaveBeenCalledWith(
      expect.objectContaining({ category: "jubelio-outbox", severity: "ERROR" }),
    );
  });

  it("rethrows generic errors for BullMQ retry", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockRejectedValue(new Error("transient Jubelio 503"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).rejects.toThrow(/transient/);
    expect(admin.write).not.toHaveBeenCalled();
  });

  it("marks DEAD via onJobFailed when attemptsMade reaches JOB_ATTEMPTS", async () => {
    await processor.onJobFailed(
      { data: { rowId: "r1" }, attemptsMade: 5 } as any,
      new Error("final fail"),
    );
    const updates = prisma.jubelioOutbox.update.mock.calls;
    expect(updates.some((c: any[]) => c[0].data.status === OUTBOX_STATUS.DEAD)).toBe(true);
    expect(admin.write).toHaveBeenCalled();
  });

  it("does not mark DEAD via onJobFailed when attemptsMade below JOB_ATTEMPTS", async () => {
    await processor.onJobFailed(
      { data: { rowId: "r1" }, attemptsMade: 2 } as any,
      new Error("transient"),
    );
    expect(prisma.jubelioOutbox.update).not.toHaveBeenCalled();
    expect(admin.write).not.toHaveBeenCalled();
  });
});
