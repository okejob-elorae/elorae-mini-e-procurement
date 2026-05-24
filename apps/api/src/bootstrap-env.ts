import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

// Resolve relative to process.cwd() (typically apps/api during `nest start`
// or `node dist/...`). Falls back to the monorepo-root .env and the web
// app's .env to ease local dev when secrets live in apps/web/.env.
const cwd = process.cwd();
const candidates = [
  join(cwd, ".env"),
  join(cwd, "../../.env"),
  join(cwd, "../web/.env"),
];

for (const p of candidates) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}
