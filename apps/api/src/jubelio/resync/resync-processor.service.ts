import { Inject, Injectable, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Worker } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { AdminNotificationService } from "../../admin/notification.service";
import { JubelioHttpClient } from "../jubelio-http.client";
import { JubelioWebhooksService } from "../webhooks/webhooks.service";
import { SalesOrderWebhookHandler } from "../handlers/salesorder.handler";
import { JUBELIO_RESYNC_QUEUE, RESYNC_QUEUE_DEFAULTS } from "./jubelio-resync.config";
import { RESYNC_STATUS, TERMINAL_RESYNC_STATUSES } from "./resync-status";

type JobPayload = { rowId: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Per row: resolve salesorder_no → salesorder_id (skip if already resolved) →
 * fetch the detail → synthesize + persist a JubelioWebhookEvent → drive the
 * existing SalesOrderWebhookHandler verbatim (zero writer changes) → mark
 * DONE. Not found in any Jubelio list → NOT_FOUND (terminal, not an error).
 * Mirrors OutboxProcessor's claim/terminal/dead lifecycle.
 */
@Processor(JUBELIO_RESYNC_QUEUE, { concurrency: RESYNC_QUEUE_DEFAULTS.WORKER_CONCURRENCY })
@Injectable()
export class ResyncProcessor extends WorkerHost<Worker<JobPayload>> {
  private readonly logger = new Logger(ResyncProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly client: JubelioHttpClient,
    private readonly webhooks: JubelioWebhooksService,
    private readonly handler: SalesOrderWebhookHandler,
    private readonly admin: AdminNotificationService,
  ) {
    super();
  }

  async process(job: Job<JobPayload>): Promise<void> {
    const row = await this.prisma.jubelioSalesOrderResync.findUnique({
      where: { id: job.data.rowId },
    });
    if (!row) {
      this.logger.warn(`row ${job.data.rowId} not found; ignoring`);
      return;
    }
    if (TERMINAL_RESYNC_STATUSES.has(row.status as never)) {
      return;
    }

    // Atomic claim: only proceed if this call wins the PENDING → RESOLVING
    // transition. Prevents double-fire when BullMQ schedules a retry
    // concurrent with a still-running attempt, or when the poller re-enqueues
    // a row before the first worker finishes (same guard as OutboxProcessor).
    const claim = await this.prisma.jubelioSalesOrderResync.updateMany({
      where: { id: row.id, status: { in: [RESYNC_STATUS.PENDING] } },
      data: { status: RESYNC_STATUS.RESOLVING, attempts: { increment: 1 } },
    });
    if (claim.count === 0) {
      this.logger.warn(`row ${row.id} already claimed by another worker; skipping duplicate fire`);
      return;
    }

    try {
      let salesorderId: number | null = row.salesorderId;
      if (!salesorderId) {
        const resolved = await this.client.findSalesOrderIdByNo(row.salesorderNo);
        if (!resolved) {
          await this.markNotFound(row.id);
          await sleep(RESYNC_QUEUE_DEFAULTS.INTER_JOB_DELAY_MS);
          return;
        }
        salesorderId = resolved;
      }
      const resolvedSalesorderId: number = salesorderId;

      await this.prisma.jubelioSalesOrderResync.update({
        where: { id: row.id },
        data: { status: RESYNC_STATUS.FETCHING, salesorderId: resolvedSalesorderId },
      });

      const detail = await this.client.getSalesOrder(resolvedSalesorderId);

      const persisted = await this.webhooks.persist({
        event: "salesorder",
        rawBody: JSON.stringify(detail),
        // Synthesized events don't come with a real HMAC signature — this
        // string is only for audit/traceability, never verified.
        signature: `resync:${row.batchId}:${row.id}`,
      });

      const event = await this.prisma.jubelioWebhookEvent.findUniqueOrThrow({
        where: { id: persisted.id },
      });
      await this.handler.handle(event);

      await this.markDone(row.id, persisted.id);
      await sleep(RESYNC_QUEUE_DEFAULTS.INTER_JOB_DELAY_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.jubelioSalesOrderResync.update({
        where: { id: row.id },
        data: { lastError: msg },
      });
      throw err;
    }
  }

  @OnWorkerEvent("failed")
  async onJobFailed(job: Job<JobPayload>, err: Error): Promise<void> {
    if (job.attemptsMade < RESYNC_QUEUE_DEFAULTS.JOB_ATTEMPTS) return;
    await this.markDead(job.data.rowId, err.message);
  }

  private async markDone(id: string, webhookEventId: string): Promise<void> {
    await this.prisma.jubelioSalesOrderResync.update({
      where: { id },
      data: { status: RESYNC_STATUS.DONE, webhookEventId },
    });
  }

  private async markNotFound(id: string): Promise<void> {
    await this.prisma.jubelioSalesOrderResync.update({
      where: { id },
      data: {
        status: RESYNC_STATUS.NOT_FOUND,
        lastError: "Not found in Jubelio completed/cancel/failed order lists",
      },
    });
  }

  private async markDead(id: string, message: string): Promise<void> {
    await this.prisma.jubelioSalesOrderResync.update({
      where: { id },
      data: { status: RESYNC_STATUS.DEAD, lastError: message },
    });
    await this.admin.write({
      category: "jubelio-so-resync",
      severity: "ERROR",
      title: `Salesorder resync row ${id} marked DEAD`,
      message,
    });
  }
}
