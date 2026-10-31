import { Prisma } from "../generated/prisma/client";
import { isPostgresUrl } from "./adapter";
import { getDatabaseUrl } from "./db-connection";

/**
 * Raw SQL in this codebase was written for MySQL. Running the same statements on
 * PostgreSQL (Supabase) breaks on two mechanical differences:
 *
 *   1. Postgres folds unquoted identifiers to lower case. Prisma created every
 *      table and column in camelCase, so `FROM SalesOrder` looks for `salesorder`
 *      and fails with 42P01. Output aliases matter just as much: an unquoted
 *      `AS salesmanId` comes back as key `salesmanid`, silently handing the
 *      caller undefined instead of a value.
 *   2. `NOW(3)` is MySQL-only.
 *
 * These helpers keep ONE copy of each query and let the dialect decide, rather
 * than forking every statement into two drifting variants.
 *
 * Resolved per call, not at module load: dotenv may populate DATABASE_URL after
 * this module is first imported.
 */
export function usePostgres(): boolean {
  return isPostgresUrl(getDatabaseUrl() || process.env.DATABASE_URL || "");
}

/**
 * Quote a table/column/alias for the active dialect. Callers pass literals from
 * source code, never user input.
 */
export function sqlId(name: string): Prisma.Sql {
  return Prisma.raw(usePostgres() ? `"${name.replace(/"/g, '""')}"` : name);
}

/**
 * Server-side "now" with millisecond precision, for a `DateTime` column —
 * `timestamp(3) without time zone` on Postgres, `datetime(3)` on MySQL.
 * LOCALTIMESTAMP (not CURRENT_TIMESTAMP) because the column carries no time
 * zone, and Prisma writes UTC into it.
 */
export function nowMs(): Prisma.Sql {
  return Prisma.raw(usePostgres() ? "LOCALTIMESTAMP(3)" : "NOW(3)");
}
