import type { Prisma, PrismaClient } from "@elorae/db";
import { matchKey } from "@/lib/items/variant-rows";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * The key every stocktake map matches stock and ledger rows on. The `(storeId, itemId,
 * variantSku)` unique index is `utf8mb4_unicode_ci`, so the database — and `setStoreStock`, which
 * reads through it — treats `ABC-01` and `abc-01` as one row; an exact-match map would read a
 * line spelled one way as having no stock under the other. A MATCH key only: never write it.
 */
export function stockMatchKey(itemId: string, variantSku: string | null): string {
  return `${itemId}::${matchKey(variantSku)}`;
}

export type CountMomentLine = { key: string; itemId: string; variantSku: string; moment: Date };

/**
 * Every store movement recorded after each line's own count moment, summed per line in cents and
 * keyed by the caller's `key`. This is THE rule for "what moved since this shelf was counted":
 * `approveStoreStocktake` adds it to the counted figure (through `bookedCountCents` below, which the
 * detail screen's booked preview reads too), and `saveStocktakeCounts` subtracts it from live
 * stock to re-baseline `expectedQty`, so none of them can disagree about which rows a count
 * already saw. One read covers every line: the ledger rows after the EARLIEST moment, then
 * each line keeps only its own item::variant's rows (matched on `stockMatchKey`, case-folded like
 * the balance row they moved) stamped strictly after its own moment. A line
 * with no entry here re-applies nothing.
 *
 * Excluded per line: a retur's store row whose retur was RAISED on or before that line's
 * moment. A retur's ledger row lags the physical movement — the goods leave the shelf when it
 * is raised, but its store row lands later, at approve for a FIELD retur, at receipt plus an
 * approve-time delta for an ADMIN one — so a shelf counted after the raise already saw those
 * units gone, and re-applying the row would take them off twice. Both retur writers stamp the
 * FieldReturn id as the row's `refId`. A retur raised after the line was counted still counts:
 * its goods left after the shelf was counted. Excluded the same way: a store-to-store
 * transfer's rows — BOTH legs, the source's −q and the destination's +q — whose transfer's
 * `movedAt` is on or before the line's moment. Stock moves at transfer approve, which can land
 * after the goods physically moved, so a shelf counted in between already saw them gone or
 * arrived. Both legs stamp the StoreTransfer id as `refId`. A transfer whose goods moved after
 * the line was counted is still re-applied. Both exclusions are judged against each line's own
 * moment, so one retur or transfer can be excluded for a line counted after it and re-applied
 * for a line counted before it. Callers pass counted lines only, so a row for an uncounted item
 * never reaches a figure either way.
 *
 * Excluded likewise: a konsi transfer's store row whose delivery shipment's `deliveredAt`
 * is on or before the line's moment. An offline completion stamps `deliveredAt` from the
 * device (up to three days back), while the transfer and its +q row are written only when the
 * completion syncs, so a shelf counted between the two already holds the delivered units. The
 * transfer stamps its own id as `refId`. A legacy transfer with no shipment is never excluded,
 * and neither is one whose goods were delivered after the line's moment.
 *
 * Never re-applied: an earlier count's own `StoreStocktake` rows. That approval SET the
 * balance to what its own count saw, so it is never a movement this count's shelf missed. A
 * line moment can sit at or before such a row only when it came from the SPG sheet's device
 * time, which `saveStocktakeCounts` clamps to the previous approval's `approvedAt` — and that
 * approval writes its rows at or a few milliseconds after the `approvedAt` it stamps.
 */
