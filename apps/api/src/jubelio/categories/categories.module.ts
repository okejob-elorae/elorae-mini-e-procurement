import { Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { JubelioCategoriesController } from "./categories.controller";
import { JubelioCategoriesService } from "./categories.service";

@Module({
  imports: [JubelioModule],
  controllers: [JubelioCategoriesController],
  providers: [JubelioCategoriesService],
  exports: [JubelioCategoriesService],
})
export class JubelioCategoriesModule {}
