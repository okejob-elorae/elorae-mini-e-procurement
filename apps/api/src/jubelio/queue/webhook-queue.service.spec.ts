import { Test } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { WebhookQueueService } from "./webhook-queue.service";
import { PRISMA } from "../../db/prisma.module";
import { JUBELIO_WEBHOOK_QUEUE } from "./jubelio-queue.config";
import { WEBHOOK_STATUS } from "./webhook-status";

function jobStub(state: string) {
  return {
    getState: jest.fn().mockResolvedValue(state),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

describe("WebhookQueueService", () => {
  let service: WebhookQueueService;
  let prisma: any;
  let queue: { add: jest.Mock; getJob: jest.Mock };

  function updateData() {
    return prisma.jubelioWebhookEvent.update.mock.calls.map((c: any[]) => c[0].data);
  }

  beforeEach(async () => {
    prisma = {
      jubelioWebhookEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    queue = {
      add: jest.fn().mockResolvedValue({ id: "w1" }),
      getJob: jest.fn().mockResolvedValue(null),
    };
    const mod = await Test.createTestingModule({
      providers: [
        WebhookQueueService,
        { provide: PRISMA, useValue: prisma },
        { provide: getQueueToken(JUBELIO_WEBHOOK_QUEUE), useValue: queue },
      ],
    }).compile();
    service = mod.get(WebhookQueueService);
  });

  it("enqueues with the row id as jobId and stamps lastEnqueuedAt", async () => {
    await service.enqueue("w1");

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).toEqual({ rowId: "w1" });
    expect(queue.add.mock.calls[0][2]).toMatchObject({ jobId: "w1", attempts: 5 });
    expect(updateData().at(-1)?.lastEnqueuedAt).toBeInstanceOf(Date);
  });

  /**
   * The wedge this guards against: without removing the settled job first, add()
   * on the occupied jobId is a silent no-op, so an admin Retry on a DEAD webhook
   * row re-queues nothing while `lastEnqueuedAt` keeps advancing every sweep.
   */
  it.each(["completed", "failed", "unknown"])(
    "removes the retained %s job so add() is not a silent no-op",
    async (state) => {
      const job = jobStub(state);
      queue.getJob.mockResolvedValue(job);

      await service.enqueue("w1");

      expect(job.remove).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["waiting", "active", "delayed", "prioritized"])(
    "leaves a live %s job alone instead of duplicating it",
    async (state) => {
      const job = jobStub(state);
      queue.getJob.mockResolvedValue(job);

      await service.enqueue("w1");

      expect(job.remove).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(updateData().at(-1)?.lastEnqueuedAt).toBeInstanceOf(Date);
    },
  );

  it("reverts a stuck PROCESSING row to RECEIVED before re-enqueueing it", async () => {
    prisma.jubelioWebhookEvent.findMany.mockResolvedValue([
      { id: "w1", status: WEBHOOK_STATUS.PROCESSING },
    ]);

    await service.sweep();

    expect(updateData()[0]).toEqual({ status: WEBHOOK_STATUS.RECEIVED });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it("keeps sweeping after one row throws", async () => {
    prisma.jubelioWebhookEvent.findMany.mockResolvedValue([
      { id: "bad", status: WEBHOOK_STATUS.RECEIVED },
      { id: "good", status: WEBHOOK_STATUS.RECEIVED },
    ]);
    queue.getJob.mockRejectedValueOnce(new Error("redis down"));

    await service.sweep();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).toEqual({ rowId: "good" });
  });
});
