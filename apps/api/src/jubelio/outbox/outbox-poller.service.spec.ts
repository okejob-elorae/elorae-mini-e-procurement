import { Test } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { OutboxPoller } from "./outbox-poller.service";
import { PRISMA } from "../../db/prisma.module";
import { JUBELIO_OUTBOX_QUEUE } from "./jubelio-outbox.config";
import { OUTBOX_STATUS } from "./outbox-status";

function jobStub(state: string) {
  return {
    getState: jest.fn().mockResolvedValue(state),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

describe("OutboxPoller", () => {
  let poller: OutboxPoller;
  let prisma: any;
  let queue: { add: jest.Mock; getJob: jest.Mock };

  function updateData() {
    return prisma.jubelioOutbox.update.mock.calls.map((c: any[]) => c[0].data);
  }

  beforeEach(async () => {
    prisma = {
      jubelioOutbox: {
        findUnique: jest.fn().mockResolvedValue({ status: OUTBOX_STATUS.PENDING }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    queue = {
      add: jest.fn().mockResolvedValue({ id: "r1" }),
      getJob: jest.fn().mockResolvedValue(null),
    };
    const mod = await Test.createTestingModule({
      providers: [
        OutboxPoller,
        { provide: PRISMA, useValue: prisma },
        { provide: getQueueToken(JUBELIO_OUTBOX_QUEUE), useValue: queue },
      ],
    }).compile();
    poller = mod.get(OutboxPoller);
  });

  it("returns silently when the row is gone", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(null);
    await poller.enqueueById("missing");
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.jubelioOutbox.update).not.toHaveBeenCalled();
  });

  it.each([OUTBOX_STATUS.DONE, OUTBOX_STATUS.SKIPPED, OUTBOX_STATUS.DEAD])(
    "refuses to re-enqueue a settled %s row",
    async (status) => {
      prisma.jubelioOutbox.findUnique.mockResolvedValue({ status });
      await poller.enqueueById("r1");
      expect(queue.add).not.toHaveBeenCalled();
      expect(prisma.jubelioOutbox.update).not.toHaveBeenCalled();
    },
  );

  it("enqueues a PENDING row with the row id as jobId and stamps lastEnqueuedAt", async () => {
    await poller.enqueueById("r1");

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).toEqual({ rowId: "r1" });
    expect(queue.add.mock.calls[0][2]).toMatchObject({ jobId: "r1", attempts: 5 });
    expect(updateData().at(-1)?.lastEnqueuedAt).toBeInstanceOf(Date);
  });

  it("resets a stuck PROCESSING row to PENDING before enqueueing", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue({ status: OUTBOX_STATUS.PROCESSING });
    await poller.enqueueById("r1");
    expect(updateData()[0]).toEqual({ status: OUTBOX_STATUS.PENDING });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it.each(["completed", "failed", "unknown"])(
    "removes the retained %s job so add() is not a silent no-op",
    async (state) => {
      const job = jobStub(state);
      queue.getJob.mockResolvedValue(job);

      await poller.enqueueById("r1");

      expect(job.remove).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["waiting", "active", "delayed", "prioritized"])(
    "leaves a live %s job alone instead of duplicating it",
    async (state) => {
      const job = jobStub(state);
      queue.getJob.mockResolvedValue(job);

      await poller.enqueueById("r1");

      expect(job.remove).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it("still stamps lastEnqueuedAt when a live job already owns the row", async () => {
    queue.getJob.mockResolvedValue(jobStub("waiting"));
    await poller.enqueueById("r1");
    expect(updateData().at(-1)?.lastEnqueuedAt).toBeInstanceOf(Date);
  });

  it("keeps going after one row throws", async () => {
    prisma.jubelioOutbox.findMany.mockResolvedValue([{ id: "bad" }, { id: "good" }]);
    queue.getJob.mockRejectedValueOnce(new Error("redis down"));

    await poller.poll();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).toEqual({ rowId: "good" });
  });

  it("sweeps unenqueued and stale rows only", async () => {
    await poller.poll();
    const where = prisma.jubelioOutbox.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { status: OUTBOX_STATUS.PENDING, lastEnqueuedAt: null },
      { status: OUTBOX_STATUS.PENDING, lastEnqueuedAt: { lt: expect.any(Date) } },
      { status: OUTBOX_STATUS.PROCESSING, lastEnqueuedAt: { lt: expect.any(Date) } },
    ]);
  });
});
