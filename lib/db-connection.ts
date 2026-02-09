/**
 * True when DATABASE_URL points to local MySQL (localhost / 127.0.0.1).
 * Bypass SSL and long timeout for local dev.
 */
function isLocalDatabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url.replace(/^mysql:\/\//, "https://"));
    const host = (parsed.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
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

  let normalized = url.replace(/sslaccept=strict/gi, "ssl=true");
  if (!normalized.includes("ssl=true")) {
    normalized += normalized.includes("?") ? "&ssl=true" : "?ssl=true";
  }
  if (!/connectTimeout=\d+/.test(normalized)) {
    normalized += normalized.includes("?") ? "&connectTimeout=30000" : "?connectTimeout=30000";
  }
  return normalized;
}
