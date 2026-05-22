import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JubelioConfigError } from "./jubelio.types";

export const JUBELIO_TOKEN_KEY = "JUBELIO_SESSION_TOKEN";
export const JUBELIO_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const JUBELIO_TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;
export const JUBELIO_DEFAULT_BASE_URL = "https://api2.jubelio.com";

@Injectable()
export class JubelioConfig {
  constructor(private readonly config: ConfigService) {}

  get baseUrl(): string {
    return this.config.get<string>("JUBELIO_API_BASE_URL") ?? JUBELIO_DEFAULT_BASE_URL;
  }

  get credentials(): { email: string; password: string } {
    const email = this.config.get<string>("JUBELIO_USER");
    const password = this.config.get<string>("JUBELIO_PASS");
    if (!email) throw new JubelioConfigError("JUBELIO_USER");
    if (!password) throw new JubelioConfigError("JUBELIO_PASS");
    return { email, password };
  }
}
