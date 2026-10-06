import { describe, expect, it } from "vitest";
import { prisma } from "./index";

/*
 * The backfill emits one OPENING entry per LEDGER KEY, not per balance row. InventoryValue and
 * VanStock both allow a NULL-spelled and a ""-spelled row for the same item to coexist (MySQL does
 * not enforce @@unique across NULLs), and both fold into the single "" key the ledger stores, so
 * the contract under test is: at most one OPENING per key, carrying the SUM over that key's
 * bucket AS IT STOOD WHEN THE OPENING WAS WRITTEN, and none at all when that opening-time sum is
 * zero. The opening-time sum is the key's current on-hand minus the signed qty of every non-OPENING
 * ledger entry at the same location (IN positive, OUT negative, as the movers store them): stock
 * legitimately moves after the opening, so comparing it to current on-hand would fail on any bed
 * where a key moved, the freshly seeded one included.
 *
 * The upper bound is asserted as "at most one", not "exactly one", on purpose. Specs and other
 * fixtures create balance rows AFTER migrate:deploy has run, and the backfill is one-shot — those
 * rows legitimately have no OPENING entry and cannot be told apart from a genuinely dropped one
 * here. The dev seed and clone-to-local also run after migrate:deploy; they append their own
 * OPENING entries through appendSeedOpeningBalances, one per key and only for a key holding no
 * ledger entry yet, so they stay inside the bound. A duplicated key and a half-dropped bucket are
 * both still caught: the first by the count, the second because a present entry's qty must equal
 * the full bucket sum.
 */

/* Each test aggregates per bucket sequentially across the whole bed, so a cloned bed outruns vitest's 5s default. */
const SWEEP_TIMEOUT_MS = 120_000;

type Bucket = { sum: number };

async function movedSinceOpening(
  locationType: "MAIN" | "STORE" | "VAN",
  locationId: string,
  itemId: string,
  variantSku: string,
): Promise<number> {
  const moved = await prisma.stockLedgerEntry.aggregate({
    where: { type: { not: "OPENING" }, locationType, locationId, itemId, variantSku },
    _sum: { qty: true },
  });
  return Number(moved._sum.qty ?? 0);
}

function bucketise<T extends { itemId: string; variantSku: string | null }>(
  rows: T[],
  qtyOf: (row: T) => number,
  locationOf: (row: T) => string,
): Map<string, Bucket & { locationId: string; itemId: string; variantSku: string }> {
  const out = new Map<string, Bucket & { locationId: string; itemId: string; variantSku: string }>();
  for (const row of rows) {
    const locationId = locationOf(row);
    const variantSku = row.variantSku ?? "";
    const key = `${locationId}::${row.itemId}::${variantSku}`;
    const current = out.get(key) ?? { sum: 0, locationId, itemId: row.itemId, variantSku };
    current.sum += qtyOf(row);
    out.set(key, current);
  }
  return out;
}

