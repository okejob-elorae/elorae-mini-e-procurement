import { isPostgresUrl } from "./adapter";

/**
 * True when DATABASE_URL points to a database the client can reach without SSL —
 * localhost / 127.0.0.1 (local dev), or the docker-compose service hostname `db`
 * (prod VPS where MariaDB runs with --skip-ssl on the internal docker network).
 * Caller bypasses SSL and the long handshake timeout for these hosts.
 */
function isLocalDatabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url.replace(/^(mysql|postgres(ql)?):\/\//, "https://"));
    const host = (parsed.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "db";
  } catch {
    return false;
  }
}

/**
 * Normalize DATABASE_URL for remote PostgreSQL (Supabase).
 * - node-postgres does not enable TLS on its own; Supabase requires it, so
 *   `sslmode=require` is forced when the URL does not already say otherwise.
 * - The MySQL knobs below (`ssl=true`, `connectTimeout`) are driver-specific
 *   and must never be appended to a Postgres URL.
 */
function normalizePostgresUrl(url: string): string {
  if (/[?&]sslmode=/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require`;
}

/**
 * Normalize DATABASE_URL for TiDB Cloud / remote MySQL.
 * - MariaDB driver expects ssl=true (TiDB often gives sslaccept=strict)
 * - Longer connectTimeout for remote TLS handshake (default 1000ms is too short)
 * - Local MySQL (localhost / 127.0.0.1): return URL as-is, no SSL or timeout forced.
 */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "";
  if (isLocalDatabaseUrl(url)) return url;
  if (isPostgresUrl(url)) return normalizePostgresUrl(url);

  let normalized = url.replace(/sslaccept=strict/gi, "ssl=true");
  if (!normalized.includes("ssl=true")) {
    normalized += normalized.includes("?") ? "&ssl=true" : "?ssl=true";
  }
  if (!/connectTimeout=\d+/.test(normalized)) {
    normalized += normalized.includes("?") ? "&connectTimeout=30000" : "?connectTimeout=30000";
  }
  return normalized;
}
