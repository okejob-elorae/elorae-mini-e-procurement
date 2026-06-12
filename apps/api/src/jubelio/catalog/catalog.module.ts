import { Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { JubelioCatalogController } from "./catalog.controller";
import { JubelioCatalogDeleteController } from "./catalog-delete.controller";
import { JubelioCatalogSyncService } from "./catalog-sync.service";
import { JubelioCatalogDeleteService } from "./catalog-delete.service";

@Module({
  imports: [JubelioModule],
  controllers: [JubelioCatalogController, JubelioCatalogDeleteController],
  providers: [JubelioCatalogSyncService, JubelioCatalogDeleteService],
  exports: [JubelioCatalogSyncService, JubelioCatalogDeleteService],
})
export class JubelioCatalogModule {}
