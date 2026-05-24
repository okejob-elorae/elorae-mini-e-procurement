import { Controller, Get, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JubelioTokenService } from "./token.service";
import { JubelioTokenStatus } from "./jubelio.types";

@ApiTags("jubelio")
@Controller("jubelio")
export class JubelioController {
  constructor(private readonly tokens: JubelioTokenService) {}

  @Get("status")
  @ApiOperation({
    summary: "Read cached token status",
    description: "Returns whether a Jubelio session token is cached and when it expires. Does not leak the token itself.",
  })
  @ApiOkResponse({ type: JubelioTokenStatus })
  status(): Promise<JubelioTokenStatus> {
    return this.tokens.status();
  }

  @Post("refresh")
  @ApiOperation({
    summary: "Force a token refresh",
    description: "Calls POST /login on Jubelio using the configured credentials, persists the new token in SystemSetting, and returns the updated status.",
  })
  @ApiOkResponse({ type: JubelioTokenStatus })
  async refresh(): Promise<JubelioTokenStatus> {
    await this.tokens.refresh();
    return this.tokens.status();
  }
}
