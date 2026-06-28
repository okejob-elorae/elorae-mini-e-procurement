import { forwardRef, Module } from "@nestjs/common";
import { JubelioConfig } from "./jubelio.config";
import { JubelioController } from "./jubelio.controller";
import { JubelioHttpService } from "./http.service";
import { JubelioTokenService } from "./token.service";
import { JubelioApiCallLogger } from "./api-call-logger.service";
import { JubelioImageUploadService } from "./image-upload.service";
import { JubelioQueueModule } from "./queue/jubelio-queue.module";
import { ReturnsModule } from "./returns/returns.module";

@Module({
  imports: [JubelioQueueModule, forwardRef(() => ReturnsModule)],
  controllers: [JubelioController],
  providers: [JubelioConfig, JubelioTokenService, JubelioHttpService, JubelioApiCallLogger, JubelioImageUploadService],
  exports: [JubelioConfig, JubelioTokenService, JubelioHttpService, JubelioImageUploadService],
})
export class JubelioModule {}
