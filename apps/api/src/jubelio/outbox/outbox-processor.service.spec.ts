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

  function updateData() {
    return prisma.jubelioOutbox.update.mock.calls.map((c: any[]) => c[0].data);
  }

  /**
   * Stateful on purpose. A mock that always reports PENDING and always grants the
   * claim passes whether or not the catch block releases the row, so it cannot
   * see the wedge this suite exists to guard. Here `update` applies its `data` to
   * the row and `updateMany` honours the status precondition, so a row left
   * PROCESSING really does lose the next claim.
   */
  function statefulOutboxMock(initial: any = rowFixture()) {
    let row = { ...initial };
    return {
      current: () => row,
      findUnique: jest.fn(async () => (row ? { ...row } : null)),
      update: jest.fn(async ({ data }: any) => {
        row = { ...row, ...data };
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const allowed: string[] = where?.status?.in ?? [];
        if (allowed.length > 0 && !allowed.includes(row.status)) return { count: 0 };
        const { attempts, ...rest } = data;
        row = { ...row, ...rest };
        if (attempts?.increment) row.attempts += attempts.increment;
        return { count: 1 };
      }),
    };
  }

  beforeEach(async () => {
    prisma = {
      jubelioOutbox: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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

  it("claims the row from PENDING only, incrementing attempts", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "processed" });

    await processor.process({ data: { rowId: "r1" } } as any);

    expect(prisma.jubelioOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", status: { in: [OUTBOX_STATUS.PENDING] } },
      data: { status: OUTBOX_STATUS.PROCESSING, attempts: { increment: 1 } },
    });
  });

  it("skips the duplicate fire when another worker won the claim", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    prisma.jubelioOutbox.updateMany.mockResolvedValue({ count: 0 });

    await processor.process({ data: { rowId: "r1" } } as any);

    expect(router.route).not.toHaveBeenCalled();
    expect(prisma.jubelioOutbox.update).not.toHaveBeenCalled();
  });

  it("transitions to DONE on success", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "processed" });

    await processor.process({ data: { rowId: "r1" } } as any);

    const last = updateData().at(-1);
    expect(last).toMatchObject({ status: OUTBOX_STATUS.DONE });
    expect(last.processedAt).toBeInstanceOf(Date);
  });

  it("transitions to SKIPPED with reason", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "skipped", reason: "missing_mapping" });

    await processor.process({ data: { rowId: "r1" } } as any);

    expect(updateData().at(-1)).toMatchObject({
      status: OUTBOX_STATUS.SKIPPED,
      skipReason: "missing_mapping",
    });
  });

  it("transitions to DEAD on NonRetryableError without rethrowing", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockRejectedValue(new NonRetryableError("bad payload"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).resolves.not.toThrow();

    expect(updateData().some((d: any) => d.status === OUTBOX_STATUS.DEAD)).toBe(true);
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

  it("releases the claim back to PENDING on a retryable failure", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockRejectedValue(new Error("transient Jubelio 503"));

    await expect(
      processor.process({ data: { rowId: "r1" }, attemptsMade: 0 } as any),
    ).rejects.toThrow();

    expect(updateData()).toContainEqual(
      expect.objectContaining({
        status: OUTBOX_STATUS.PENDING,
        lastError: "transient Jubelio 503",
      }),
    );
  });

  it("lets a released row be re-claimed by the next attempt", async () => {
    const store = statefulOutboxMock();
    prisma.jubelioOutbox = store;
    router.route.mockRejectedValueOnce(new Error("transient Jubelio 503"));

    await expect(
      processor.process({ data: { rowId: "r1" }, attemptsMade: 0 } as any),
    ).rejects.toThrow();
    expect(store.current().status).toBe(OUTBOX_STATUS.PENDING);

    router.route.mockResolvedValue({ kind: "processed" });
    await processor.process({ data: { rowId: "r1" }, attemptsMade: 1 } as any);

    expect(store.current().status).toBe(OUTBOX_STATUS.DONE);
    expect(store.current().attempts).toBe(2);
  });

  it("keeps the claim on the final attempt so the DEAD write cannot be raced", async () => {
    const store = statefulOutboxMock();
    prisma.jubelioOutbox = store;
    router.route.mockRejectedValue(new Error("transient Jubelio 503"));

    await expect(
      processor.process({ data: { rowId: "r1" }, attemptsMade: 4 } as any),
    ).rejects.toThrow();

    expect(store.current().status).toBe(OUTBOX_STATUS.PROCESSING);
    expect(store.current().lastError).toBe("transient Jubelio 503");
  });

  it("a row left PROCESSING loses the next claim — the wedge this guards against", async () => {
    const store = statefulOutboxMock(rowFixture({ status: OUTBOX_STATUS.PROCESSING }));
    prisma.jubelioOutbox = store;

    await processor.process({ data: { rowId: "r1" }, attemptsMade: 1 } as any);

    expect(router.route).not.toHaveBeenCalled();
    expect(store.current().attempts).toBe(0);
  });

  it("marks DEAD via onJobFailed when attemptsMade reaches JOB_ATTEMPTS", async () => {
    await processor.onJobFailed(
      { data: { rowId: "r1" }, attemptsMade: 5 } as any,
      new Error("final fail"),
    );
    expect(updateData().some((d: any) => d.status === OUTBOX_STATUS.DEAD)).toBe(true);
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
