import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { JubelioConfig } from "../../jubelio.config";
import { JUBELIO_WMS_LOCATION_ID } from "../jubelio-outbox.config";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import { isAlreadyInStateError } from "./already-in-state";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";

type PickPayload = { salesOrderId: string; jubelioSalesorderId: number };

@Injectable()
export class SalesOrderPickHandler implements OutboxHandler {
  private readonly logger = new Logger(SalesOrderPickHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
    private readonly config: JubelioConfig,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const payload = row.payload as unknown as PickPayload;
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: payload.salesOrderId },
      include: {
        items: {
          select: {
            salesorderDetailId: true,
            jubelioItemId: true,
            qty: true,
            isCanceledItem: true,
          },
        },
      },
    });
    if (!order) {
      return { kind: "skipped", reason: `${OUTBOX_SKIP_REASONS.MISSING_MAPPING}:salesorder` };
    }

    const items = order.items
      .filter((line) => !line.isCanceledItem)
      .map((line) => ({
        salesorder_detail_id: line.salesorderDetailId,
        item_id: line.jubelioItemId,
        location_id: JUBELIO_WMS_LOCATION_ID,
        qty_ordered: Number(line.qty),
        qty_picked: Number(line.qty),
        salesorder_id: order.salesorderId,
        bundle_item_id: 0,
        package_detail_id: 0,
        package_id: 0,
      }));

    if (items.length === 0) {
      this.logger.warn(
        `Salesorder ${order.salesorderId} has no pickable lines — nothing to push`,
      );
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.NO_PUSHABLE_LINES };
    }

    /**
     * The create-and-autocomplete variant of the picklist endpoint: it opens the
     * picklist and closes it in one call, which is what an ERP-side "picked"
     * click means. `picklist_id: 0` plus `picklist_no: "[auto]"` is how Jubelio
     * spells "create a new one and number it yourself".
     */
    try {
      await this.http.post("/wms/sales/picklists/", {
        picklist_id: 0,
        picklist_no: "[auto]",
        is_completed: true,
        is_warehouse: true,
        merge_location: false,
        picker_id: this.config.pickerEmail,
        salesorderIds: [order.salesorderId],
        items,
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

    this.logger.log(
      `Pushed Pick for salesorder ${order.salesorderId} (${items.length} lines)`,
    );
    return { kind: "processed" };
  }
}
