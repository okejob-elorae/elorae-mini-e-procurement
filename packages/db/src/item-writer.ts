import { ItemSource, Prisma, type PrismaClient } from "../generated/prisma/client";
import { sqlId, usePostgres } from "./sql-dialect";

export { hargaJubelioBerbeda, keputusanHargaBerlaku, type HargaMasukan } from "./item-writer-harga";

/**
 * The Item columns that hold what Jubelio was last confirmed, observed or decided to show (owner
 * decisions 2026-11-02: the ERP is the price master, a price reaches Jubelio only after it is
 * confirmed in the ERP, a price edited directly in Jubelio raises a warning, and no push may
 * change it while the warning is open).
 *
 * Who writes what:
 * - `jubelioConfirmed*`, `jubelioCreateRequested*`: the web confirmation page
 *   (apps/web/lib/jubelio/harga); apps/api only through `createItemFromIngest`,
 *   `markJubelioCreateRequested` and `recordJubelioPriceOnMapping` below.
 * - `jubelioObserved*` (what Jubelio was last READ to show — highest and lowest variant price):
 *   only `createItemFromIngest` (at create) and `recordJubelioObservedPrice` (catalog ingest, the
 *   api price observer, a successful product push). Never copied into `sellingPrice`.
 * - `jubelioPriceDecidedAt` (an admin's price decision): only the three web writers that decide
 *   it — confirm, revert, "Kirim ulang harga ERP".
 * None of them comes through the generic ingest data, and the api never writes `salesChannel` or
 * `priceRuleBasis` (both Omitted below): a new item from Jubelio gets `SALURAN_BARANG_DARI_JUBELIO`.
 */
export type JubelioPriceStateField =
  | "jubelioConfirmedPrice"
  | "jubelioConfirmedAt"
  | "jubelioConfirmedById"
  | "jubelioCreateRequestedAt"
  | "jubelioCreateRequestedById"
  | "jubelioObservedPriceMax"
  | "jubelioObservedPriceMin"
  | "jubelioObservedAt"
  | "jubelioObservedChangedAt"
  | "jubelioPriceDecidedAt";

/** The ERP-only choices of an item: where it is sold, and the basis of its recommendation percent. */
type ErpOnlyField = "salesChannel" | "priceRuleBasis";

/**
 * Sales channel of an item created by the Jubelio catalog ingest (owner answer P71, 2026-11-02:
 * "Keduanya" — sold on the marketplace AND in offline stores).
 */
export const SALURAN_BARANG_DARI_JUBELIO = "BOTH" as const;

export type IngestItemCreateData =
  | Omit<Prisma.ItemCreateInput, "source" | JubelioPriceStateField | ErpOnlyField>
  | Omit<Prisma.ItemUncheckedCreateInput, "source" | JubelioPriceStateField | ErpOnlyField>;

/**
 * No `sellingPrice`: an existing item's price is typed in the ERP, and nothing coming from Jubelio
 * (product webhook, Impor katalog) may change it. Only the create branch may set a price, for an
 * item the ERP does not have yet.
 */
export type IngestItemUpdateData =
  | Omit<Prisma.ItemUpdateInput, "source" | "sellingPrice" | JubelioPriceStateField | ErpOnlyField>
  | Omit<Prisma.ItemUncheckedUpdateInput, "source" | "sellingPrice" | JubelioPriceStateField | ErpOnlyField>;

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
 * An observed Jubelio figure as stored: "110000.00", "0.00" for an explicit price of 0 or less (a
 * variant Jubelio shows with no price), or null when nothing is known. Unreadable is null, never 0.
 */
function observedFigure(value: PriceInput): string | null {
  if (value == null || value === "") return null;
  try {
    const d = new Prisma.Decimal(typeof value === "object" ? value.toFixed() : value);
    if (!d.isFinite()) return null;
    return d.greaterThan(0) ? d.toFixed(2) : "0.00";
  } catch {
    return null;
  }
}

/** What Jubelio shows for an article: the highest and the lowest variant price (P1). */
export type ObservedJubelioPrice = { highest: PriceInput; lowest: PriceInput };

/**
 * An item the ERP does not have yet takes Jubelio's sell_price, and that price is by definition
 * what Jubelio shows, so it is also recorded as the confirmed Jubelio price
 * (`jubelioConfirmedById` null = recorded from Jubelio, not confirmed by a person). An empty or
 * zero sell_price confirms nothing. The ingest passes the HIGHEST variant price as `sellingPrice`
 * (P1) and, when the price was readable at all, what Jubelio showed as `observed` (highest and
 * lowest, read at `readAt`). The channel is "Keduanya" (P71).
 */
