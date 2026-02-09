import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Ensure DATABASE_URL has SSL for Prisma schema engine (migrate deploy).
 * TiDB Cloud prohibits insecure transport; schema engine needs sslaccept=strict or sslcert=system.
 */
function getDatasourceUrl(): string {
  const url = env("DATABASE_URL");
  if (!url) return "";
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
