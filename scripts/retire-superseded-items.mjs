/**
 * Recovery script: retires superseded catalog items — unmapped items whose every variant is
 * mapped to Jubelio on another item, left behind when a later catalog ingest moved the variant
 * links. Their stock rows are governed by nothing (Jubelio's webhook sets only the new item), so
 * each qualifying item has every non-zero stock row set to 0 through `setMainStock` — one
 * `StockAdjustment` and one ledger entry per row — and is marked inactive. Items that do not
 * qualify (a variant with no mapped twin, a variantless row, an open reservation, store or van
 * stock) are listed with the reason and left untouched. See `findSupersededItems` and
 * `retireSupersededItem` in `packages/db/src/superseded-items.ts`.
 *
 * Usage on VPS — copied under /app/apps/api, not /tmp, because Node resolves `@elorae/db` by walking
 * up from the script's own location and it only resolves from inside the api package:
 *   docker compose -f docker-compose.prod.yml cp scripts/retire-superseded-items.mjs api:/app/apps/api/retire.mjs
 *   docker compose -f docker-compose.prod.yml exec -e DRY_RUN=1 api node /app/apps/api/retire.mjs
 *   docker compose -f docker-compose.prod.yml exec api node /app/apps/api/retire.mjs
 *
 * Safe to run multiple times: a row already at zero is skipped, so a replay writes nothing.
 *
 * Tunables:
 *   DRY_RUN=1       list what would be retired and what is excluded, write nothing
 */

import { findSupersededItems, prisma, retireSupersededItem } from "@elorae/db";

const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  const candidates = await findSupersededItems(prisma);
  const qualified = candidates.filter((c) => c.qualified);
  const excluded = candidates.filter((c) => !c.qualified);

  const sum = (list, pick) => list.reduce((total, c) => total + pick(c), 0);
  console.log(`Superseded candidates: ${candidates.length}  qualified: ${qualified.length}  excluded: ${excluded.length}`);
  console.log(`Qualified stock rows: ${sum(qualified, (c) => c.rows)}  non-zero: ${sum(qualified, (c) => c.nonZeroRows)}  on-hand: ${sum(qualified, (c) => c.onHand)}`);
  console.log(`DRY_RUN=${DRY_RUN ? "yes" : "no"}`);
  for (const c of qualified) {
    console.log(`  retire ${c.sku}  rows=${c.rows} non-zero=${c.nonZeroRows} on-hand=${c.onHand}  twins=${c.twinSkus.join(",")}`);
  }
  for (const c of excluded) {
    console.log(`  EXCLUDED ${c.sku}  reason=${c.reason}  rows=${c.rows} on-hand=${c.onHand}  twins=${c.twinSkus.join(",")}`);
  }

  if (DRY_RUN) {
    console.log("Dry run — no writes performed.");
    return;
  }

  let retired = 0;
  let rowsZeroed = 0;
  let refused = 0;
  let failed = 0;
  for (const c of qualified) {
    try {
      const result = await retireSupersededItem(prisma, { itemId: c.itemId, actorId: null });
      if (result.retired) {
        retired += 1;
        rowsZeroed += result.rowsZeroed;
      } else {
        /* Re-checked inside the item's own transaction: something changed since the listing. */
        refused += 1;
        console.log(`  REFUSED ${c.sku}  reason=${result.reason}`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  ${c.sku}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`Items retired: ${retired}  rows zeroed: ${rowsZeroed}  refused: ${refused}  failed: ${failed}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
