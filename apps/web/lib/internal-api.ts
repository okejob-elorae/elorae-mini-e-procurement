import { createHmac } from "node:crypto";

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
