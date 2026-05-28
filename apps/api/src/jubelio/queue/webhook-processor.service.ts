import { Inject, Injectable, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Worker } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { AdminNotificationService } from "../../admin/notification.service";
import { JubelioEventRouter } from "./event-router";
import { NonRetryableError } from "./errors";
import { TERMINAL_STATUSES, WEBHOOK_STATUS } from "./webhook-status";
import { JUBELIO_WEBHOOK_QUEUE, QUEUE_DEFAULTS } from "./jubelio-queue.config";

type JobPayload = { rowId: string };

@Processor(JUBELIO_WEBHOOK_QUEUE, { concurrency: QUEUE_DEFAULTS.WORKER_CONCURRENCY })
@Injectable()
export class WebhookProcessor extends WorkerHost<Worker<JobPayload>> {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly router: JubelioEventRouter,
    private readonly admin: AdminNotificationService,
  ) {
    super();
  }

  async process(job: Job<JobPayload>): Promise<void> {
    const row = await this.prisma.jubelioWebhookEvent.findUnique({
      where: { id: job.data.rowId },
    });
    if (!row) {
      this.logger.warn(`row ${job.data.rowId} not found; ignoring`);
      return;
    }
    if (TERMINAL_STATUSES.has(row.status as never)) {
      return;
    }

    await this.prisma.jubelioWebhookEvent.update({
      where: { id: row.id },
      data: { status: WEBHOOK_STATUS.PROCESSING, attempts: { increment: 1 } },
    });

    try {
      const outcome = await this.router.route(row);
      if (outcome.kind === "skipped") {
        await this.markSkipped(row.id, outcome.reason);
      } else {
        await this.markProcessed(row.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.jubelioWebhookEvent.update({
        where: { id: row.id },
        data: { lastError: msg },
      });
      if (err instanceof NonRetryableError) {
        await this.markDead(row.id, msg);
        return;
      }
      throw err;
    }
  }

  @OnWorkerEvent("failed")
  async onJobFailed(job: Job<JobPayload>, err: Error): Promise<void> {
    if (job.attemptsMade < QUEUE_DEFAULTS.JOB_ATTEMPTS) return;
    await this.markDead(job.data.rowId, err.message);
  }

  private async markProcessed(id: string): Promise<void> {
    await this.prisma.jubelioWebhookEvent.update({
      where: { id },
      data: { status: WEBHOOK_STATUS.PROCESSED, processedAt: new Date() },
    });
  }

  private async markSkipped(id: string, reason: string): Promise<void> {
    await this.prisma.jubelioWebhookEvent.update({
      where: { id },
      data: { status: WEBHOOK_STATUS.SKIPPED, skipReason: reason, processedAt: new Date() },
    });
  }

  private async markDead(id: string, message: string): Promise<void> {
    await this.prisma.jubelioWebhookEvent.update({
      where: { id },
      data: { status: WEBHOOK_STATUS.DEAD, deadAt: new Date(), lastError: message },
    });
    await this.admin.write({
      category: "jubelio-webhook",
      severity: "ERROR",
      title: `Webhook event ${id} marked DEAD`,
      message,
    });
  }
}
