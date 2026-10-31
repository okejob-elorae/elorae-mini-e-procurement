import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * True when DATABASE_URL points at PostgreSQL (Supabase) rather than
 * MySQL/MariaDB. Accepts both `postgres://` and `postgresql://`.
 */
export function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url.trim());
}

/**
 * Pick the Prisma driver adapter from the URL scheme, so one codebase runs on
 * both the MariaDB deployment (VPS) and the PostgreSQL one (Supabase) without
 * a build flag. Keep this the only place either adapter is constructed.
 */
export function createDbAdapter(url: string): PrismaPg | PrismaMariaDb {
  return isPostgresUrl(url) ? new PrismaPg(url) : new PrismaMariaDb(url);
}
