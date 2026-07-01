import { Inject, Injectable, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Worker } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { AdminNotificationService } from "../../admin/notification.service";
import { OutboxRouter } from "./outbox-router";
import { NonRetryableError } from "../queue/errors";
import { OUTBOX_STATUS, TERMINAL_OUTBOX_STATUSES } from "./outbox-status";
import { JUBELIO_OUTBOX_QUEUE, OUTBOX_QUEUE_DEFAULTS } from "./jubelio-outbox.config";

type JobPayload = { rowId: string };

@Processor(JUBELIO_OUTBOX_QUEUE, { concurrency: OUTBOX_QUEUE_DEFAULTS.WORKER_CONCURRENCY })
@Injectable()
export class OutboxProcessor extends WorkerHost<Worker<JobPayload>> {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly router: OutboxRouter,
    private readonly admin: AdminNotificationService,
  ) {
    super();
  }

  async process(job: Job<JobPayload>): Promise<void> {
    const row = await this.prisma.jubelioOutbox.findUnique({
      where: { id: job.data.rowId },
    });
    if (!row) {
      this.logger.warn(`row ${job.data.rowId} not found; ignoring`);
      return;
    }
    if (TERMINAL_OUTBOX_STATUSES.has(row.status as never)) {
      return;
    }

    // Atomic claim: only proceed if this call wins the PENDING → PROCESSING transition.
    // Prevents double-fire when BullMQ schedules a retry concurrent with a still-running
    // attempt, or when the poller re-enqueues a row before the first worker finishes.
    const claim = await this.prisma.jubelioOutbox.updateMany({
      where: { id: row.id, status: { in: [OUTBOX_STATUS.PENDING] } },
      data: { status: OUTBOX_STATUS.PROCESSING, attempts: { increment: 1 } },
    });
    if (claim.count === 0) {
      this.logger.warn(`row ${row.id} already claimed by another worker; skipping duplicate fire`);
      return;
    }

    try {
      const outcome = await this.router.route(row);
      if (outcome.kind === "skipped") {
        await this.markSkipped(row.id, outcome.reason);
      } else {
        await this.markDone(row.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.jubelioOutbox.update({
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
    if (job.attemptsMade < OUTBOX_QUEUE_DEFAULTS.JOB_ATTEMPTS) return;
    await this.markDead(job.data.rowId, err.message);
  }

  private async markDone(id: string): Promise<void> {
    await this.prisma.jubelioOutbox.update({
      where: { id },
      data: { status: OUTBOX_STATUS.DONE, processedAt: new Date() },
    });
  }

  private async markSkipped(id: string, reason: string): Promise<void> {
    await this.prisma.jubelioOutbox.update({
      where: { id },
      data: { status: OUTBOX_STATUS.SKIPPED, skipReason: reason, processedAt: new Date() },
    });
  }

  private async markDead(id: string, message: string): Promise<void> {
    await this.prisma.jubelioOutbox.update({
      where: { id },
      data: { status: OUTBOX_STATUS.DEAD, deadAt: new Date(), lastError: message },
    });
    await this.admin.write({
      category: "jubelio-outbox",
      severity: "ERROR",
      title: `Outbox row ${id} marked DEAD`,
      message,
    });
  }
}
