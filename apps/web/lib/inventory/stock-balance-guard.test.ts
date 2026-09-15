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

function offendingFiles(): string[] {
  let out = "";
  try {
    out = execFileSync(
      "grep",
      ["-rlE", FORBIDDEN, "--include=*.ts", "apps/web/lib", "apps/web/app", "apps/api/src", "packages/db/src", "packages/db/prisma"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
  } catch {
    return [];
  }

  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => !f.includes(".test.ts") && !f.includes(".spec.ts"))
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
