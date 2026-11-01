import type { Prisma } from "../generated/prisma/client";
import { usePostgres } from "./sql-dialect";

export type LockedInventoryValueRow = { id: string; qtyOnHand: string; avgCost: string };

/**
 * Locks the main `InventoryValue` row for one item/variant with `SELECT … FOR UPDATE` and returns
 * it, or `null` when there is none. Call it before anything else in the transaction reads that
 * row — normally as its first statement — so no concurrent writer can move it between the read and
 * the write that depends on it. Two callers take it later, on purpose. `moveMainStock`'s
 * first-receipt path reaches this only after its own non-locking lookup missed and it has locked
 * the `Item` row, and relies on this read returning the latest committed row rather than that
 * lookup's snapshot. `calculateMovingAverage` (apps/web/lib/inventory/costing.ts) runs the plain
 * lookup first and then locks, refusing the receipt when the locked row is not the row the lookup
 * found, so a receipt racing a concurrent first receipt is refused rather than blended wrongly.
 *
 * Same OR-tolerant shape as `findExistingInventoryValueRow` in apps/web, tie-break included: a
 * variantless lookup matches both the `null` and the `""` spelling and takes the lowest id. Only
 * the values are interpolated (parameterised by Prisma); the identifiers are static SQL text.
 * Decimals come back as strings so callers can do exact arithmetic on them.
 *
 * Each branch is one complete query with only scalar values: never interpolate a `Prisma.sql`
 * fragment into the client's own tagged `$queryRaw`. apps/web's build bundles the Prisma runtime
 * into several server chunks that share one client through `globalThis`, and the client resolves a
 * nested fragment with `instanceof` against its own runtime's `Sql` class. A fragment built by
 * another chunk's copy fails that check, is bound as a plain string value, and the `WHERE`
 * silently matches nothing — which is why no reconciliation Match through this lock ever wrote on
 * prod until this was fixed; every one refused `NO_INVENTORY_ROW`. The same rule is why the dialect
 * picks between whole statements instead of quoting identifiers through `sqlId`: MySQL takes
 * backticks, PostgreSQL needs double quotes around every camelCase identifier.
 */
export async function lockMainInventoryValueRow(
  tx: Prisma.TransactionClient,
  itemId: string,
  variantSku: string | null | undefined,
): Promise<LockedInventoryValueRow | null> {
  type Row = { id: string; qtyOnHand: unknown; avgCost: unknown };
  let rows: Row[];
  if (usePostgres()) {
    rows = variantSku
      ? await tx.$queryRaw<Row[]>`
          SELECT "id", "qtyOnHand", "avgCost" FROM "InventoryValue"
          WHERE "itemId" = ${itemId} AND "variantSku" = ${variantSku}
          ORDER BY "id" ASC
          LIMIT 1
          FOR UPDATE
        `
      : await tx.$queryRaw<Row[]>`
          SELECT "id", "qtyOnHand", "avgCost" FROM "InventoryValue"
          WHERE "itemId" = ${itemId} AND ("variantSku" IS NULL OR "variantSku" = '')
          ORDER BY "id" ASC
          LIMIT 1
          FOR UPDATE
        `;
  } else {
    rows = variantSku
      ? await tx.$queryRaw<Row[]>`
          SELECT \`id\`, \`qtyOnHand\`, \`avgCost\` FROM \`InventoryValue\`
          WHERE \`itemId\` = ${itemId} AND \`variantSku\` = ${variantSku}
          ORDER BY \`id\` ASC
          LIMIT 1
          FOR UPDATE
        `
      : await tx.$queryRaw<Row[]>`
          SELECT \`id\`, \`qtyOnHand\`, \`avgCost\` FROM \`InventoryValue\`
          WHERE \`itemId\` = ${itemId} AND (\`variantSku\` IS NULL OR \`variantSku\` = '')
          ORDER BY \`id\` ASC
          LIMIT 1
          FOR UPDATE
        `;
  }
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, qtyOnHand: String(row.qtyOnHand), avgCost: String(row.avgCost) };
}

/**
 * Locks one main `InventoryValue` row by id with `SELECT … FOR UPDATE` and returns its current
 * quantity and cost, or `null` when no row with that id belongs to `itemId`. For a writer that has
 * already picked its row by a rule other than the lowest-id one above (the marketplace order rule
 * in reservation-writer.ts, which prefers the `""` spelling) and must read that row's balance
 * under the lock before computing a value it writes back. The `itemId` term is the same ownership
 * check `moveMainStock` applies to a pinned id.
 *
 * A locking read returns the latest committed version even inside a snapshot that predates it, so
 * a concurrent writer that moved the row first is waited out and then seen. Same one-complete-
 * statement-per-dialect rule as above.
 */
export async function lockInventoryValueRowById(
  tx: Prisma.TransactionClient,
  id: string,
  itemId: string,
): Promise<LockedInventoryValueRow | null> {
  type Row = { id: string; qtyOnHand: unknown; avgCost: unknown };
  const rows = usePostgres()
    ? await tx.$queryRaw<Row[]>`
        SELECT "id", "qtyOnHand", "avgCost" FROM "InventoryValue"
        WHERE "id" = ${id} AND "itemId" = ${itemId}
        FOR UPDATE
      `
    : await tx.$queryRaw<Row[]>`
        SELECT \`id\`, \`qtyOnHand\`, \`avgCost\` FROM \`InventoryValue\`
        WHERE \`id\` = ${id} AND \`itemId\` = ${itemId}
        FOR UPDATE
      `;
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, qtyOnHand: String(row.qtyOnHand), avgCost: String(row.avgCost) };
}
