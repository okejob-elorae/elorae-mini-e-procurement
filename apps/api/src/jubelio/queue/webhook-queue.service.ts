import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JUBELIO_WEBHOOK_QUEUE, QUEUE_DEFAULTS, SWEEP } from "./jubelio-queue.config";
import { WEBHOOK_STATUS } from "./webhook-status";

@Injectable()
export class WebhookQueueService {
  private readonly logger = new Logger(WebhookQueueService.name);

  constructor(
    @InjectQueue(JUBELIO_WEBHOOK_QUEUE) private readonly q: Queue,
    @Inject(PRISMA) private readonly prisma: PrismaService,
  ) {}

  async enqueue(rowId: string): Promise<void> {
    await this.q.add(
      "process",
      { rowId },
      {
        attempts: QUEUE_DEFAULTS.JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: QUEUE_DEFAULTS.BACKOFF_BASE_MS },
        removeOnComplete: { count: QUEUE_DEFAULTS.REMOVE_ON_COMPLETE_COUNT },
        removeOnFail: { count: QUEUE_DEFAULTS.REMOVE_ON_FAIL_COUNT },
        jobId: rowId,
      },
    );
    await this.prisma.jubelioWebhookEvent.update({
      where: { id: rowId },
      data: { lastEnqueuedAt: new Date() },
    });
  }

  @Cron(SWEEP.CRON, { name: "jubelio-webhook-sweep" })
  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - SWEEP.STUCK_AFTER_MS);
    const stuck = await this.prisma.jubelioWebhookEvent.findMany({
      where: {
        OR: [
          {
            AND: [
              { status: WEBHOOK_STATUS.RECEIVED },
              { OR: [{ lastEnqueuedAt: null }, { lastEnqueuedAt: { lt: cutoff } }] },
            ],
          },
          {
            AND: [
              { status: WEBHOOK_STATUS.PROCESSING },
              { lastEnqueuedAt: { lt: cutoff } },
            ],
          },
        ],
      },
      select: { id: true, status: true },
      take: SWEEP.BATCH,
    });
    for (const row of stuck) {
      try {
        if (row.status === WEBHOOK_STATUS.PROCESSING) {
          // Crashed-mid-job recovery: revert to RECEIVED, attempts already incremented from the prior try
          await this.prisma.jubelioWebhookEvent.update({
            where: { id: row.id },
            data: { status: WEBHOOK_STATUS.RECEIVED },
          });
        }
        await this.enqueue(row.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Sweep failed to re-enqueue ${row.id}: ${msg}`);
      }
    }
    if (stuck.length > 0) {
      this.logger.warn(`Sweeper re-enqueued ${stuck.length} stuck webhook rows`);
    }
  }
}
