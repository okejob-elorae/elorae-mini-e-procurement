import type { Prisma, PrismaClient } from "../generated/prisma/client";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * The verified Jubelio stock contract (probed live against prod Jubelio + prod DB, 2026-09-27:
 * `end_qty` tracked `InventoryValue.qtyOnHand` closely on four sampled variants — 128/128,
 * 137/133, 125/124, 186/187).
 *
 * `GET /inventory/items/` returns, per variant, `end_qty`, `order_qty` and `available_qty`,
 * where `available_qty = end_qty − order_qty`. `end_qty` is ON-HAND. `order_qty` is Jubelio's
 * OWN open marketplace commitments — Jubelio subtracts those from `end_qty` to produce
 * `available_qty`; `end_qty` itself is on-hand. The only commitment Jubelio cannot see is
 * Elorae's field-sales holds: `StockReservation` rows with `source <> "JUBELIO"`
 * (`FIELD_SALES` at putus order create, `FIELD_SALES_KONSI` at konsi approve / admin konsi push).
 *
 * | Path | Formula |
 * |---|---|
 * | Push (Elorae → Jubelio `end_qty`) | `end_qty = max(0, qtyOnHand − offlineReserved)` |
 * | Webhook (Jubelio `end_qty` → Elorae) | `qtyOnHand = end_qty + offlineReserved` |
 * | Reconciliation comparison | Elorae `max(0, qtyOnHand − offlineReserved)` vs Jubelio `end_qty` |
 * | MATCH_JUBELIO correction | `qtyOnHand = end_qty + offlineReserved`, absolute |
 *
 * The holds are added back (webhook, MATCH_JUBELIO) and subtracted for the comparison ONLY while
 * stock pushes are enabled (`isJubelioStockPushEnabled`). Only a push nets them out of Jubelio's
 * `end_qty`; while pushes are off, nothing has, so adding them back would overstate on-hand. Use
 * `effectiveOfflineReservedQty` / `effectiveOfflineReservedByKey` on those three paths, never the
 * raw figure. The push itself only runs while enabled, so it always nets.
 *
 * Sending `qtyOnHand − reservedQty` (which also nets out JUBELIO's own reservations)
 * double-subtracts marketplace commitments, since Jubelio nets them out again via
 * `order_qty` — and that already-reduced figure would erode on-hand a little more on every
 * round trip if a push echoes back as a stock webhook (unconfirmed). Never reintroduce that
 * shape. See `docs/landmines/jubelio.md`.
 */

export type OfflineReservedKey = { itemId: string; variantSku: string };

/**
 * Elorae's open field-sales holds for one item/variant that Jubelio cannot see:
 * `SUM(qty − consumedQty)` over `StockReservation` rows with `state: "RESERVED"` and
 * `source` other than `"JUBELIO"`.
 *
 * `variantSku` must already be normalised to `""` for a variantless row (the column
 * defaults to `""` and the field-sales writers always store that spelling, never `null`).
 * Runs on `client`, so it composes inside a transaction on a locked row.
 */
export async function offlineReservedQty(
  client: AnyClient,
  itemId: string,
  variantSku: string,
): Promise<number> {
  const result = await client.stockReservation.aggregate({
    where: { itemId, variantSku, state: "RESERVED", source: { not: "JUBELIO" } },
    _sum: { qty: true, consumedQty: true },
  });
  const qty = Number(result._sum.qty ?? 0);
  const consumed = Number(result._sum.consumedQty ?? 0);
  return qty - consumed;
}

/**
 * Batched `offlineReservedQty`, for the stock push (many variants at once) and the
 * reconciliation loop. One `groupBy` covers every requested key. `[]` returns an empty
 * map without querying. A requested key with no open offline reservations maps to `0`.
 */
export async function offlineReservedByKey(
  client: AnyClient,
  keys: OfflineReservedKey[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (keys.length === 0) return map;

  const rows = await client.stockReservation.groupBy({
    by: ["itemId", "variantSku"],
    where: {
      state: "RESERVED",
      source: { not: "JUBELIO" },
      OR: keys.map((k) => ({ itemId: k.itemId, variantSku: k.variantSku })),
    },
    _sum: { qty: true, consumedQty: true },
  });

  for (const row of rows) {
    const qty = Number(row._sum.qty ?? 0);
    const consumed = Number(row._sum.consumedQty ?? 0);
    map.set(`${row.itemId}:${row.variantSku}`, qty - consumed);
  }

  for (const k of keys) {
    const key = `${k.itemId}:${k.variantSku}`;
    if (!map.has(key)) map.set(key, 0);
  }

  return map;
}

/** What Elorae should push as Jubelio's `end_qty`: on-hand minus offline holds, floored at 0. */
export function jubelioEndQtyFor(qtyOnHand: number, offlineReserved: number): number {
  return Math.max(0, qtyOnHand - offlineReserved);
}

/** What Elorae's on-hand should become from a Jubelio `end_qty`: add the offline holds back. */
export function eloraeOnHandFromJubelio(endQty: number, offlineReserved: number): number {
  return endQty + offlineReserved;
}

/** A Jubelio quantity is only trustworthy when it is a finite, non-negative number. */
export function isValidJubelioQty(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

const JUBELIO_QTY_STRING = /^\d+(\.\d+)?$/;

/**
 * Reads a RAW Jubelio quantity field, validating it before any coercion: a finite non-negative
 * `number`, or a plain decimal string such as `"12"` or `"12.5"`. Anything else — `null`, `""`,
 * `"abc"`, `-1`, `NaN` — is `null`, meaning "no figure". Never `Number(raw)` first: `Number(null)`
 * and `Number("")` are both `0`, which would pass `isValidJubelioQty` and write a zero Jubelio
 * never reported.
 */
export function parseJubelioQty(raw: unknown): number | null {
  if (typeof raw === "number") return isValidJubelioQty(raw) ? raw : null;
  if (typeof raw === "string" && JUBELIO_QTY_STRING.test(raw)) {
    const n = Number(raw);
    return isValidJubelioQty(n) ? n : null;
  }
  return null;
}

/** `SystemSetting` key gating every push of Elorae stock to Jubelio. See `isJubelioStockPushEnabled`. */
export const JUBELIO_STOCK_PUSH_ENABLED_KEY = "JUBELIO_STOCK_PUSH_ENABLED";

/**
 * Whether Elorae is allowed to push stock to Jubelio at all, owner-approved cutover switch.
 *
 * Jubelio is the stock source of truth until cutover: prod Elorae is live but not in regular
 * use, so pushing Elorae's (currently unreliable — see the module doc above) figures over
 * Jubelio's would overwrite the side everyone actually trusts. Fails CLOSED — true only when the
 * stored value is exactly `"true"`; an absent row, a malformed value, or anything else (`"1"`,
 * `"TRUE"`, `"yes"`) all mean disabled. The webhook path (Jubelio → Elorae) keeps applying either
 * way; what the switch changes there is only whether the field-sales holds are added back (see
 * `effectiveOfflineReservedQty`).
 */
export async function isJubelioStockPushEnabled(client: AnyClient): Promise<boolean> {
  const row = await client.systemSetting.findUnique({
    where: { key: JUBELIO_STOCK_PUSH_ENABLED_KEY },
    select: { value: true },
  });
  return row?.value === "true";
}

/**
 * The field-sales holds Jubelio's `end_qty` has actually had netted out of it: the open offline
 * holds while stock pushes are enabled, `0` while they are disabled. Only a push nets them, so
 * while pushes are off the webhook, the MATCH_JUBELIO correction and the reconciliation comparison
 * must all treat `end_qty` as plain on-hand. Runs on `client`, so it composes inside a transaction.
 */
export async function effectiveOfflineReservedQty(
  client: AnyClient,
  itemId: string,
  variantSku: string,
): Promise<number> {
  if (!(await isJubelioStockPushEnabled(client))) return 0;
  return offlineReservedQty(client, itemId, variantSku);
}

/**
 * Batched `effectiveOfflineReservedQty`. While pushes are disabled every requested key maps to
 * `0` without querying the reservations at all.
 */
export async function effectiveOfflineReservedByKey(
  client: AnyClient,
  keys: OfflineReservedKey[],
): Promise<Map<string, number>> {
  if (!(await isJubelioStockPushEnabled(client))) {
    return new Map(keys.map((k) => [`${k.itemId}:${k.variantSku}`, 0]));
  }
  return offlineReservedByKey(client, keys);
}
