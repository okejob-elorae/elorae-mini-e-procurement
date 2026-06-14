import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";

type ShipPayload = { salesOrderId: string; jubelioSalesorderId: number; courierId: number };

@Injectable()
export class SalesOrderShipHandler implements OutboxHandler {
  private readonly logger = new Logger(SalesOrderShipHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const payload = row.payload as unknown as ShipPayload;
    const order = await this.prisma.salesOrder.findUnique({ where: { id: payload.salesOrderId } });
    if (!order) {
      return { kind: "skipped", reason: `${OUTBOX_SKIP_REASONS.MISSING_MAPPING}:salesorder` };
    }

    const body = {
      courier_new_id: payload.courierId,
      location_id: 1,
      shipment_type: "2",
      shipment_header_id: 0,
      shipment_no: "",
      courier_name: "",
      shipment_date: new Date().toISOString(),
      orders: [order.salesorderId],
    };

    try {
      await this.http.post("/wms/shipments/", body);
    } catch (err) {
      if (isAlreadyInStateError(err)) {
        this.logger.warn(
          `Jubelio reports salesorder ${order.salesorderId} already past SHIP — skipping`,
        );
        return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE };
      }
      throw err;
    }

    this.logger.log(`Pushed Ship for salesorder ${order.salesorderId} via courier ${payload.courierId}`);
    return { kind: "processed" };
  }
}

function isAlreadyInStateError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ALREADY_IN_STATE";
}
