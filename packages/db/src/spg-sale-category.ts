import { Prisma } from "../generated/prisma/client";
import { sqlId } from "./sql-dialect";

/**
 * SPG commission reads a piece's category ONLY from its sale line (`SpgSaleLine.categoryId`,
 * stamped from `Item.categoryId` at sale time with the moment it was read, `categoryAt` — owner
 * answer P8). A line sold while its item had NO category gets the item's category the first time
 * the item receives one, and then it freezes (owner answer P69): this helper is that one fill.
 *
 * Today the only path that changes `Item.categoryId` on an existing item is the ERP item form
 * (apps/web/lib/items/mutations.ts), and it calls this helper inside the transaction that writes
 * the category. The Jubelio catalog ingest writes a category only when it CREATES an item, which
 * has no sales yet; its update branch (`updateItemFromIngest`) leaves the category alone. Any
 * future path that changes `categoryId` on an existing item must call this helper in the same
 * transaction, or the waiting lines stay unrated.
 *
 * - A no-op when `categoryId` is null: removing a category never touches a line.
 * - Fills only lines still WITHOUT a category (`categoryId IS NULL`), so a line that already has
 *   one, stamped at sale or filled earlier, never changes — a later category change on the item
 *   does not re-rate old sales.
 * - Only lines with `categoryAt` set. A line with `categoryAt` NULL was written by an image that
 *   predates the category column (the deploy window); it reads as unrated until the migration's
 *   backfill statement is re-run, and this helper never guesses its category.
 * - The filled line records when its category was read (`categoryAt = waktu`) and that it was
 *   filled afterwards (`categoryFilledLater`), so the sale page can tell the two apart.
 *
 * ONE statement, so its WHERE is re-evaluated at write time: two concurrent fills with different
 * categories cannot both win on the same line. A Prisma `updateMany` reads the matching ids first
 * and writes by id, which is not a compare-and-swap. Built whole with this module's own
 * `Prisma.sql` and passed as one argument. Returns the number of lines filled.
 */
export async function isiKategoriPenjualanSpg(
  tx: Prisma.TransactionClient,
  input: { itemId: string; categoryId: string | null; waktu: Date },
): Promise<number> {
  if (!input.categoryId) return 0;
  return tx.$executeRaw(Prisma.sql`
    UPDATE ${sqlId("SpgSaleLine")}
    SET ${sqlId("categoryId")} = ${input.categoryId},
        ${sqlId("categoryAt")} = ${input.waktu},
        ${sqlId("categoryFilledLater")} = TRUE
    WHERE ${sqlId("itemId")} = ${input.itemId}
      AND ${sqlId("categoryId")} IS NULL
      AND ${sqlId("categoryAt")} IS NOT NULL
  `);
}