describe("stock ledger opening backfill", () => {
  it("gives every main ledger key at most one OPENING entry carrying the whole bucket's sum", async () => {
    const balances = await prisma.inventoryValue.findMany({
      select: { itemId: true, variantSku: true, qtyOnHand: true },
    });

    const buckets = bucketise(balances, (r) => Number(r.qtyOnHand), () => "");

    for (const bucket of buckets.values()) {
      const openings = await prisma.stockLedgerEntry.findMany({
        where: {
          type: "OPENING",
          locationType: "MAIN",
          locationId: "",
          itemId: bucket.itemId,
          variantSku: bucket.variantSku,
        },
        select: { qty: true, balanceQty: true },
      });

      expect(openings.length).toBeLessThanOrEqual(1);
      if (openings.length === 0) continue;

      const atOpening =
        bucket.sum - (await movedSinceOpening("MAIN", "", bucket.itemId, bucket.variantSku));
      expect(Number(openings[0].qty)).toBeCloseTo(atOpening, 2);
      expect(Number(openings[0].balanceQty)).toBeCloseTo(atOpening, 2);
    }
  }, SWEEP_TIMEOUT_MS);

  it("writes no main OPENING entry for a ledger key whose opening-time balance is zero", async () => {
    const balances = await prisma.inventoryValue.findMany({
      select: { itemId: true, variantSku: true, qtyOnHand: true },
    });

    const buckets = bucketise(balances, (r) => Number(r.qtyOnHand), () => "");
    const zeroed: Array<{ itemId: string; variantSku: string }> = [];
    for (const b of buckets.values()) {
      const atOpening = b.sum - (await movedSinceOpening("MAIN", "", b.itemId, b.variantSku));
      if (Math.abs(atOpening) < 0.005) zeroed.push(b);
    }
    if (zeroed.length === 0) return;

    for (const bucket of zeroed) {
      const openings = await prisma.stockLedgerEntry.count({
        where: {
          type: "OPENING",
          locationType: "MAIN",
          locationId: "",
          itemId: bucket.itemId,
          variantSku: bucket.variantSku,
        },
      });

      expect(openings).toBe(0);
    }
  }, SWEEP_TIMEOUT_MS);

  it("gives every van ledger key at most one OPENING entry carrying the whole bucket's sum", async () => {
    const balances = await prisma.vanStock.findMany({
      select: { userId: true, itemId: true, variantSku: true, qty: true },
    });

    const buckets = bucketise(balances, (r) => Number(r.qty), (r) => r.userId);

    for (const bucket of buckets.values()) {
      const openings = await prisma.stockLedgerEntry.findMany({
        where: {
          type: "OPENING",
          locationType: "VAN",
          locationId: bucket.locationId,
          itemId: bucket.itemId,
          variantSku: bucket.variantSku,
        },
        select: { qty: true, balanceQty: true },
      });

      expect(openings.length).toBeLessThanOrEqual(1);
      if (openings.length === 0) continue;

      const atOpening =
        bucket.sum -
        (await movedSinceOpening("VAN", bucket.locationId, bucket.itemId, bucket.variantSku));
      expect(Number(openings[0].qty)).toBeCloseTo(atOpening, 2);
      expect(Number(openings[0].balanceQty)).toBeCloseTo(atOpening, 2);
    }
  }, SWEEP_TIMEOUT_MS);

  it("writes no van OPENING entry for a ledger key whose opening-time balance is zero", async () => {
    const balances = await prisma.vanStock.findMany({
      select: { userId: true, itemId: true, variantSku: true, qty: true },
    });

    const buckets = bucketise(balances, (r) => Number(r.qty), (r) => r.userId);
    const zeroed: Array<{ locationId: string; itemId: string; variantSku: string }> = [];
    for (const b of buckets.values()) {
      const atOpening =
        b.sum - (await movedSinceOpening("VAN", b.locationId, b.itemId, b.variantSku));
      if (Math.abs(atOpening) < 0.005) zeroed.push(b);
    }
    if (zeroed.length === 0) return;

    for (const bucket of zeroed) {
      const openings = await prisma.stockLedgerEntry.count({
        where: {
          type: "OPENING",
          locationType: "VAN",
          locationId: bucket.locationId,
          itemId: bucket.itemId,
          variantSku: bucket.variantSku,
        },
      });

      expect(openings).toBe(0);
    }
  }, SWEEP_TIMEOUT_MS);

  /*
   * StoreStock.variantSku is NOT NULL with a "" default and carries a unique key over
   * (storeId, itemId, variantSku), so its bucket is always a single row and the backfill stays
   * per-row there. The same one-entry-per-key contract is asserted anyway — that uniqueness is a
   * schema fact this test should notice losing, not an assumption it should build on.
   */
  it("gives every store ledger key at most one OPENING entry matching its balance", async () => {
    const balances = await prisma.storeStock.findMany({
      select: { storeId: true, itemId: true, variantSku: true, qty: true },
    });

    const buckets = bucketise(balances, (r) => Number(r.qty), (r) => r.storeId);

    for (const bucket of buckets.values()) {
      const openings = await prisma.stockLedgerEntry.findMany({
        where: {
          type: "OPENING",
          locationType: "STORE",
          locationId: bucket.locationId,
          itemId: bucket.itemId,
          variantSku: bucket.variantSku,
        },
        select: { qty: true, balanceQty: true },
      });

      expect(openings.length).toBeLessThanOrEqual(1);
      if (openings.length === 0) continue;

      const atOpening =
        bucket.sum -
        (await movedSinceOpening("STORE", bucket.locationId, bucket.itemId, bucket.variantSku));
      expect(Number(openings[0].qty)).toBeCloseTo(atOpening, 2);
      expect(Number(openings[0].balanceQty)).toBeCloseTo(atOpening, 2);
    }
  }, SWEEP_TIMEOUT_MS);

  it("writes no store OPENING entry for a zero opening-time balance", async () => {
    const candidates = await prisma.storeStock.findMany({
      select: { storeId: true, itemId: true, variantSku: true, qty: true },
    });
    const zeroed: Array<{ storeId: string; itemId: string; variantSku: string | null }> = [];
    for (const row of candidates) {
      const atOpening =
        Number(row.qty) - (await movedSinceOpening("STORE", row.storeId, row.itemId, row.variantSku ?? ""));
      if (Math.abs(atOpening) < 0.005) zeroed.push(row);
      if (zeroed.length >= 25) break;
    }
    if (zeroed.length === 0) return;

    for (const row of zeroed) {
      const openings = await prisma.stockLedgerEntry.count({
        where: {
          type: "OPENING",
          locationType: "STORE",
          locationId: row.storeId,
          itemId: row.itemId,
          variantSku: row.variantSku ?? "",
        },
      });

      expect(openings).toBe(0);
    }
  }, SWEEP_TIMEOUT_MS);
});
