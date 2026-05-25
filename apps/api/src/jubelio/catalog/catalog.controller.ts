import { Body, Controller, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JubelioCatalogSyncService, type SyncCatalogOptions } from "./catalog-sync.service";
import type { CatalogSyncResult } from "./catalog.types";

class CatalogSyncBody {
  dryRun?: boolean;
  itemGroupIds?: number[];
}

@ApiTags("jubelio-catalog")
@Controller("jubelio/catalog")
export class JubelioCatalogController {
  constructor(private readonly sync: JubelioCatalogSyncService) {}

  @Post("sync")
  @ApiOperation({
    summary: "Sync Jubelio catalog into ERP",
    description:
      "Fetches all Jubelio items, maps them to ERP catalog drafts, and upserts Items + " +
      "JubelioProductMapping + zero-stock InventoryValue rows. Use { dryRun: true } to " +
      "preview without writes. Optionally filter by jubelio item_group_id list.",
  })
  @ApiOkResponse({ description: "CatalogSyncResult summary + items + errors." })
  run(@Body() body: CatalogSyncBody): Promise<CatalogSyncResult> {
    const opts: SyncCatalogOptions = {
      dryRun: body?.dryRun ?? false,
      itemGroupIds: body?.itemGroupIds,
    };
    return this.sync.syncCatalog(opts);
  }
}
