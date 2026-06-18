import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { prisma } from "@elorae/db";
import { JubelioHttpClient } from "../jubelio-http.client";
import { SalesReturnIngestService } from "./sales-return-ingest.service";

@Injectable()
export class ReturnsSweeperService {
  private readonly logger = new Logger(ReturnsSweeperService.name);

  constructor(
    private readonly jubelio: JubelioHttpClient,
    private readonly ingest: SalesReturnIngestService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    const rows = await this.jubelio.listUnprocessedReturns();
    if (rows.length === 0) return;

    let ingestedCount = 0;
    for (const row of rows) {
      if (!row.return_id) continue;
      const exists = await prisma.salesReturn.findUnique({
        where: { jubelioReturnId: row.return_id },
        select: { id: true },
      });
      if (exists) continue;

      try {
        const detail = await this.jubelio.getSalesReturn(row.return_id);
        await this.ingest.upsertFromApiDetail(detail);
        ingestedCount++;
      } catch (err) {
        this.logger.warn(
          `Backstop ingest failed for return_id=${row.return_id}: ${(err as Error).message}`,
        );
      }
    }
    if (ingestedCount > 0) {
      this.logger.log(`Returns backstop ingested ${ingestedCount} new returns`);
    }
  }
}
