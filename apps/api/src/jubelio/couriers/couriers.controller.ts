import { Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JubelioCouriersService } from "./couriers.service";

@ApiTags("jubelio-couriers")
@Controller("jubelio/couriers")
export class JubelioCouriersController {
  constructor(private readonly svc: JubelioCouriersService) {}

  @Post("sync")
  @HttpCode(200)
  @ApiOperation({
    summary: "Refresh JubelioCourier cache from Jubelio /wms/couriers",
  })
  @ApiOkResponse({ description: "Returns the count of couriers synced" })
  sync(): Promise<{ count: number }> {
    return this.svc.sync();
  }
}
