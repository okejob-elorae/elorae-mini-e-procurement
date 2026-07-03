import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  InventorySnapshotService,
  type InventorySnapshotRow,
} from "./inventory-snapshot.service";

@ApiTags("jubelio-inventory")
@Controller("jubelio/inventory")
export class InventorySnapshotController {
  constructor(private readonly snapshot: InventorySnapshotService) {}

  @Get("snapshot")
  @ApiOperation({
    summary: "Batch Jubelio stock quantities for mapped FG variants",
    description:
      "Returns Elorae itemId + variantSku paired with current Jubelio qty. " +
      "Protected by InternalSignGuard (signed channel from apps/web).",
  })
  @ApiOkResponse({ description: "Snapshot rows for reconciliation." })
  async getSnapshot(
    @Query("jubelioItemGroupIds") groupIdsRaw?: string | string[],
  ): Promise<{ rows: InventorySnapshotRow[] }> {
    const groupIds = parseGroupIds(groupIdsRaw);
    const rows = await this.snapshot.getSnapshot(groupIds);
    return { rows };
  }
}

function parseGroupIds(raw?: string | string[]): number[] | undefined {
  if (!raw) return undefined;
  const parts = Array.isArray(raw) ? raw : raw.split(",");
  const ids = parts.map((p) => Number(p.trim())).filter((n) => Number.isFinite(n));
  return ids.length > 0 ? ids : undefined;
}
