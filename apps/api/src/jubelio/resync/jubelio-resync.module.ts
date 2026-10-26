import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AdminModule } from "../../admin/admin.module";
import { PrismaModule } from "../../db/prisma.module";
import { JubelioModule } from "../jubelio.module";
import { ReturnsModule } from "../returns/returns.module";
import { SalesOrderWebhookHandler } from "../handlers/salesorder.handler";
import { JubelioWebhooksService } from "../webhooks/webhooks.service";
import { JUBELIO_RESYNC_QUEUE } from "./jubelio-resync.config";
import { JubelioResyncController } from "./jubelio-resync.controller";
import { ResyncPoller } from "./resync-poller.service";
import { ResyncProcessor } from "./resync-processor.service";
import { ResyncSeedService } from "./resync-seed.service";

@Module({
  imports: [
    PrismaModule,
    AdminModule,
    JubelioModule,
    ReturnsModule,
    BullModule.registerQueue({ name: JUBELIO_RESYNC_QUEUE }),
  ],
  controllers: [JubelioResyncController],
  providers: [
    ResyncPoller,
    ResyncProcessor,
    ResyncSeedService,
    SalesOrderWebhookHandler,
    JubelioWebhooksService,
  ],
})
export class JubelioResyncModule {}
