import { Injectable, Logger } from "@nestjs/common";
import {
  JubelioConfig,
  JUBELIO_RATE_LIMIT_BASE_DELAY_MS,
  JUBELIO_RATE_LIMIT_MAX_RETRIES,
} from "./jubelio.config";
import { JubelioTokenService } from "./token.service";
import { JubelioApiCallLogger } from "./api-call-logger.service";
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
    private readonly apiLog: JubelioApiCallLogger,
  ) {}

  async request<T = unknown>(path: string, init: JubelioRequestInit = {}): Promise<T> {
    const url = this.buildUrl(path, init.query);
    const method = init.method ?? "GET";
    const bodyStr = typeof init.body === "string" ? init.body : undefined;
    const start = Date.now();
    let rateLimited = false;

    try {
      const token = await this.tokens.getToken();
      let response = await this.send(url, init, token);

      if (response.status === 401) {
        this.logger.warn(`401 from ${path} — invalidating cached token, retrying once`);
        await this.tokens.invalidate();
        const retryToken = await this.tokens.getToken();
        response = await this.send(url, init, retryToken);
      }

      let attempt = 0;
      while (response.status === 429 && attempt < JUBELIO_RATE_LIMIT_MAX_RETRIES) {
        rateLimited = true;
        const delay = this.retryAfterMs(response, attempt);
        this.logger.warn(
          `429 from ${path} — retry ${attempt + 1}/${JUBELIO_RATE_LIMIT_MAX_RETRIES} after ${delay}ms`,
        );
        await this.sleep(delay);
        const token = await this.tokens.getToken();
        response = await this.send(url, init, token);
        attempt++;
      }

      const status = response.status;
      const result = await this.parse<T>(path, response);
      this.apiLog.record({
        method, path, body: bodyStr, statusCode: status,
        latencyMs: Date.now() - start, ok: true, rateLimited,
        requestBody: bodyStr,
        responseBody: result === undefined ? undefined : JSON.stringify(result),
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = err instanceof JubelioError ? err.status : undefined;
      const responseBody = err instanceof JubelioError
        ? (typeof err.cause === "string" ? err.cause : JSON.stringify(err.cause))
        : undefined;
      this.apiLog.record({
        method, path, body: bodyStr, statusCode,
        latencyMs: Date.now() - start, ok: false, rateLimited, errorMessage: message,
        requestBody: bodyStr,
        responseBody,
      });
      if (err instanceof JubelioError) {
        this.logger.error(
          `Jubelio ${method} ${path} ${err.status}\n  REQ: ${bodyStr ?? "<no body>"}\n  RES: ${responseBody ?? "<no body>"}`,
        );
      }
      throw err;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private retryAfterMs(response: Response, attempt: number): number {
    const header = response.headers.get("retry-after");
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
      const date = Date.parse(header);
      if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
    }
    return JUBELIO_RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
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
