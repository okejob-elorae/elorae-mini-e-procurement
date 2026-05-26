import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

// Cascade earlier→later; earlier wins per key (dotenv default no-override).
// apps/api may omit shared keys (e.g. DATABASE_URL); apps/web/.env supplies them.
const cwd = process.cwd();
const candidates = [
  join(cwd, ".env"),
  join(cwd, "../../.env"),
  join(cwd, "../web/.env"),
];

for (const p of candidates) {
  if (existsSync(p)) loadEnv({ path: p });
}
