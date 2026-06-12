import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JubelioCatalogDeleteService, type CatalogDeleteResult } from "./catalog-delete.service";

class CatalogDeleteBody {
  jubelioGroupId!: number;
}

@ApiTags("jubelio-catalog")
@Controller("jubelio/catalog")
export class JubelioCatalogDeleteController {
  constructor(private readonly svc: JubelioCatalogDeleteService) {}

  @Post("delete-product")
  @HttpCode(200)
  @ApiOperation({
    summary: "Delete a Jubelio product (whole item_group) + drop local mappings",
    description:
      "Used for test cleanup. Calls Jubelio DELETE /inventory/items/ then removes " +
      "every JubelioProductMapping row pointing at the deleted group_id.",
  })
  @ApiOkResponse({ description: "CatalogDeleteResult" })
  delete(@Body() body: CatalogDeleteBody): Promise<CatalogDeleteResult> {
    return this.svc.deleteByGroupId(body.jubelioGroupId);
  }
}
