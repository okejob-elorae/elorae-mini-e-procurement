import { Injectable, Logger } from "@nestjs/common";
import { JubelioConfig } from "./jubelio.config";
import { JubelioTokenService } from "./token.service";
import { JubelioError } from "./jubelio.types";

export type JubelioRequestInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
};

@Injectable()
export class JubelioHttpService {
  private readonly logger = new Logger(JubelioHttpService.name);

  constructor(
    private readonly config: JubelioConfig,
    private readonly tokens: JubelioTokenService,
  ) {}

  async request<T = unknown>(path: string, init: JubelioRequestInit = {}): Promise<T> {
    const url = this.buildUrl(path, init.query);
    const token = await this.tokens.getToken();
    const response = await this.send(url, init, token);

    if (response.status === 401) {
      this.logger.warn(`401 from ${path} — invalidating cached token, retrying once`);
      await this.tokens.invalidate();
      const retryToken = await this.tokens.getToken();
      const retry = await this.send(url, init, retryToken);
      return this.parse<T>(path, retry);
    }
    return this.parse<T>(path, response);
  }

  get<T = unknown>(path: string, init?: JubelioRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "GET" });
  }

  post<T = unknown>(path: string, body?: unknown, init?: JubelioRequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  put<T = unknown>(path: string, body?: unknown, init?: JubelioRequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  delete<T = unknown>(path: string, init?: JubelioRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "DELETE" });
  }

  private buildUrl(path: string, query?: JubelioRequestInit["query"]): string {
    const base = this.config.baseUrl.replace(/\/$/, "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    if (!query) return `${base}${suffix}`;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}${suffix}?${qs}` : `${base}${suffix}`;
  }

  private async send(url: string, init: JubelioRequestInit, token: string): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    };
    return fetch(url, { ...init, headers });
  }

  private async parse<T>(path: string, response: Response): Promise<T> {
    const text = await response.text();
    const data: unknown = text ? this.tryJson(text) : undefined;
    if (!response.ok) {
      const message = this.extractMessage(data) ?? `Jubelio ${response.status} on ${path}`;
      throw new JubelioError(message, response.status, data);
    }
    return data as T;
  }

  private tryJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private extractMessage(data: unknown): string | null {
    if (!data || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    return null;
  }
}
