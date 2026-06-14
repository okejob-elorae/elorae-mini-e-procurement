import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";

type PickPayload = { salesOrderId: string; jubelioSalesorderId: number };

@Injectable()
export class SalesOrderPickHandler implements OutboxHandler {
  private readonly logger = new Logger(SalesOrderPickHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const payload = row.payload as unknown as PickPayload;
    const order = await this.prisma.salesOrder.findUnique({ where: { id: payload.salesOrderId } });
    if (!order) {
      return { kind: "skipped", reason: `${OUTBOX_SKIP_REASONS.MISSING_MAPPING}:salesorder` };
    }

    try {
      await this.http.post("/wms/sales/picklists/", {
        ids: [order.salesorderId],
        is_completed: true,
      });
    } catch (err) {
      if (isAlreadyInStateError(err)) {
        this.logger.warn(
          `Jubelio reports salesorder ${order.salesorderId} already past PICK — skipping`,
        );
        return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE };
      }
      throw err;
    }

    this.logger.log(`Pushed Pick for salesorder ${order.salesorderId}`);
    return { kind: "processed" };
  }
}

function isAlreadyInStateError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ALREADY_IN_STATE";
}