export async function sumMovementsSinceCountCents(
  tx: AnyClient,
  storeId: string,
  lines: CountMomentLine[],
): Promise<Map<string, number>> {
  const centsByKey = new Map<string, number>();
  if (lines.length === 0) return centsByKey;

  const earliest = new Date(lines.reduce((min, l) => Math.min(min, l.moment.getTime()), Infinity));
  const postCount = await tx.stockLedgerEntry.findMany({
    where: { locationType: "STORE", locationId: storeId, createdAt: { gt: earliest } },
    select: { itemId: true, variantSku: true, qty: true, refType: true, refId: true, createdAt: true },
  });
  const returIds = Array.from(new Set(postCount.filter((r) => r.refType === "FieldReturn").map((r) => r.refId)));
  const returs = returIds.length > 0
    ? await tx.fieldReturn.findMany({ where: { id: { in: returIds } }, select: { id: true, createdAt: true } })
    : [];
  const returRaisedAtMs = new Map(returs.map((r) => [r.id, r.createdAt.getTime()]));
  const transferIds = Array.from(new Set(postCount.filter((r) => r.refType === "StoreTransfer").map((r) => r.refId)));
  const transfers = transferIds.length > 0
    ? await tx.storeTransfer.findMany({ where: { id: { in: transferIds } }, select: { id: true, movedAt: true } })
    : [];
  const transferMovedAtMs = new Map(transfers.map((t) => [t.id, t.movedAt.getTime()]));
  const konsiTransferIds = Array.from(new Set(postCount.filter((r) => r.refType === "KonsiTransfer").map((r) => r.refId)));
  const konsiTransfers = konsiTransferIds.length > 0
    ? await tx.konsiTransfer.findMany({ where: { id: { in: konsiTransferIds } }, select: { id: true, shipment: { select: { deliveredAt: true } } } })
    : [];
  const konsiDeliveredAtMs = new Map<string, number>();
  for (const t of konsiTransfers) {
    if (t.shipment?.deliveredAt) konsiDeliveredAtMs.set(t.id, t.shipment.deliveredAt.getTime());
  }

  const rowsByKey = new Map<string, typeof postCount>();
  for (const r of postCount) {
    const key = stockMatchKey(r.itemId, r.variantSku);
    const rows = rowsByKey.get(key);
    if (rows) rows.push(r);
    else rowsByKey.set(key, [r]);
  }

  for (const l of lines) {
    const momentMs = l.moment.getTime();
    let cents = 0;
    for (const r of rowsByKey.get(stockMatchKey(l.itemId, l.variantSku)) ?? []) {
      if (r.createdAt.getTime() <= momentMs) continue;
      if (r.refType === "StoreStocktake") continue;
      if (r.refType === "FieldReturn" && (returRaisedAtMs.get(r.refId) ?? Infinity) <= momentMs) continue;
      if (r.refType === "StoreTransfer" && (transferMovedAtMs.get(r.refId) ?? Infinity) <= momentMs) continue;
      if (r.refType === "KonsiTransfer" && (konsiDeliveredAtMs.get(r.refId) ?? Infinity) <= momentMs) continue;
      cents += Math.round(r.qty.toNumber() * 100);
    }
    centsByKey.set(l.key, cents);
  }
  return centsByKey;
}

type BookedLine = {
  key: string;
  itemId: string;
  variantSku: string;
  countedQty: number;
  lineCountFinishedAt: Date | null;
};

/**
 * What approving each counted line would book right now, in cents and keyed by the caller's
 * `key`: the target `approveStoreStocktake` SETs — the counted figure plus
 * `sumMovementsSinceCountCents` from the line's count moment — and the live `StoreStock` qty that
 * SET replaces, so `targetCents − liveCents` is the ledger row `setStoreStock` writes. Approval
 * gates its cause and reason checks on that delta and stores it as `varianceQty`; the detail
 * screen reads the same figure through `getStoreStocktakeById` so it asks for a cause exactly
 * where approval will. Neither may compute it any other way.
 *
 * A line's moment is its own `countFinishedAt`, falling back to the document's for a line saved
 * before the line column existed; a line with neither re-applies nothing and books
 * `counted − live`. A key with no `StoreStock` row is live `0`. One read covers every line's live
 * qty — every row of the counted items at the store — matched on `stockMatchKey`, so a line and
 * its stock row spelled in different case still meet, exactly as `setStoreStock` will find it.
 */
export async function bookedCountCents(
  tx: AnyClient,
  storeId: string,
  documentCountFinishedAt: Date | null,
  lines: BookedLine[],
): Promise<Map<string, { targetCents: number; liveCents: number }>> {
  const bookedByKey = new Map<string, { targetCents: number; liveCents: number }>();
  if (lines.length === 0) return bookedByKey;

  const momentLines: CountMomentLine[] = [];
  for (const l of lines) {
    const moment = l.lineCountFinishedAt ?? documentCountFinishedAt;
    if (moment) momentLines.push({ key: l.key, itemId: l.itemId, variantSku: l.variantSku, moment });
  }
  const sinceCentsByKey = await sumMovementsSinceCountCents(tx, storeId, momentLines);

  const itemIds = Array.from(new Set(lines.map((l) => l.itemId)));
  const liveRows = await tx.storeStock.findMany({
    where: { storeId, itemId: { in: itemIds } },
    select: { itemId: true, variantSku: true, qty: true },
  });
  const liveCentsByStockKey = new Map(liveRows.map((s) => [stockMatchKey(s.itemId, s.variantSku), Math.round(s.qty.toNumber() * 100)]));

  for (const l of lines) {
    bookedByKey.set(l.key, {
      targetCents: Math.round(l.countedQty * 100) + (sinceCentsByKey.get(l.key) ?? 0),
      liveCents: liveCentsByStockKey.get(stockMatchKey(l.itemId, l.variantSku)) ?? 0,
    });
  }
  return bookedByKey;
}
