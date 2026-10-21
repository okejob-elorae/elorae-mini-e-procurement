import { takeUnitsBySalesman, type SpgPosQty } from "./compute";

/**
 * The per-SPG split weights of a konsi sell-through report's lines, from the SpgSale ledger rows of
 * its window and of its previous report's window. One spelling, two callers: approve
 * (`approveSellThrough`, `lib/konsi-sell-through/writer.ts`) runs it once inside its own
 * transaction and stores the result as `KonsiSellThroughSpgShare` rows, and `getCommissionRecap`
 * (`queries.ts`) runs it live only for a report approved before those rows existed.
 *
 * Client-safe and import-free apart from `./compute`. The rows and lines are plain values; the
 * callers load them and resolve each sale to its SPG.
 *
 * - A line's OWN share is the first `posSoldQty − latePosSoldQty` units of the SpgSale rows in its
 *   window, in ledger order (`createdAt`, then id, as `loadSellThroughInputs` returns them).
 * - Its LATE share (`latePosSoldQty`, carried from the previous report P) depends on whether P's
 *   own split was snapshotted. If it was, the late share is, per SPG, P's window's sale units NOW
 *   minus P's snapshotted OWN units: exactly the units that reached P's window after P approved,
 *   credited to whoever sold them. If it was not (P approved before snapshots existed), it is the
 *   units right after P's own share in P's window — the next `latePosSoldQty` units after P's first
 *   `posSoldQty − latePosSoldQty` — which is an attribution, not a fact, since a late row has no
 *   identity of its own and may sort before the rows P counted.
 *
 * The positional cut must never be applied against a SNAPSHOTTED P: P's own share is then frozen
 * from the rows P saw, while the cut re-reads the rows as they stand now, so a late row sorting
 * among P's counted ones would hand one SPG's unit to another — counted twice for one, never for
 * the other. At approve the own share is exact: the STALE check has just proved the window derives
 * to the stored figures, so the window's sale units are exactly the ones the report counted.
 */

export type SplitLedgerRow = { itemId: string; variantSku: string; qty: number; refType: string; refId: string };

export type SplitLine = { itemId: string; variantSku: string; posSoldQty: number; latePosSoldQty: number };

export type LineSplitWeights = { itemId: string; variantSku: string; own: SpgPosQty[]; late: SpgPosQty[] };

/* One stored OWN share row of the previous report's snapshot. */
export type SnapshotShare = { itemId: string; variantSku: string; salesmanId: string; units: number };

const lineKey = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;

/* A POS sale's store row is negative; anything else in a window is not a sale. */
const isSaleRow = (row: SplitLedgerRow) => row.refType === "SpgSale" && row.qty < 0;

/* The units a line's own window contributed to its stored POS figure: the total minus what it carried in as late. */
const ownPosUnits = (line: SplitLine) => Math.max(0, Math.round(line.posSoldQty - line.latePosSoldQty));

/* Every SpgSale id the given windows' sale rows name, once each, in first-seen order — the ids a caller resolves to SPGs. */
export function spgSaleIdsOf(...rowSets: ReadonlyArray<readonly SplitLedgerRow[]>): string[] {
  const ids = new Set<string>();
  for (const rows of rowSets) for (const row of rows) if (isSaleRow(row)) ids.add(row.refId);
  return Array.from(ids);
}

/* Per SPG, the sale units of `rows` beyond what `taken` already holds, only where positive. Ordered by salesman id. */
function unitsBeyond(rows: ReadonlyArray<{ salesmanId: string | null; units: number }>, taken: readonly SnapshotShare[]): SpgPosQty[] {
  const bySalesman = new Map<string, number>();
  for (const row of rows) {
    if (row.salesmanId === null) continue;
    bySalesman.set(row.salesmanId, (bySalesman.get(row.salesmanId) ?? 0) + Math.max(0, row.units));
  }
  for (const share of taken) bySalesman.set(share.salesmanId, (bySalesman.get(share.salesmanId) ?? 0) - share.units);
  return Array.from(bySalesman, ([salesmanId, qty]) => ({ salesmanId, qty: Math.round(qty * 100) / 100 }))
    .filter((q) => q.qty > 0)
    .sort((a, b) => (a.salesmanId === b.salesmanId ? 0 : a.salesmanId < b.salesmanId ? -1 : 1));
}

/**
 * The OWN and LATE split weights of every line, in line order. `previousRows` and `previousLines`
 * are the previous report's window rows and stored lines, empty for a store's first report; they
 * are read only for a line with `latePosSoldQty` above zero. `previousOwnShares` is the previous
 * report's snapshotted OWN rows — `[]` when it was snapshotted with none — or `null` when it was
 * never snapshotted, which selects the positional cut (see the module comment). A sale missing from
 * `salesmanBySale` weighs for no SPG; in the positional cut it still takes its positions (see
 * `takeUnitsBySalesman`).
 */
export function perSpgPosQtyForLines(input: {
  lines: readonly SplitLine[];
  ownRows: readonly SplitLedgerRow[];
  previousRows: readonly SplitLedgerRow[];
  previousLines: readonly SplitLine[];
  previousOwnShares?: readonly SnapshotShare[] | null;
  salesmanBySale: ReadonlyMap<string, string>;
}): LineSplitWeights[] {
  const unitsByKey = (rows: readonly SplitLedgerRow[]) => {
    const byKey = new Map<string, Array<{ salesmanId: string | null; units: number }>>();
    for (const row of rows) {
      if (!isSaleRow(row)) continue;
      const key = lineKey(row.itemId, row.variantSku);
      const list = byKey.get(key) ?? [];
      list.push({ salesmanId: input.salesmanBySale.get(row.refId) ?? null, units: -row.qty });
      byKey.set(key, list);
    }
    return byKey;
  };

  const ownUnits = unitsByKey(input.ownRows);
  const lateUnits = unitsByKey(input.previousRows);
  const previousLines = new Map(input.previousLines.map((l) => [lineKey(l.itemId, l.variantSku), l]));
  const previousOwn = input.previousOwnShares ?? null;
  const previousOwnByKey = new Map<string, SnapshotShare[]>();
  for (const share of previousOwn ?? []) {
    const key = lineKey(share.itemId, share.variantSku);
    previousOwnByKey.set(key, [...(previousOwnByKey.get(key) ?? []), share]);
  }

  return input.lines.map((l) => {
    const key = lineKey(l.itemId, l.variantSku);
    const own = takeUnitsBySalesman(ownUnits.get(key) ?? [], 0, ownPosUnits(l));
    const latePieces = Math.round(l.latePosSoldQty);
    let late: SpgPosQty[] = [];
    if (latePieces > 0 && previousOwn !== null) {
      late = unitsBeyond(lateUnits.get(key) ?? [], previousOwnByKey.get(key) ?? []);
    } else if (latePieces > 0) {
      const previousLine = previousLines.get(key);
      const skip = previousLine ? ownPosUnits(previousLine) : 0;
      late = takeUnitsBySalesman(lateUnits.get(key) ?? [], skip, latePieces);
    }
    return { itemId: l.itemId, variantSku: l.variantSku, own, late };
  });
}
