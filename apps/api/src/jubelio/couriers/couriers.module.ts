import { Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { JubelioCouriersController } from "./couriers.controller";
import { JubelioCouriersService } from "./couriers.service";

@Module({
  imports: [JubelioModule],
  controllers: [JubelioCouriersController],
  providers: [JubelioCouriersService],
  exports: [JubelioCouriersService],
})
export class JubelioCouriersModule {}
