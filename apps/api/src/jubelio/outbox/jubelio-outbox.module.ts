import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AdminModule } from "../../admin/admin.module";
import { PrismaModule } from "../../db/prisma.module";
import { JubelioModule } from "../jubelio.module";
import { JUBELIO_OUTBOX_QUEUE } from "./jubelio-outbox.config";
import { JubelioOutboxController } from "./jubelio-outbox.controller";
import { OutboxPoller } from "./outbox-poller.service";
import { OutboxProcessor } from "./outbox-processor.service";
import { OutboxRouter } from "./outbox-router";
import { StockPushHandler } from "./handlers/stock-push.handler";

@Module({
  imports: [
    PrismaModule,
    AdminModule,
    JubelioModule,
    BullModule.registerQueue({ name: JUBELIO_OUTBOX_QUEUE }),
  ],
  controllers: [JubelioOutboxController],
  providers: [OutboxPoller, OutboxProcessor, OutboxRouter, StockPushHandler],
})
export class JubelioOutboxModule {}
