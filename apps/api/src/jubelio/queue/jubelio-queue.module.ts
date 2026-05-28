import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AdminModule } from "../../admin/admin.module";
import { PrismaModule } from "../../db/prisma.module";
import { JUBELIO_WEBHOOK_QUEUE } from "./jubelio-queue.config";
import { WebhookQueueService } from "./webhook-queue.service";
import { WebhookProcessor } from "./webhook-processor.service";
import { JubelioEventRouter } from "./event-router";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { UnhandledEventHandler } from "../handlers/unhandled.handler";

@Module({
  imports: [
    PrismaModule,
    AdminModule,
    BullModule.registerQueue({ name: JUBELIO_WEBHOOK_QUEUE }),
  ],
  providers: [
    WebhookQueueService,
    WebhookProcessor,
    JubelioEventRouter,
    StockWebhookHandler,
    UnhandledEventHandler,
  ],
  exports: [WebhookQueueService],
})
export class JubelioQueueModule {}
