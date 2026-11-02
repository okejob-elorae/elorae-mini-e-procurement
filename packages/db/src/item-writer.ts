import { ItemSource, Prisma, type PrismaClient } from "../generated/prisma/client";
import { sqlId } from "./sql-dialect";

/**
 * The Item columns that hold what Jubelio was last confirmed to show (owner decision 2026-11-02:
 * the ERP is the price master, and a price reaches Jubelio only after it is confirmed in the ERP).
 * The web confirmation page (apps/web/lib/jubelio/harga) writes them; apps/api writes them only
 * through `createItemFromIngest`, `markJubelioCreateRequested` and `recordJubelioPriceOnMapping`
 * below, never through the generic ingest data.
 */
export type JubelioPriceStateField =
  | "jubelioConfirmedPrice"
  | "jubelioConfirmedAt"
  | "jubelioConfirmedById"
  | "jubelioCreateRequestedAt"
  | "jubelioCreateRequestedById";

export type IngestItemCreateData =
  | Omit<Prisma.ItemCreateInput, "source" | JubelioPriceStateField>
  | Omit<Prisma.ItemUncheckedCreateInput, "source" | JubelioPriceStateField>;

/**
 * No `sellingPrice`: an existing item's price is typed in the ERP, and nothing coming from Jubelio
 * (product webhook, Impor katalog) may change it. Only the create branch may set a price, for an
 * item the ERP does not have yet.
 */
export type IngestItemUpdateData =
  | Omit<Prisma.ItemUpdateInput, "source" | "sellingPrice" | JubelioPriceStateField>
  | Omit<Prisma.ItemUncheckedUpdateInput, "source" | "sellingPrice" | JubelioPriceStateField>;

type PriceInput = Prisma.Decimal | Prisma.DecimalJsLike | number | string | null | undefined;

/** A price of 0 or less, or anything unreadable, counts as no price — on both sides of a comparison. */
function positivePrice(value: PriceInput): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  try {
    const d = new Prisma.Decimal(typeof value === "object" ? value.toFixed() : value);
    return d.isFinite() && d.greaterThan(0) ? d : null;
  } catch {
    return null;
  }
}

/**
 * An item the ERP does not have yet takes Jubelio's sell_price, and that price is by definition
 * what Jubelio shows, so it is also recorded as the confirmed Jubelio price
 * (`jubelioConfirmedById` null = recorded from Jubelio, not confirmed by a person). An empty or
 * zero sell_price confirms nothing.
 */
export function createItemFromIngest(
  tx: Prisma.TransactionClient,
  data: IngestItemCreateData,
  now: Date = new Date(),
) {
  const confirmed = positivePrice(data.sellingPrice);
  return tx.item.create({
    data: {
      ...data,
      source: ItemSource.JUBELIO_INGEST,
      jubelioConfirmedPrice: confirmed,
      jubelioConfirmedAt: confirmed == null ? null : now,
      jubelioConfirmedById: null,
    },
  });
}

export function updateItemFromIngest(
  tx: Prisma.TransactionClient,
  where: Prisma.ItemWhereUniqueInput,
  data: IngestItemUpdateData,
) {
  return tx.item.update({
    where,
    data: { ...data, source: ItemSource.JUBELIO_INGEST },
  });
}

type RawClient = Prisma.TransactionClient | PrismaClient;

/**
 * The product-push backstop: an unmapped ERP finished good with no confirmed price is not created
 * in Jubelio; this stamps the create request instead, so the item lands on the confirmation list
 * rather than vanishing (an old create row from before the confirmation step, a retried row).
 *
 * ONE statement, so its WHERE is re-evaluated at write time: it can never re-stamp an item an
 * admin confirmed (or that the ingest mapped) a moment earlier. A Prisma `updateMany` reads the
 * matching ids first and writes by id, which is not a compare-and-swap. The query is built whole
 * with this module's own `Prisma.sql` and passed as one argument, never interpolated as a fragment
 * into a tagged template. Returns true when the row was stamped.
 */
export async function markJubelioCreateRequested(
  client: RawClient,
  itemId: string,
  requestedById: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const count = await client.$executeRaw(Prisma.sql`
    UPDATE ${sqlId("Item")}
    SET ${sqlId("jubelioCreateRequestedAt")} = ${now},
        ${sqlId("jubelioCreateRequestedById")} = ${requestedById}
    WHERE ${sqlId("id")} = ${itemId}
      AND ${sqlId("type")} = 'FINISHED_GOOD'
      AND ${sqlId("source")} = 'ERP'
      AND ${sqlId("jubelioCreateRequestedAt")} IS NULL
      AND (${sqlId("jubelioConfirmedPrice")} IS NULL OR ${sqlId("jubelioConfirmedPrice")} <= 0)
      AND NOT EXISTS (
        SELECT 1 FROM ${sqlId("JubelioProductMapping")} m
        WHERE m.${sqlId("itemId")} = ${sqlId("Item")}.${sqlId("id")}
      )
  `);
  return count > 0;
}

/**
 * The catalog ingest has just mapped an EXISTING item to a Jubelio product. When the ERP holds no
 * confirmed Jubelio price for it yet, record the price Jubelio holds, because that is what the
 * marketplace shows: the item then reads "Jubelio Y -> ERP X" on the confirmation list (or leaves
 * it when they agree) instead of "no Jubelio price -> X", and its name, photo and variant pushes
 * are not held back for a price Jubelio already has. A stale create request is cleared with it,
 * since the product now exists. `sellingPrice` is never touched and a confirmed price is never
 * overwritten; an empty or zero Jubelio price records nothing. One statement, for the same reason
 * as `markJubelioCreateRequested`. Returns true when a price was recorded.
 */
export async function recordJubelioPriceOnMapping(
  client: RawClient,
  itemId: string,
  jubelioPrice: PriceInput,
  now: Date = new Date(),
): Promise<boolean> {
  const price = positivePrice(jubelioPrice);
  if (price == null) return false;
  const count = await client.$executeRaw(Prisma.sql`
    UPDATE ${sqlId("Item")}
    SET ${sqlId("jubelioConfirmedPrice")} = ${price.toFixed(2)},
        ${sqlId("jubelioConfirmedAt")} = ${now},
        ${sqlId("jubelioConfirmedById")} = NULL,
        ${sqlId("jubelioCreateRequestedAt")} = NULL,
        ${sqlId("jubelioCreateRequestedById")} = NULL
    WHERE ${sqlId("id")} = ${itemId}
      AND (${sqlId("jubelioConfirmedPrice")} IS NULL OR ${sqlId("jubelioConfirmedPrice")} <= 0)
  `);
  return count > 0;
}
