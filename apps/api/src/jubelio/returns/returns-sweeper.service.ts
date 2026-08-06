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
    let rows: Awaited<ReturnType<JubelioHttpClient["listReturnedOrders"]>>;
    try {
      rows = await this.jubelio.listReturnedOrders(1, 100);
    } catch (err) {
      this.logger.warn(`listReturnedOrders failed: ${(err as Error).message}`);
      return;
    }
    if (rows.length === 0) return;

    let ingestedCount = 0;
    let relinkedCount = 0;
    for (const row of rows) {
      if (!row.salesorder_id) continue;
      const exists = await prisma.salesReturn.findUnique({
        where: { jubelioReturnId: row.salesorder_id },
        select: { id: true, salesOrderId: true },
      });
      /*
       * Present AND linked is the only skip. A row whose `salesOrderId` is still null
       * is re-ingested deliberately: the return commonly arrives before its sales
       * order, so the first ingest had no order to resolve and stored null, and the
       * GL will not journal a return it cannot trace to a recognised sale. Skipping
       * on mere existence left those rows to hope a later RETURNED webhook happened
       * to re-enter the ingest path — turning a transient race into a permanent one.
       *
       * Re-ingesting costs one Jubelio detail fetch per null-linked return per run,
       * bounded by the sweeper's own window. If the order genuinely never appears the
       * row is retried each run and stays null, which is the correct outcome: the
       * link cannot be invented, and the retry is what makes it self-heal the moment
       * the order does land.
       */
      if (exists && exists.salesOrderId) continue;
      const relinking = exists != null;

      try {
        const detail = await this.jubelio.getSalesOrder(row.salesorder_id);
        await this.ingest.upsertFromApiDetail(detail);
        if (relinking) relinkedCount++;
        else ingestedCount++;
      } catch (err) {
        this.logger.warn(
          `Backstop ingest failed for salesorder ${row.salesorder_id}: ${(err as Error).message}`,
        );
      }
    }
    if (ingestedCount > 0) {
      this.logger.log(`Returns backstop ingested ${ingestedCount} new returns`);
    }
    if (relinkedCount > 0) {
      this.logger.log(`Returns backstop re-ingested ${relinkedCount} returns with an unlinked sales order`);
    }
  }
}
