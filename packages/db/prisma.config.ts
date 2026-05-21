import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

const here = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  join(here, ".env"),
  join(here, "../../apps/web/.env"),
  join(here, "../../.env"),
];
for (const p of envCandidates) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}

function isLocalDatabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url.replace(/^mysql:\/\//, "https://"));
    const host = (parsed.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function getDatasourceUrl(): string {
  const url = process.env.DATABASE_URL;
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
