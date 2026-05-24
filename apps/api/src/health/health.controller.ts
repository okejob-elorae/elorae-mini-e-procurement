import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";

export class HealthStatus {
  @ApiProperty({ example: "ok" })
  status!: string;

  @ApiProperty({ example: "@elorae/api" })
  service!: string;

  @ApiProperty({ description: "ISO-8601 timestamp of the response.", example: "2026-05-24T15:00:00.000Z" })
  timestamp!: string;
}

@ApiTags("health")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "Liveness check" })
  @ApiOkResponse({ type: HealthStatus })
  check(): HealthStatus {
    return {
      status: "ok",
      service: "@elorae/api",
      timestamp: new Date().toISOString(),
    };
  }
}
