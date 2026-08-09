import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const MIGRATION_SQL_PATH = resolve(
  __dirname,
  "../../../../../packages/db/prisma/migrations/20260809130000_backfill_field_sales_deliveries/migration.sql",
);

/**
 * This spec cannot invoke the backfill migration
 * (`packages/db/prisma/migrations/20260809130000_backfill_field_sales_deliveries/migration.sql`) —
 * vitest has no SQL runner, and that file only ever runs through `prisma migrate deploy`. What it
 * can do is read the migration as text and prove it never writes to a table the backfill must
 * leave alone, which is the one regression a unit test can actually catch here.
 *
 * A DB-backed describe used to sit below this. It seeded an order in the pre-migration state,
 * replicated the migration's writes through the Prisma client, and asserted the result — but every
 * assertion restated a value the test body had just written (including `dueDate`, compared against
 * the same `computeDueDate(...)` call that constructed it), so it could not fail, while costing
 * ~11 real row inserts per run on the shared :3308 bed. It was deleted rather than kept as a
 * schema smoke test. What verifies a real run is the POST-FLIGHT section in the migration's own
 * comment block: four queries, each expected to return 0, to be run against the database that
 * migration actually touched.
 */
describe("field sales delivery backfill migration text", () => {
  it("never references the tables or columns a backfill must not touch", () => {
    /*
     * Strip `--` comment lines before scanning: the migration's own prose NAMES several of these
     * tokens while explaining the rule ("writes NO stock movement, NO StockAdjustment, and NO
     * SalesHistory") — that is documentation of the rule, not a violation of it, and scanning the
     * raw file would fail this test permanently on a migration that is doing exactly what it
     * should. The file has no trailing `--` on a statement line and no C-style block comments, so
     * a leading-`--` line filter is a complete comment strip for this specific file.
     *
     * Lower-case both sides before comparing: MariaDB table names are case-insensitive under
     * `lower_case_table_names=1`, so a statement written as INSERT INTO saleshistory (lowercase)
     * would pass a case-sensitive `.toContain("SalesHistory")` check while still writing to the
     * table.
     */
    const sql = readFileSync(MIGRATION_SQL_PATH, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .toLowerCase();
    for (const forbidden of ["InventoryValue", "StockAdjustment", "SalesHistory", "qtyOnHand", "reservedQty"]) {
      expect(sql).not.toContain(forbidden.toLowerCase());
    }
  });
});
