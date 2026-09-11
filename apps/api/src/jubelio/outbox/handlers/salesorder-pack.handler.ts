import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import { isAlreadyInStateError } from "./already-in-state";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";

type PackPayload = { salesOrderId: string; jubelioSalesorderId: number };

@Injectable()
export class SalesOrderPackHandler implements OutboxHandler {
  private readonly logger = new Logger(SalesOrderPackHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const payload = row.payload as unknown as PackPayload;
    const order = await this.prisma.salesOrder.findUnique({ where: { id: payload.salesOrderId } });
    if (!order) {
      return { kind: "skipped", reason: `${OUTBOX_SKIP_REASONS.MISSING_MAPPING}:salesorder` };
    }

    try {
      await this.http.post("/wms/sales/packlist/mark-as-complete/", { ids: [order.salesorderId] });
    } catch (err) {
      if (isAlreadyInStateError(err)) {
        this.logger.warn(
          `Jubelio reports salesorder ${order.salesorderId} already past PACK — skipping`,
        );
        return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE };
      }
      throw err;
    }

    this.logger.log(`Pushed Pack for salesorder ${order.salesorderId}`);
    return { kind: "processed" };
  }
}
