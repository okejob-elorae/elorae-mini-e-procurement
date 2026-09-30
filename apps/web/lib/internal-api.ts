import { createHmac } from "node:crypto";

/**
 * Pull a human-friendly message out of an apiFetch error body.
 * Nest's HttpException serializes as `{statusCode, error, message}` — return `.message`.
 * Falls back to a truncated raw body, then to the supplied default.
 */
export function extractApiMessage(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    // not JSON — fall through
  }
  return raw.slice(0, 300);
}

function getSecret(): string {
  const s = process.env.INTERNAL_API_SECRET;
  if (!s) {
    throw new Error(
      "INTERNAL_API_SECRET is not set. Add it to apps/web/.env (must match apps/api/.env).",
    );
  }
  return s;
}

function getBase(): string {
  const base = process.env.INTERNAL_API_URL;
  if (!base) {
    throw new Error(
      "INTERNAL_API_URL is not set. Add it to apps/web/.env.",
    );
  }
  return base;
}

export function signInternalRequest(
  method: string,
  path: string,
  userId: string,
  body: string,
): string {
  const input = `${method.toUpperCase()}\n${path}\n${userId}\n${body}`;
  return createHmac("sha256", getSecret()).update(input).digest("hex");
}

export type ApiFetchResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;

export async function apiFetch<T = unknown>(
  method: string,
  path: string,
  opts: { userId: string; body?: unknown; timeoutMs?: number } = { userId: "" },
): Promise<ApiFetchResult<T>> {
  /*
   * apps/api's InternalSignGuard verifies the signature against `req.path`, which excludes the
   * query string, while this signs the whole path — so any query string 401s every time. Put the
   * input in the path (or a POST body) instead.
   */
  if (path.includes("?")) {
    throw new Error(`apiFetch: query strings break the internal signature; put the input in the path (${path})`);
  }
  const bodyStr = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const sig = signInternalRequest(method, path, opts.userId, bodyStr);

  const headers: Record<string, string> = {
    "X-Internal-Sign": sig,
    "X-User-Id": opts.userId,
  };
  if (bodyStr) headers["Content-Type"] = "application/json";

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${getBase()}${path}`, {
      method: method.toUpperCase(),
      headers,
      body: bodyStr || undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    /* The same signal also aborts a stalled body read, so it stays inside the try. */
    text = await res.text();
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      /* 504 is synthetic: no complete response was received, so this is not a status the api sent. */
      return {
        ok: false,
        status: 504,
        error: `apiFetch: ${method.toUpperCase()} ${path} timed out after ${timeoutMs}ms`,
      };
    }
    throw err;
  }

  const data = text ? safeJson<T>(text) : undefined;
  if (!res.ok) {
    return { ok: false, status: res.status, error: typeof data === "string" ? data : text };
  }
  return { ok: true, status: res.status, data: data as T };
}

function safeJson<T>(s: string): T | string {
  try {
    return JSON.parse(s) as T;
  } catch {
    return s;
  }
}
