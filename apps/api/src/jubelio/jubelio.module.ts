import { Module } from "@nestjs/common";
import { JubelioConfig } from "./jubelio.config";
import { JubelioController } from "./jubelio.controller";
import { JubelioHttpService } from "./http.service";
import { JubelioTokenService } from "./token.service";

@Module({
  controllers: [JubelioController],
  providers: [JubelioConfig, JubelioTokenService, JubelioHttpService],
  exports: [JubelioConfig, JubelioTokenService, JubelioHttpService],
})
export class JubelioModule {}
