import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * True when URL points to local MySQL (localhost / 127.0.0.1).
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
 * Ensure DATABASE_URL has SSL for Prisma schema engine (migrate deploy) when remote.
 * TiDB Cloud prohibits insecure transport. Local MySQL (localhost): no SSL added.
 */
function getDatasourceUrl(): string {
  const url = env("DATABASE_URL");
  if (!url) return "";
  if (isLocalDatabaseUrl(url)) return url;
  const hasSsl =
    /[?&]sslaccept=strict/i.test(url) ||
    /[?&]ssl=true/i.test(url) ||
    /[?&]sslcert=/i.test(url);
  if (hasSsl) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}sslaccept=strict`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: getDatasourceUrl(),
  },
});
