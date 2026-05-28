import { Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { JubelioQueueModule } from "../queue/jubelio-queue.module";
import { JubelioWebhooksController } from "./webhooks.controller";
import { JubelioWebhooksService } from "./webhooks.service";

@Module({
  imports: [JubelioModule, JubelioQueueModule],
  controllers: [JubelioWebhooksController],
  providers: [JubelioWebhooksService],
  exports: [JubelioWebhooksService],
})
export class JubelioWebhooksModule {}
