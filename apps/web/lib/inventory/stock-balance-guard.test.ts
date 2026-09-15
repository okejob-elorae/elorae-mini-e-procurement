import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

/*
 * Files allowed to mutate a stock balance table directly. Everything else must go through the
 * movers in packages/db/src/stock-balance.ts, which append a ledger entry in the same
 * transaction.
 *
 * reservation-writer.ts is the one real exception: its raw guarded UPDATE is the cross-process
 * race guard and cannot be expressed as a Prisma update, so it calls appendStockLedger directly.
 *
 * opname-snapshot.ts provisions an InventoryValue row that does not yet exist and appends an
 * OPENING entry for it, so its create is allowed while its quantity changes go through setMainStock.
 * costing.ts was checked and no longer creates a row directly, so it is not on this list.
 *
 * konsi-transfer/writer.ts's direct inventoryValue.update touches reservedQty only, immediately
 * after moveMainStock has already moved qtyOnHand (and written the ledger entry) on the same row
 * id — a reservation resolving is not a stock movement, same reasoning as reservation-writer.ts's
 * own reservedQty writes.
 *
 * umkm-opening-stock.ts's inventoryValue.createMany provisions a row at qtyOnHand: 0 so the
 * lookup right after it can resolve an id to pass into moveMainStock, which does the real qty
 * move and writes the ledger entry. Same shape as opname-snapshot.ts, items/mutations.ts and
 * catalog-sync.service.ts below.
 *
 * backfill-reservations.ts writes a real qtyOnHand value with NO ledger append — correct only
 * because it is a SPENT one-off cutover script that predates the ledger entirely. It must never
 * be re-run now the ledger exists (it would move real stock with no ledger entry to show for it),
 * and it is not a pattern to copy: a live writer touching qtyOnHand without appending is exactly
 * the drift this whole file exists to catch.
 *
 * The rest are row provisioning (a create at qty 0 moves nothing), fixtures, and one-off scripts.
 */
const ALLOWED = [
  "packages/db/src/stock-balance.ts",
  "packages/db/src/reservation-writer.ts",
  "apps/web/lib/inventory/opname-snapshot.ts",
  "apps/web/lib/items/mutations.ts",
  "apps/web/lib/field-sales/konsi-transfer/writer.ts",
  "apps/web/lib/reconciliation/umkm-opening-stock.ts",
  "apps/api/src/jubelio/catalog/catalog-sync.service.ts",
  "packages/db/prisma/seed.ts",
  "packages/db/prisma/clone-to-local.ts",
  "packages/db/prisma/backfill-reservations.ts",
];

const FORBIDDEN = String.raw`(inventoryValue|storeStock|vanStock)\.(update|upsert|create|updateMany|createMany)`;

/*
 * This guard sees ONLY Prisma model calls matched by the regex above — it cannot see raw SQL.
 * reservation-writer.ts itself carries three raw guarded UPDATEs (its cross-process race guards).
 * TWO of them touch InventoryValue — one moves qtyOnHand (and appends a ledger entry by hand), one
 * moves only reservedQty (and appends nothing) — and the third updates StockReservation, which is
 * not a balance table. None of the three is visible to this test at all, matched or not.
 * A new file that reaches for tx.$executeRaw/tx.$queryRaw to touch InventoryValue, StoreStock or
 * VanStock is therefore completely invisible here, whether or not it appends to the ledger.
 *
 * Do not try to extend FORBIDDEN to catch raw SQL — a pattern broad enough to match arbitrary SQL
 * text is brittle and will false-positive on SQL that never touches a balance table. Instead: a
 * new raw-SQL balance write must append to the ledger by hand at the call site (the way
 * reservation-writer.ts's own qtyOnHand-moving $executeRaw does), and the file must be added to
 * ALLOWED above deliberately, with the same reasoning documented as every other entry — never
 * silently, and never assumed covered by this test just because it passes.
 */

function offendingFiles(): string[] {
  let out = "";
  try {
    out = execFileSync(
      "grep",
      ["-rlE", FORBIDDEN, "--include=*.ts", "apps/web/lib", "apps/web/app", "apps/api/src", "packages/db/src", "packages/db/prisma"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
  } catch (err) {
    /*
     * grep exits 1 for "no matches" — the expected, healthy outcome — and a different nonzero
     * status (2+) for a real error, e.g. a search root that does not exist. Swallowing both
     * identically makes the guard fail OPEN: renaming or moving any of the five roots above would
     * silently report zero offending files forever, with the suite still green. Only status 1
     * means "nothing found"; anything else must fail loudly instead of manufacturing a false pass.
     */
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }

  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => !f.includes(".test.ts") && !f.includes(".spec.ts"))
    /* Defensive, not currently load-bearing: neither path is reachable from the five grep roots
       above (apps/web/scripts and any generated/ directory both sit outside them), so both
       filters are no-ops today. Left in in case a root above ever widens to include either. */
    .filter((f) => !f.startsWith("apps/web/scripts/"))
    .filter((f) => !f.includes("/generated/"))
    .filter((f) => !ALLOWED.includes(f));
}

describe("stock balance write guard", () => {
  it("has no direct balance-table writes outside the movers and the documented exceptions", () => {
    expect(offendingFiles()).toEqual([]);
  });

  it("keeps the raw guarded update in the reservation writer appending to the ledger", () => {
    const src = readFileSync(join(REPO_ROOT, "packages/db/src/reservation-writer.ts"), "utf8");
    expect(src).toContain("appendStockLedger");
  });
});
