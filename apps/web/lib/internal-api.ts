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

export async function apiFetch<T = unknown>(
  method: string,
  path: string,
  opts: { userId: string; body?: unknown } = { userId: "" },
): Promise<ApiFetchResult<T>> {
  const bodyStr = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const sig = signInternalRequest(method, path, opts.userId, bodyStr);

  const headers: Record<string, string> = {
    "X-Internal-Sign": sig,
    "X-User-Id": opts.userId,
  };
  if (bodyStr) headers["Content-Type"] = "application/json";

  const res = await fetch(`${getBase()}${path}`, {
    method: method.toUpperCase(),
    headers,
    body: bodyStr || undefined,
  });

  const text = await res.text();
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
