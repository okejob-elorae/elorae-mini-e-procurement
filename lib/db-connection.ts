/**
 * Normalize DATABASE_URL for TiDB Cloud / remote MySQL.
 * - MariaDB driver expects ssl=true (TiDB often gives sslaccept=strict)
 * - Longer connectTimeout for remote TLS handshake (default 1000ms is too short)
 */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "";
  let normalized = url.replace(/sslaccept=strict/gi, "ssl=true");
  if (!normalized.includes("ssl=true")) {
    normalized += normalized.includes("?") ? "&ssl=true" : "?ssl=true";
  }
  if (!/connectTimeout=\d+/.test(normalized)) {
    normalized += normalized.includes("?") ? "&connectTimeout=10000" : "?connectTimeout=10000";
  }
  return normalized;
}
