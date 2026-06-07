import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JubelioCategoriesService, type JubelioCategoryFlat, type SaveMappingInput } from "./categories.service";

class SaveMappingsBody {
  mappings!: SaveMappingInput[];
}

@ApiTags("jubelio-categories")
@Controller("jubelio/categories")
export class JubelioCategoriesController {
  constructor(private readonly svc: JubelioCategoriesService) {}

  @Post("list")
  @HttpCode(200)
  @ApiOperation({
    summary: "Fetch full Jubelio category list",
    description:
      "Paginates Jubelio /inventory/categories/item-categories/, computes breadcrumb paths, " +
      "returns flat array sorted by path. Used by the category mapping admin UI.",
  })
  @ApiOkResponse({ description: "Array of JubelioCategoryFlat" })
  list(): Promise<JubelioCategoryFlat[]> {
    return this.svc.fetchAll();
  }

  @Post("mappings")
  @HttpCode(200)
  @ApiOperation({
    summary: "Batch upsert JubelioCategoryMapping rows",
    description:
      "Upserts one mapping per Elorae ItemCategory. Atomic via Prisma $transaction. " +
      "Rejects duplicate jubelio ids within the input.",
  })
  saveMappings(@Body() body: SaveMappingsBody): Promise<{ saved: number }> {
    return this.svc.saveMappings(body.mappings);
  }
}
