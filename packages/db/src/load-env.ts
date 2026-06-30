import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

/**
 * Load DATABASE_URL for CLI scripts (seed, unseed, test-connection).
 * Mirrors prisma.config.ts: packages/db/.env → apps/web/.env → repo root .env
 */
export function loadDbEnv(): void {
  const pkgRoot = __dirname;
  const envCandidates = [
    join(pkgRoot, "../.env"),
    join(pkgRoot, "../../../apps/web/.env"),
    join(pkgRoot, "../../../.env"),
  ];
  for (const p of envCandidates) {
    if (existsSync(p)) {
      loadEnv({ path: p });
      return;
    }
  }
}
