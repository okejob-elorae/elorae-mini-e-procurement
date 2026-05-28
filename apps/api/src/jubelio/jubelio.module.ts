import { Module } from "@nestjs/common";
import { JubelioConfig } from "./jubelio.config";
import { JubelioController } from "./jubelio.controller";
import { JubelioHttpService } from "./http.service";
import { JubelioTokenService } from "./token.service";
import { JubelioApiCallLogger } from "./api-call-logger.service";
import { JubelioQueueModule } from "./queue/jubelio-queue.module";

@Module({
  imports: [JubelioQueueModule],
  controllers: [JubelioController],
  providers: [JubelioConfig, JubelioTokenService, JubelioHttpService, JubelioApiCallLogger],
  exports: [JubelioConfig, JubelioTokenService, JubelioHttpService],
})
export class JubelioModule {}
