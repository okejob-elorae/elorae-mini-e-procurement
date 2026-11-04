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

function isPostgres(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url.trim());
}

function isLocalDatabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url.replace(/^(mysql|postgres(ql)?):\/\//, "https://"));
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
  // sslaccept/ssl are MySQL-driver spellings; Postgres wants sslmode.
  if (isPostgres(url)) {
    return /[?&]sslmode=/i.test(url)
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}sslmode=require`;
  }
  const hasSsl =
    /[?&]sslaccept=strict/i.test(url) ||
    /[?&]ssl=true/i.test(url) ||
    /[?&]sslcert=/i.test(url);
  if (hasSsl) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}sslaccept=strict`;
}

/*
 * The datamodel is the same in both dialects, but the datasource block and two
 * native types are not — so each dialect gets its own schema file and its own
 * migration history. DATABASE_URL decides which pair the CLI uses, so
 * `prisma generate` / `migrate deploy` need no extra flag: point the env at
 * Supabase and the Postgres schema is what gets generated.
 */
const usePostgres = isPostgres(process.env.DATABASE_URL ?? "");

export default defineConfig({
  schema: usePostgres ? "prisma/schema.postgres.prisma" : "prisma/schema.prisma",
  migrations: {
    path: usePostgres ? "prisma/postgres/migrations" : "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: getDatasourceUrl(),
  },
});
