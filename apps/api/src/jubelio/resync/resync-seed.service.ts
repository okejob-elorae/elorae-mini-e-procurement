import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { RESYNC_STATUS } from "./resync-status";

export type SeedResyncBatchInput = {
  salesorderNos: string[];
  enqueuedById?: string;
};

export type SeedResyncBatchResult = {
  batchId: string;
  seeded: number;
};

@Injectable()
export class ResyncSeedService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaService) {}

  /**
   * Seeds a new batch of JubelioSalesOrderResync rows under a fresh batchId.
   * The poller (5s interval) picks up PENDING rows and enqueues them — this
   * intentionally does NOT enqueue synchronously so a bulk (thousands-of-rows)
   * request returns fast.
   */
  async seedBatch(input: SeedResyncBatchInput): Promise<SeedResyncBatchResult> {
    const batchId = randomUUID();
    const nos = Array.from(
      new Set(input.salesorderNos.map((no) => no.trim()).filter((no) => no.length > 0)),
    );

    if (nos.length === 0) {
      return { batchId, seeded: 0 };
    }

    const result = await this.prisma.jubelioSalesOrderResync.createMany({
      data: nos.map((salesorderNo) => ({
        batchId,
        salesorderNo,
        status: RESYNC_STATUS.PENDING,
        enqueuedById: input.enqueuedById ?? null,
      })),
      skipDuplicates: true,
    });

    return { batchId, seeded: result.count };
  }
}
