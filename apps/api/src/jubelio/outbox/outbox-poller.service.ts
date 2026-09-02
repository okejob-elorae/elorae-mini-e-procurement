import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { clearFinishedJob } from "../queue/finished-jobs";
import {
  JUBELIO_OUTBOX_QUEUE,
  OUTBOX_POLLER,
  OUTBOX_QUEUE_DEFAULTS,
} from "./jubelio-outbox.config";
import { OUTBOX_STATUS, TERMINAL_OUTBOX_STATUSES, type OutboxStatus } from "./outbox-status";

@Injectable()
export class OutboxPoller {
  private readonly logger = new Logger(OutboxPoller.name);

  constructor(
    @InjectQueue(JUBELIO_OUTBOX_QUEUE) private readonly q: Queue,
    @Inject(PRISMA) private readonly prisma: PrismaService,
  ) {}

  async enqueueById(rowId: string): Promise<void> {
    const row = await this.prisma.jubelioOutbox.findUnique({
      where: { id: rowId },
      select: { status: true },
    });
    if (!row) return;
    if (TERMINAL_OUTBOX_STATUSES.has(row.status as OutboxStatus)) {
      this.logger.warn(`row ${rowId} is ${row.status}; refusing to re-enqueue a settled row`);
      return;
    }
    if (row.status === OUTBOX_STATUS.PROCESSING) {
      await this.prisma.jubelioOutbox.update({
        where: { id: rowId },
        data: { status: OUTBOX_STATUS.PENDING },
      });
    }

    /**
     * The jobId is the row id so a row can never be queued twice concurrently.
     * The cost is that BullMQ retains finished jobs, and `add()` on an existing
     * jobId is a SILENT no-op — which is how a failed row used to sit PENDING
     * forever, re-swept every five minutes, retried zero times, never DEAD, and
     * never alerted on. Clear the finished job before re-adding; leave a live one
     * alone, because a live job already is the enqueue this call wanted.
     */
    if (!(await clearFinishedJob(this.q, rowId))) {
      this.logger.debug(`row ${rowId} already has a live job; leaving it to run`);
      await this.markEnqueued(rowId);
      return;
    }

    await this.q.add(
      "process",
      { rowId },
      {
        attempts: OUTBOX_QUEUE_DEFAULTS.JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: OUTBOX_QUEUE_DEFAULTS.BACKOFF_BASE_MS },
        removeOnComplete: { count: OUTBOX_QUEUE_DEFAULTS.REMOVE_ON_COMPLETE_COUNT },
        removeOnFail: { count: OUTBOX_QUEUE_DEFAULTS.REMOVE_ON_FAIL_COUNT },
        jobId: rowId,
      },
    );
    await this.markEnqueued(rowId);
  }

  private async markEnqueued(rowId: string): Promise<void> {
    await this.prisma.jubelioOutbox.update({
      where: { id: rowId },
      data: { lastEnqueuedAt: new Date() },
    });
  }

  @Interval("jubelio-outbox-poller", OUTBOX_POLLER.INTERVAL_MS)
  async poll(): Promise<void> {
    const cutoff = new Date(Date.now() - OUTBOX_POLLER.STUCK_AFTER_MS);
    const ready = await this.prisma.jubelioOutbox.findMany({
      where: {
        OR: [
          { status: OUTBOX_STATUS.PENDING, lastEnqueuedAt: null },
          { status: OUTBOX_STATUS.PENDING, lastEnqueuedAt: { lt: cutoff } },
          { status: OUTBOX_STATUS.PROCESSING, lastEnqueuedAt: { lt: cutoff } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true },
      take: OUTBOX_POLLER.BATCH,
    });

    for (const row of ready) {
      try {
        await this.enqueueById(row.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Poller failed on ${row.id}: ${msg}`);
      }
    }
    if (ready.length > 0) {
      this.logger.log(`Outbox poller enqueued ${ready.length} rows`);
    }
  }
}
