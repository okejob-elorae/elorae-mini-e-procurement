import { Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { JubelioWebhooksController } from "./webhooks.controller";
import { JubelioWebhooksService } from "./webhooks.service";

@Module({
  imports: [JubelioModule],
  controllers: [JubelioWebhooksController],
  providers: [JubelioWebhooksService],
  exports: [JubelioWebhooksService],
})
export class JubelioWebhooksModule {}
