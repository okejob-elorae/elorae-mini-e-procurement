import { Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { JubelioCatalogController } from "./catalog.controller";
import { JubelioCatalogSyncService } from "./catalog-sync.service";

@Module({
  imports: [JubelioModule],
  controllers: [JubelioCatalogController],
  providers: [JubelioCatalogSyncService],
  exports: [JubelioCatalogSyncService],
})
export class JubelioCatalogModule {}
