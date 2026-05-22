import { Controller, Get, Post } from "@nestjs/common";
import { JubelioTokenService } from "./token.service";
import type { JubelioTokenStatus } from "./jubelio.types";

@Controller("jubelio")
export class JubelioController {
  constructor(private readonly tokens: JubelioTokenService) {}

  @Get("status")
  status(): Promise<JubelioTokenStatus> {
    return this.tokens.status();
  }

  @Post("refresh")
  async refresh(): Promise<JubelioTokenStatus> {
    await this.tokens.refresh();
    return this.tokens.status();
  }
}
