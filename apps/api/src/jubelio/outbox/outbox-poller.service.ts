import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import {
  JUBELIO_OUTBOX_QUEUE,
  OUTBOX_POLLER,
  OUTBOX_QUEUE_DEFAULTS,
} from "./jubelio-outbox.config";
import { OUTBOX_STATUS } from "./outbox-status";

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
    if (row.status === OUTBOX_STATUS.PROCESSING) {
      await this.prisma.jubelioOutbox.update({
        where: { id: rowId },
        data: { status: OUTBOX_STATUS.PENDING },
      });
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