export function createItemFromIngest(
  tx: Prisma.TransactionClient,
  data: IngestItemCreateData,
  now: Date = new Date(),
  observed?: ObservedJubelioPrice & { readAt: Date },
) {
  const confirmed = positivePrice(data.sellingPrice);
  return tx.item.create({
    data: {
      ...data,
      source: ItemSource.JUBELIO_INGEST,
      salesChannel: SALURAN_BARANG_DARI_JUBELIO,
      jubelioConfirmedPrice: confirmed,
      jubelioConfirmedAt: confirmed == null ? null : now,
      jubelioConfirmedById: null,
      ...(observed
        ? {
            jubelioObservedPriceMax: observedFigure(observed.highest),
            jubelioObservedPriceMin: observedFigure(observed.lowest),
            jubelioObservedAt: observed.readAt,
            jubelioObservedChangedAt: observed.readAt,
          }
        : {}),
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
 * Never for an item sold in offline stores only: "Toko offline saja" is never sent to Jubelio
 * (owner answer P3a).
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
      AND ${sqlId("salesChannel")} <> 'OFFLINE'
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

/** A `DateTime(3)` column plus one millisecond, in the active dialect. */
const satuMsSesudah = (x: Prisma.Sql) =>
  usePostgres() ? Prisma.sql`${x} + INTERVAL '1 millisecond'` : Prisma.sql`${x} + INTERVAL 1000 MICROSECOND`;

/**
 * Records what Jubelio was READ to show for an item: its highest and lowest variant price (owner
 * answer P1), read at `readAt`. `jubelioObservedChangedAt` moves only when either figure changes,
 * so a re-read of the same prices keeps the moment the difference first appeared — that moment is
 * what an admin's price decision is compared against (`keputusanHargaBerlaku`).
 *
 * A figure change from a read that began at or before the item's price decision is stamped 1 ms
 * after that decision, so it always invalidates it (P75) — the admin never saw it;
 * `jubelioObservedAt` stays the read time. Every caller takes `readAt` BEFORE its fetch, and a
 * fetch of the whole catalog can outlast an admin's click: without this, an edit read before the
 * decision but recorded after it would count as covered by that decision, and the next push would
 * overwrite it. The decision is read by the statement itself, at write time, so a write that
 * waited on the decision's row lock still sees it.
 *
 * ONE guarded statement: it is refused when a LATER read is already recorded, so an ingest or an
 * observer run that started before a push finished cannot plant a stale reading over the push's
 * own. The SET order is load-bearing: MariaDB evaluates assignments left to right against the row
 * being updated, Postgres against the old row, so `jubelioObservedChangedAt` is assigned FIRST and
 * reads the old figures on both. The bound figures are CAST, or Postgres cannot type a NULL
 * parameter. The statement is built whole with `Prisma.sql` and passed as one argument. Never
 * touches `sellingPrice`, `jubelioConfirmed*` or `jubelioPriceDecidedAt` (the decision is only
 * read). Returns true when the reading was recorded.
 */
export async function recordJubelioObservedPrice(
  client: RawClient,
  itemId: string,
  observed: ObservedJubelioPrice,
  readAt: Date,
): Promise<boolean> {
  const highest = observedFigure(observed.highest);
  const lowest = observedFigure(observed.lowest);
  const h = Prisma.sql`CAST(${highest} AS DECIMAL(14,2))`;
  const l = Prisma.sql`CAST(${lowest} AS DECIMAL(14,2))`;
  const max = sqlId("jubelioObservedPriceMax");
  const min = sqlId("jubelioObservedPriceMin");
  const decidedAt = sqlId("jubelioPriceDecidedAt");
  const count = await client.$executeRaw(Prisma.sql`
    UPDATE ${sqlId("Item")}
    SET ${sqlId("jubelioObservedChangedAt")} = CASE
          WHEN ${sqlId("jubelioObservedAt")} IS NOT NULL
            AND (${max} = ${h} OR (${max} IS NULL AND ${h} IS NULL))
            AND (${min} = ${l} OR (${min} IS NULL AND ${l} IS NULL))
          THEN ${sqlId("jubelioObservedChangedAt")}
          WHEN ${decidedAt} IS NOT NULL AND ${decidedAt} >= ${readAt}
          THEN ${satuMsSesudah(decidedAt)}
          ELSE ${readAt}
        END,
        ${max} = ${h},
        ${min} = ${l},
        ${sqlId("jubelioObservedAt")} = ${readAt}
    WHERE ${sqlId("id")} = ${itemId}
      AND (${sqlId("jubelioObservedAt")} IS NULL OR ${sqlId("jubelioObservedAt")} <= ${readAt})
  `);
  return count > 0;
}
