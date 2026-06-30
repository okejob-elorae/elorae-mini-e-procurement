import { Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { InventorySnapshotController } from "./inventory-snapshot.controller";
import { InventorySnapshotService } from "./inventory-snapshot.service";

@Module({
  imports: [JubelioModule],
  controllers: [InventorySnapshotController],
  providers: [InventorySnapshotService],
  exports: [InventorySnapshotService],
})
export class JubelioInventoryModule {}
