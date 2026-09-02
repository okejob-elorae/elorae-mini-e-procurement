import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JubelioConfigError } from "./jubelio.types";

export const JUBELIO_TOKEN_KEY = "JUBELIO_SESSION_TOKEN";
export const JUBELIO_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const JUBELIO_TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;
export const JUBELIO_DEFAULT_BASE_URL = "https://api2.jubelio.com";
export const JUBELIO_RATE_LIMIT_MAX_RETRIES = 3;
export const JUBELIO_RATE_LIMIT_BASE_DELAY_MS = 1000;

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

  /**
   * Email stamped as the picker on WMS picklist pushes. Jubelio validates it
   * against its own staff list, so it defaults to the integration account we
   * already authenticate as rather than an arbitrary ERP user.
   *
   * Truthiness, not `??`: dotenv parses a bare `JUBELIO_PICKER_EMAIL=` as `""`,
   * which is not `undefined` and would sail past `??` — sending `picker_id: ""`,
   * which Jubelio's validator rejects the same way it rejects a missing field.
   */
  get pickerEmail(): string {
    const configured = this.config.get<string>("JUBELIO_PICKER_EMAIL")?.trim();
    return configured || this.credentials.email;
  }

  get webhookSecret(): string {
    const secret = this.config.get<string>("JUBELIO_WEBHOOK_SECRET");
    if (!secret) throw new JubelioConfigError("JUBELIO_WEBHOOK_SECRET");
    return secret;
  }
}
