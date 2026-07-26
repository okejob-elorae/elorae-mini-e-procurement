import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import {
  JUBELIO_RESYNC_QUEUE,
  RESYNC_POLLER,
  RESYNC_QUEUE_DEFAULTS,
} from "./jubelio-resync.config";
import { IN_FLIGHT_RESYNC_STATUSES, RESYNC_STATUS } from "./resync-status";

@Injectable()
export class ResyncPoller {
  private readonly logger = new Logger(ResyncPoller.name);

  constructor(
    @InjectQueue(JUBELIO_RESYNC_QUEUE) private readonly q: Queue,
    @Inject(PRISMA) private readonly prisma: PrismaService,
  ) {}

  async enqueueById(rowId: string): Promise<void> {
    const row = await this.prisma.jubelioSalesOrderResync.findUnique({
      where: { id: rowId },
      select: { status: true },
    });
    if (!row) return;
    if (IN_FLIGHT_RESYNC_STATUSES.has(row.status as never)) {
      // Reset a stuck RESOLVING/FETCHING row back to PENDING so the processor's
      // atomic PENDING→RESOLVING claim can pick it up again.
      await this.prisma.jubelioSalesOrderResync.update({
        where: { id: rowId },
        data: { status: RESYNC_STATUS.PENDING },
      });
    }
    await this.q.add(
      "process",
      { rowId },
      {
        attempts: RESYNC_QUEUE_DEFAULTS.JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: RESYNC_QUEUE_DEFAULTS.BACKOFF_BASE_MS },
        removeOnComplete: { count: RESYNC_QUEUE_DEFAULTS.REMOVE_ON_COMPLETE_COUNT },
        removeOnFail: { count: RESYNC_QUEUE_DEFAULTS.REMOVE_ON_FAIL_COUNT },
        jobId: rowId,
      },
    );
  }

  @Interval("jubelio-resync-poller", RESYNC_POLLER.INTERVAL_MS)
  async poll(): Promise<void> {
    const cutoff = new Date(Date.now() - RESYNC_POLLER.STUCK_AFTER_MS);
    const ready = await this.prisma.jubelioSalesOrderResync.findMany({
      where: {
        OR: [
          { status: RESYNC_STATUS.PENDING },
          { status: RESYNC_STATUS.RESOLVING, updatedAt: { lt: cutoff } },
          { status: RESYNC_STATUS.FETCHING, updatedAt: { lt: cutoff } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true },
      take: RESYNC_POLLER.BATCH,
    });

    for (const row of ready) {
      try {
        await this.enqueueById(row.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Resync poller failed on ${row.id}: ${msg}`);
      }
    }
    if (ready.length > 0) {
      this.logger.log(`Resync poller enqueued ${ready.length} rows`);
    }
  }
}
