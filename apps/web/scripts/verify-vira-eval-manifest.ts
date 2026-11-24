/**
 * Confirm three VIRA eval manifest scenarios against lib/ queries.
 * Run: pnpm -F @elorae/web exec tsx scripts/verify-vira-eval-manifest.ts
 *
 * Callers: docs/VIRA_LOCAL_EVAL.md (manual). No runtime importer.
 * Reads: packages/db/prisma/vira-eval-manifest.json (id, facts.*).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFieldSalesOrders } from "@/lib/field-sales/queries";
import { listItems } from "@/lib/items/queries";
import { daftarSiklus } from "@/lib/konsinyasi/queries";

type Manifest = {
  scenarios: Array<{
    id: string;
    facts: Record<string, unknown>;
  }>;
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const manifestPath = join(
    process.cwd(),
    "..",
    "..",
    "packages",
    "db",
    "prisma",
    "vira-eval-manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const byId = new Map(manifest.scenarios.map((s) => [s.id, s]));

  {
    const sc = byId.get("fso-over-credit-limit");
    assert(sc, "missing fso-over-credit-limit");
    const orderNo = String(sc.facts.orderNo);
    const { orders } = await listFieldSalesOrders(
      { search: orderNo, status: "PENDING_APPROVAL" },
      { page: 1, pageSize: 50 },
    );
    const hit = orders.find((o) => o.orderNo === orderNo);
    assert(hit, `order ${orderNo} not listed`);
    assert(hit.creditHoldAtCreate === true, "creditHoldAtCreate expected true");
    assert(
      Number(hit.total) === Number(sc.facts.orderTotal),
      `order total ${hit.total} != ${sc.facts.orderTotal}`,
    );
    console.log("ok fso-over-credit-limit", orderNo, "total", hit.total);
  }

  {
    const sc = byId.get("items-ambiguous-search");
    assert(sc, "missing items-ambiguous-search");
    const search = String(sc.facts.search);
    const expectedSkus = sc.facts.skus as string[];
    const hasil = await listItems({ search }, { page: 1, pageSize: 50 });
    assert("items" in hasil, "listItems did not return a page");
    const skus = (hasil.items as unknown as { sku: string }[]).map((i) => i.sku).filter((s) => expectedSkus.includes(s));
    assert(
      skus.length === expectedSkus.length,
      `expected skus ${expectedSkus.join(",")} got ${skus.join(",")}`,
    );
    console.log("ok items-ambiguous-search", skus);
  }

  {
    const sc = byId.get("consignment-missing-nota");
    assert(sc, "missing consignment-missing-nota");
    const noKonsi = String(sc.facts.noKonsi);
    const rows = await daftarSiklus();
    const hit = rows.find((r) => r.noKonsi === noKonsi);
    assert(hit, `cycle ${noKonsi} not found`);
    assert(hit.noNota == null, `expected noNota null, got ${hit.noNota}`);
    assert(
      hit.periode.includes(String(sc.facts.periodYear)),
      `periode ${hit.periode} missing year ${sc.facts.periodYear}`,
    );
    console.log("ok consignment-missing-nota", noKonsi, hit.periode);
  }

  console.log("verify-vira-eval-manifest: all 3 scenarios match");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
