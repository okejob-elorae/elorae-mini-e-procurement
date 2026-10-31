/**
 * Simple TiDB/MySQL connection test using the same client wiring
 * as the monorepo (`@elorae/db`).
 *
 * TiDB Cloud requires TLS and may need a longer connect timeout.
 * This script relies on DATABASE_URL in the environment; it does not
 * load .env files itself.
 */
import { createDbAdapter } from "../src/adapter";
import { PrismaClient } from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/db-connection";

const url = getDatabaseUrl();
if (!url) {
  console.error("❌ DATABASE_URL is not set (check .env or .env.local)");
  process.exit(1);
}

// Mask password in log
const safeUrl = url.replace(/:[^:@]+@/, ":****@");
console.log("Connecting to:", safeUrl);

const adapter = createDbAdapter(url);
const prisma = new PrismaClient({ adapter });

async function main() {
  // `AS ok` rather than a backtick-quoted `1`: backticks are MySQL-only syntax.
  const result = await prisma.$queryRaw<[{ ok: number }]>`SELECT 1 AS ok`;
  console.log("✅ Connection OK. Query result:", result);

  // Optional: server version — VERSION() exists on MySQL/MariaDB and PostgreSQL alike.
  try {
    const version = await prisma.$queryRaw<[{ version: string }]>`SELECT VERSION() as version`;
    console.log("   Server version:", version[0]?.version ?? "—");
  } catch {
    // ignore if not supported
  }
}

main()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Connection failed:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
