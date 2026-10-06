import type { Prisma } from "../generated/prisma/client";

export type LockedInventoryValueRow = { id: string; qtyOnHand: string; avgCost: string };

/**
 * Locks the main `InventoryValue` row for one item/variant with `SELECT … FOR UPDATE` and returns
 * it, or `null` when there is none. Call it as the FIRST statement of the transaction whose later
 * reads and writes depend on that row, so no concurrent writer can move it in between.
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
 * prod until this was fixed; every one refused `NO_INVENTORY_ROW`.
 */
export async function lockMainInventoryValueRow(
  tx: Prisma.TransactionClient,
  itemId: string,
  variantSku: string | null | undefined,
): Promise<LockedInventoryValueRow | null> {
  const rows = variantSku
    ? await tx.$queryRaw<{ id: string; qtyOnHand: unknown; avgCost: unknown }[]>`
        SELECT \`id\`, \`qtyOnHand\`, \`avgCost\` FROM \`InventoryValue\`
        WHERE \`itemId\` = ${itemId} AND \`variantSku\` = ${variantSku}
        ORDER BY \`id\` ASC
        LIMIT 1
        FOR UPDATE
      `
    : await tx.$queryRaw<{ id: string; qtyOnHand: unknown; avgCost: unknown }[]>`
        SELECT \`id\`, \`qtyOnHand\`, \`avgCost\` FROM \`InventoryValue\`
        WHERE \`itemId\` = ${itemId} AND (\`variantSku\` IS NULL OR \`variantSku\` = '')
        ORDER BY \`id\` ASC
        LIMIT 1
        FOR UPDATE
      `;
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, qtyOnHand: String(row.qtyOnHand), avgCost: String(row.avgCost) };
}
