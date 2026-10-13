/**
 * Opening stock adjustments for materials the legacy workbook used without ever recording their
 * purchase (#438). The workbook's own stock card (`KARTU STOK PERBULAN`) runs these below zero;
 * the ERP refuses a negative main balance, so the unrecorded quantity is added as one positive
 * adjustment dated before the workbook's first movement. Once every usage line is replayed, each
 * balance ends at 0 — the workbook's figure plus exactly the unrecorded quantity.
 *
 * Writes what `createStockAdjustment` writes (StockAdjustment, `moveMainStock` at the current
 * average cost, AuditLog) without the PIN prompt. `reason` is VARCHAR(191), so the full explanation
 * (`detail`) goes into the audit log entry. Idempotent on `idempotencyKey`. On prod, run it
 * BEFORE `legacy:grn` and the usage import: the ledger balance it records is the balance at write
 * time, and no replayed issue may meet an empty balance.
 *
 * Usage (from apps/web):
 *   pnpm legacy:opening                                                   # dry-run
 *   pnpm legacy:opening -- --apply --actor admin@elorae.com               # local testbed (:3308)
 *   pnpm legacy:opening -- --apply --actor <email> --confirm-prod-writes  # prod tunnel
 */
import "dotenv/config";
import { Decimal } from "decimal.js";
import { findExistingInventoryValueRow } from "../lib/inventory/costing";

/** 2024-07-31 WIB midnight: the day before the workbook's first movement (BELI, 2024-08-01). */
const OPENING_AT = new Date("2024-07-30T17:00:00.000Z");

const ADJUSTMENTS = [
  {
    sku: "BARCODE",
    qty: 130_419,
    reason:
      "Saldo awal impor data lama #438: BARCODE dipakai 130.419 pcs (Agu 2024-Jul 2026) tanpa pembelian tercatat di workbook; kartu stok -130.419. Nilai HPP Rp 43/pcs.",
    detail:
      "Saldo awal impor data lama (#438). Workbook PRODUKSI ELORAE LAURA.xlsx, sheet KARTU STOK PERBULAN: " +
      "BARCODE dipakai 130.419 pcs (Agu 2024 – Jul 2026) tetapi tidak pernah ada pembelian yang tercatat " +
      "(sheet BELI tidak memuat BARCODE), sehingga kartu stok berakhir di -130.419. Barcode dicetak/dibeli di " +
      "luar workbook. Penyesuaian ini menambahkan 130.419 pcs yang tidak tercatat sebelum mutasi pertama, agar " +
      "riwayat yang diimpor tidak pernah minus; setelah seluruh pemakaian diimpor, saldo berakhir 0 " +
      "(= saldo workbook -130.419 + 130.419). Nilai: HPP MASTER Rp 43/pcs.",
  },
  {
    sku: "PLASTIK",
    qty: 52_522,
    reason:
      "Saldo awal impor data lama #438: PLASTIK dibeli 2.042 pcs, dipakai 54.564 pcs (Agu 2024-Agu 2025); kartu stok -52.522, sisanya dibeli di luar workbook. Nilai Rp 387/pcs.",
    detail:
      "Saldo awal impor data lama (#438). Workbook PRODUKSI ELORAE LAURA.xlsx, sheet KARTU STOK PERBULAN: " +
      "PLASTIK (plastik OPP) hanya tercatat dibeli 2.042 pcs (nota 3, SSG, Agu 2024) sedangkan pemakaiannya " +
      "54.564 pcs (Agu 2024 – Agu 2025), sehingga kartu stok berakhir di -52.522. Sisanya dibeli di luar " +
      "workbook. Penyesuaian ini menambahkan 52.522 pcs yang tidak tercatat sebelum mutasi pertama, agar " +
      "riwayat yang diimpor tidak pernah minus; setelah seluruh pemakaian diimpor, saldo berakhir 0 " +
      "(= saldo workbook -52.522 + 52.522). Nilai: harga beli Rp 387/pcs.",
  },
] as const;

const keyFor = (sku: string) => `legacy-438-opening-${sku}`;

function assertApplyAllowed(url: string, confirm: boolean): void {
  if (/:3308(\/|$)/.test(url)) return;
  if (!confirm) throw new Error("Refusing --apply: not local testbed (:3308). Pass --confirm-prod-writes.");
  console.warn("WARNING: writing legacy opening adjustments against a non-testbed DATABASE_URL.");
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  if (apply) assertApplyAllowed(url, argv.includes("--confirm-prod-writes"));

  const { prisma, moveMainStock } = await import("@elorae/db");
  try {
    const actorAt = argv.indexOf("--actor");
    const actorEmail = actorAt >= 0 ? argv[actorAt + 1] : undefined;
    const actor = actorEmail ? await prisma.user.findUnique({ where: { email: actorEmail }, select: { id: true } }) : null;
    if (apply && !actor) throw new Error("--apply needs --actor <email> of an existing user");

    console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"} | dated ${OPENING_AT.toISOString()}`);
    for (const adj of ADJUSTMENTS) {
      const item = await prisma.item.findUnique({ where: { sku: adj.sku }, select: { id: true } });
      if (!item) throw new Error(`Item ${adj.sku} not found`);
      if (await prisma.stockAdjustment.findUnique({ where: { idempotencyKey: keyFor(adj.sku) } })) {
        console.log(`${adj.sku}: already adjusted, skipped`);
        continue;
      }
      const row = await findExistingInventoryValueRow(prisma, item.id, null);
      if (!row) throw new Error(`${adj.sku} has no InventoryValue row`);
      const prevQty = new Decimal(row.qtyOnHand.toString());
      const avg = new Decimal(row.avgCost.toString());
      const newQty = prevQty.plus(adj.qty);
      console.log(`${adj.sku}: +${adj.qty} at ${avg} → ${prevQty} → ${newQty} (value Rp ${avg.mul(adj.qty).toFixed(0)})`);
      if (!apply) continue;

      await prisma.$transaction(async (tx) => {
        const adjustment = await tx.stockAdjustment.create({
          data: {
            docNumber: `LEG-ADJ-${adj.sku}`,
            itemId: item.id,
            type: "POSITIVE",
            qtyChange: adj.qty,
            reason: adj.reason,
            prevQty: prevQty.toNumber(),
            newQty: newQty.toNumber(),
            prevAvgCost: avg.toNumber(),
            newAvgCost: avg.toNumber(),
            approvedById: actor!.id,
            createdById: actor!.id,
            source: "ERP",
            idempotencyKey: keyFor(adj.sku),
            createdAt: OPENING_AT,
          },
        });
        const newValue = newQty.mul(avg).toNumber();
        await moveMainStock(tx, {
          itemId: item.id,
          variantSku: null,
          qtyDelta: adj.qty,
          totalValue: newValue,
          unitCost: avg.toNumber(),
          totalCost: avg.mul(adj.qty).toNumber(),
          balanceValue: newValue,
          inventoryValueId: row.id,
          refType: "StockAdjustment",
          refId: adjustment.id,
          refDocNumber: adjustment.docNumber,
          createdById: actor!.id,
          occurredAt: OPENING_AT,
        });
        await tx.auditLog.create({
          data: {
            userId: actor!.id,
            action: "STOCK_ADJUSTMENT",
            entityType: "StockAdjustment",
            entityId: adjustment.id,
            changes: {
              before: { qty: prevQty.toString(), value: prevQty.mul(avg).toString() },
              after: { qty: newQty.toString(), value: String(newValue) },
              reason: adj.reason,
              detail: adj.detail,
              type: "POSITIVE",
            },
          },
        });
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
