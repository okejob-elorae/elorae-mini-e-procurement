/**
 * Simple TiDB/MySQL connection test.
 * Run: npm run db:test
 *
 * TiDB Cloud requires TLS and may need a longer connect timeout.
 * This script normalizes DATABASE_URL for TiDB (ssl=true, connectTimeout).
 */
import { config } from "dotenv";
import path from "path";

// Load .env.local first, then .env (so local overrides)
config({ path: path.join(process.cwd(), ".env.local") });
config({ path: path.join(process.cwd(), ".env") });
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "../lib/db-connection";

const url = getDatabaseUrl();
if (!url) {
  console.error("❌ DATABASE_URL is not set (check .env or .env.local)");
  process.exit(1);
}

// Mask password in log
const safeUrl = url.replace(/:[^:@]+@/, ":****@");
console.log("Connecting to:", safeUrl);

const adapter = new PrismaMariaDb(url);
const prisma = new PrismaClient({ adapter });

async function main() {
  const result = await prisma.$queryRaw<[{ "1": number }]>`SELECT 1 as \`1\``;
  console.log("✅ Connection OK. Query result:", result);

  // Optional: get server version (works on MySQL/TiDB)
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
