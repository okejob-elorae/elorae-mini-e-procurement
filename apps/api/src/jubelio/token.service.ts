import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../db/prisma.module";
import {
  JUBELIO_TOKEN_KEY,
  JUBELIO_TOKEN_REFRESH_LEAD_MS,
  JUBELIO_TOKEN_TTL_MS,
  JubelioConfig,
} from "./jubelio.config";
import {
  JubelioAuthError,
  type JubelioLoginResponse,
  type JubelioTokenStatus,
} from "./jubelio.types";

type CachedToken = {
  token: string;
  updatedAt: Date;
  expiresAt: Date;
};

@Injectable()
export class JubelioTokenService {
  private readonly logger = new Logger(JubelioTokenService.name);
  private cached: CachedToken | null = null;
  private inflightRefresh: Promise<string> | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly config: JubelioConfig,
  ) {}

  async getToken(): Promise<string> {
    const cached = await this.loadCached();
    if (cached && !this.isNearExpiry(cached)) {
      return cached.token;
    }
    this.inflightRefresh ??= this.refresh().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }

  async status(): Promise<JubelioTokenStatus> {
    const cached = await this.loadCached();
    if (!cached) {
      return { hasToken: false, updatedAt: null, expiresAt: null, expiresInSeconds: null };
    }
    const expiresInSeconds = Math.max(0, Math.floor((cached.expiresAt.getTime() - Date.now()) / 1000));
    return {
      hasToken: true,
      updatedAt: cached.updatedAt.toISOString(),
      expiresAt: cached.expiresAt.toISOString(),
      expiresInSeconds,
    };
  }

  async refresh(): Promise<string> {
    const { email, password } = this.config.credentials;
    const url = `${this.config.baseUrl}/login`;

    this.logger.log(`Refreshing Jubelio token via ${url}`);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const payload = (await response.json().catch(() => ({}))) as JubelioLoginResponse;
    const token = payload?.token?.trim();
    if (!response.ok || !token) {
      const reason = payload?.message ?? payload?.error ?? "Invalid Jubelio credentials";
      throw new JubelioAuthError(reason, response.status);
    }

    const updatedAt = new Date();
    const row = await this.prisma.systemSetting.upsert({
      where: { key: JUBELIO_TOKEN_KEY },
      create: { key: JUBELIO_TOKEN_KEY, value: token },
      update: { value: token },
      select: { value: true, updatedAt: true },
    });

    this.cached = {
      token: row.value,
      updatedAt: row.updatedAt ?? updatedAt,
      expiresAt: new Date((row.updatedAt ?? updatedAt).getTime() + JUBELIO_TOKEN_TTL_MS),
    };
    this.logger.log(`Jubelio token refreshed, expires ${this.cached.expiresAt.toISOString()}`);
    return this.cached.token;
  }

  async invalidate(): Promise<void> {
    this.cached = null;
  }

  private async loadCached(): Promise<CachedToken | null> {
    if (this.cached) return this.cached;
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: JUBELIO_TOKEN_KEY },
      select: { value: true, updatedAt: true },
    });
    if (!row?.value || !row.updatedAt) return null;
    this.cached = {
      token: row.value,
      updatedAt: row.updatedAt,
      expiresAt: new Date(row.updatedAt.getTime() + JUBELIO_TOKEN_TTL_MS),
    };
    return this.cached;
  }

  private isNearExpiry(cached: CachedToken): boolean {
    return cached.expiresAt.getTime() - Date.now() <= JUBELIO_TOKEN_REFRESH_LEAD_MS;
  }
}
