import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JubelioLocationsService, type JubelioLocation } from "./locations.service";

@ApiTags("jubelio-locations")
@Controller("jubelio/locations")
export class JubelioLocationsController {
  constructor(private readonly svc: JubelioLocationsService) {}

  @Get()
  @ApiOperation({
    summary: "List Jubelio warehouse locations (read-through, not cached)",
    description:
      "Returns the identifying fields only. Use this to discover the real location_id " +
      "the WMS pick/pack/ship pushes must send.",
  })
  @ApiOkResponse({ description: "Locations known to the connected Jubelio account" })
  list(): Promise<{ locations: JubelioLocation[] }> {
    return this.svc.list();
  }
}
