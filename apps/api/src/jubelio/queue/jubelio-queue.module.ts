import { forwardRef, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AdminModule } from "../../admin/admin.module";
import { PrismaModule } from "../../db/prisma.module";
import { JubelioModule } from "../jubelio.module";
import { JubelioCatalogModule } from "../catalog/catalog.module";
import { ReturnsModule } from "../returns/returns.module";
import { JUBELIO_WEBHOOK_QUEUE } from "./jubelio-queue.config";
import { WebhookQueueService } from "./webhook-queue.service";
import { WebhookProcessor } from "./webhook-processor.service";
import { JubelioEventRouter } from "./event-router";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { SalesOrderWebhookHandler } from "../handlers/salesorder.handler";
import { SalesReturnWebhookHandler } from "../handlers/salesreturn.handler";
import { ProductWebhookHandler } from "../handlers/product.handler";
import { UnhandledEventHandler } from "../handlers/unhandled.handler";

@Module({
  imports: [
    PrismaModule,
    AdminModule,
    JubelioModule,
    forwardRef(() => JubelioCatalogModule),
    forwardRef(() => ReturnsModule),
    BullModule.registerQueue({ name: JUBELIO_WEBHOOK_QUEUE }),
  ],
  providers: [
    WebhookQueueService,
    WebhookProcessor,
    JubelioEventRouter,
    StockWebhookHandler,
    SalesOrderWebhookHandler,
    SalesReturnWebhookHandler,
    ProductWebhookHandler,
    UnhandledEventHandler,
  ],
  exports: [WebhookQueueService],
})
export class JubelioQueueModule {}
