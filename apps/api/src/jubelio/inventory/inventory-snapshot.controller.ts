import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  InventorySnapshotService,
  type GroupSnapshotRow,
  type InventorySnapshotRow,
} from "./inventory-snapshot.service";

/**
 * Both routes take their input in the PATH, never a query string: InternalSignGuard verifies the
 * signature against `req.path`, which excludes the query, while apps/web signs the full path it
 * requested — so a query string on this signed channel always fails with 401.
 */
@ApiTags("jubelio-inventory")
@Controller("jubelio/inventory")
export class InventorySnapshotController {
  constructor(private readonly snapshot: InventorySnapshotService) {}

  @Get("snapshot")
  @ApiOperation({
    summary: "Batch Jubelio stock quantities for mapped FG variants",
    description:
      "Returns Elorae itemId + variantSku paired with Jubelio's end_qty, or null when Jubelio " +
      "gave no usable figure. Pages through every item group. " +
      "Protected by InternalSignGuard (signed channel from apps/web).",
  })
  @ApiOkResponse({ description: "Snapshot rows for reconciliation." })
  async getSnapshot(): Promise<{ rows: InventorySnapshotRow[] }> {
    const rows = await this.snapshot.getSnapshot();
    return { rows };
  }

  @Get("snapshot/group/:groupId")
  @ApiOperation({
    summary: "Live Jubelio end_qty for every variant of one item group",
    description:
      "Reads GET /inventory/items/group/{id}, the endpoint the stock webhook trusts. Returns " +
      "per-variant jubelioItemId + endQty (null when invalid). Used by the manual MATCH_JUBELIO " +
      "resolve. Protected by InternalSignGuard (signed channel from apps/web).",
  })
  @ApiOkResponse({ description: "Per-variant rows for one item group." })
  async getGroupSnapshot(
    @Param("groupId", ParseIntPipe) groupId: number,
  ): Promise<{ rows: GroupSnapshotRow[] }> {
    const rows = await this.snapshot.getGroupSnapshot(groupId);
    return { rows };
  }
}
