import { Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { JubelioLocationsController } from "./locations.controller";
import { JubelioLocationsService } from "./locations.service";

@Module({
  imports: [JubelioModule],
  controllers: [JubelioLocationsController],
  providers: [JubelioLocationsService],
  exports: [JubelioLocationsService],
})
export class JubelioLocationsModule {}
