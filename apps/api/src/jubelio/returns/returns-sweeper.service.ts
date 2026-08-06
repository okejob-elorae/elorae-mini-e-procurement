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
    let awaitingOrderCount = 0;
    const localOrderPresence = new Map<number, boolean>();

    for (const row of rows) {
      if (!row.salesorder_id) continue;
      const existing = await prisma.salesReturn.findUnique({
        where: { jubelioReturnId: row.salesorder_id },
        select: { id: true, salesOrderId: true },
      });
      if (existing?.salesOrderId) continue;

      /*
       * A null-linked row is re-ingested so it can heal: the return commonly arrives
       * before its sales order, so the first ingest had no order to resolve and stored
       * null, and the GL will not journal a return it cannot trace to a recognised sale.
       *
       * But the ingest resolves that link from a local SalesOrder keyed on this same
       * `salesorder_id`, so while no such order exists the re-ingest is guaranteed to
       * leave the link null. Settling that with a local read first is what stops the
       * healing retry from costing a Jubelio detail fetch, a multi-query write
       * transaction and a `JubelioApiCall` audit row per run, forever, for a return
       * that can never resolve — on the dev bed 100 of 102 returns are null-linked and
       * NONE of their orders was ever ingested, so that is 100 wasted calls every run.
       *
       * Only rows that already exist are gated. A return not yet seen locally is always
       * ingested: the audit row is worth having whether or not its order has landed.
       */
      if (existing) {
        const orderIsLocal = await this.hasLocalSalesOrder(row.salesorder_id, localOrderPresence);
        if (!orderIsLocal) {
          awaitingOrderCount++;
          continue;
        }
      }

      try {
        const detail = await this.jubelio.getSalesOrder(row.salesorder_id);
        const result = await this.ingest.upsertFromApiDetail(detail);
        if (!existing) {
          ingestedCount++;
        } else if (result.salesOrderId) {
          relinkedCount++;
        } else {
          /*
           * The pre-check saw the order and the ingest did not. The two read the same
           * column with the same value, so this means they disagreed — report it rather
           * than counting a link that was never written.
           */
          this.logger.warn(
            `Re-ingest left salesorder ${row.salesorder_id} unlinked despite a local sales order`,
          );
        }
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
      this.logger.log(
        `Returns backstop linked ${relinkedCount} re-ingested returns to their sales order`,
      );
    }
    if (awaitingOrderCount > 0) {
      this.logger.log(
        `Returns backstop skipped ${awaitingOrderCount} unlinked returns — sales order not ingested locally`,
      );
    }
  }

  /*
   * Mirrors the ingest's own link lookup exactly, so the two cannot disagree about
   * whether a re-ingest could resolve anything. Memoised per run: several list rows
   * pointing at one missing order cost a single query.
   */
  private async hasLocalSalesOrder(
    salesorderId: number,
    presence: Map<number, boolean>,
  ): Promise<boolean> {
    const cached = presence.get(salesorderId);
    if (cached !== undefined) return cached;
    const order = await prisma.salesOrder.findUnique({
      where: { salesorderId },
      select: { id: true },
    });
    const isPresent = order != null;
    presence.set(salesorderId, isPresent);
    return isPresent;
  }
}
