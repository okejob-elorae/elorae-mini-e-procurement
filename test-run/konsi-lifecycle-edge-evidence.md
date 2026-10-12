# Consignment lifecycle — edge/negative case evidence

Plan: `test-run/konsi-lifecycle-edge-plan.md` (board card #27, Consignment Lifecycle).
Run date: 2026-09-30. Environment: local only — `apps/web` dev server on http://localhost:3100 against the MariaDB test bed `elorae-dev-db` on **3308**. Prod (3307) was never touched.

## Setup

- `docker compose -f docker-compose.dev.yml up -d db redis`, `pnpm -F @elorae/db migrate:deploy` against 3308.
- Permission seeds hand-applied to the local bed (the deploy never seeds): `seed-settlements-permission.sql`, `seed-deliveries-permissions.sql`. Without the first, the konsi push page's salesman list is empty and report creation refuses `SALESMAN_INVALID`.
- Fixtures: `node test-run/setup-konsi-lifecycle-edge.cjs` (refuses unless `DATABASE_URL` is on 3308). Stores `SMOKE-KLC-A/B/C/P`, items `KLC-SIMPLE/VAR/NOPRICE/SHORT/NEVER`.
- End-to-end driver: `apps/web/lib/konsi-sell-through/lifecycle-klc.test.ts`, opt-in only:
  `$env:KLC_E2E="1"; pnpm -F @elorae/web exec vitest run lifecycle-klc`. Each run clones a fresh store A (`SMOKE-KLC-A-<run>`) so reruns don't collide.

## Results

### Existing specs
45 konsi-related spec files, 799 tests — all green on 3308 (`--no-file-parallelism`).

### Driver (all 34 records PASS)
| Area | Cases |
|---|---|
| Push / shipment | T-01, T-06, T-07 (OVER_PLANNED double-claim), T-08 (INSUFFICIENT_STOCK rolls back), T-14, T-15/16 (same-actor replay), T-22, T-23 |
| SPG sale | S-01 (catalog × 1.2 = 120 000), S-02/C-01, S-04 (oversell to −1), S-05 (main stock untouched) |
| Stocktake | Z-02, shortfall requires cause (`SHORTFALL_NEEDS_CAUSE`), variance sign = counted − expected |
| Report | R-02 ALREADY_USED, R-07 HELD, R-08 REASON_REQUIRED, SALESMAN_REQUIRED/INVALID, INVALID_INVOICE_DATE |
| Invoice | I-01 catalog price (not markup), I-03 due = invoice + tempo, I-04 receivable 910 000 + faktur |
| Void | I-08 VOID_REASON_REQUIRED, I-11 double void INVALID_STATE, I-12 receivable VOIDED / faktur CANCELLED / keys nulled / no stock or ledger change, I-16/I-17 recreate + approve |
| Retur | X-06 FIELD-origin without photo refused, R-04/X-05 RETUR_IN_FLIGHT |
| Ledger | Z-01 StoreStock == sum of STORE ledger rows per key |
| Count sweep | M-03 NOT_YET, M-06 `storeIds: []` sweeps nothing, M-08 opens with System creator, M-11 idempotent second sweep |

### Browser checks (PASS)
- Store form markup/catalog-billing help text (C-02 behaviour itself verified via spec — `browser_fill` doesn't drive React state there).
- Approved and voided report detail pages; RETUR_IN_FLIGHT reason copy on the stocktake page; "Dibuka Oleh: Sistem" on the sweep count.
- PUTUS store's konsi-push page 404s; never-sent list correct, submit disabled with nothing selected.
- SPG PWA: `/pwa/spg/sale` redirects to `/pwa` until check-in; after check-in KLC-SIMPLE shows Rp 120.000, KLC-VAR Rp 180.000, KLC-NOPRICE "Harga belum diset" with no add button. Store stock shown matches the ledger (KLC-NEVER: +3 transfer, −4 oversell, stocktake set to 0).
- Z-03: SPG opening `/backoffice/konsi-sell-through` is bounced to the backoffice "No access" page.

## Bug fixed

- **`isInvoiceDateAllowed` threw `RangeError` on an invalid `Date`** (`formatDateOnlyJakarta` → `Intl` on `NaN`). The action layer validates `YYYY-MM-DD` strictly, so only a direct writer caller could reach it, but the writer should refuse with `INVALID_INVOICE_DATE`, not crash. Fixed with a `Number.isFinite(getTime())` guard; regression test added in `invoice-dates.test.ts` (6/6 green).
- Stale doc comment on `approveSellThrough` (said "store's price"; it bills the catalog price).

## Findings not fixed (minor / for triage)

1. Indonesian `readOnlyNote` wording on the report detail ("sudah tidak berjalan lagi") reads awkwardly.
2. A voided report still offers "Buat laporan pengganti" after a replacement already exists.
3. The konsi push page offers an unpriced item (KLC-NOPRICE) with no warning; it will later hold the report at `UNPRICED`.
4. A SHELF_COUNT store's count page shows an SPG-flow hint.
5. The push page's salesman list is silently empty in any environment without the `settlements:submit` seed.
6. The journal-pending banner appears locally because konsi posting roles are unmapped — expected on a fresh bed, not a bug.
7. `apps/web/app/backoffice/page.tsx` "No access" message is hard-coded English (not localized) — pre-existing, unrelated to konsi.
8. Dashboard activity feed shows raw audit codes (e.g. `KonsiSellThrough: KONSI_SELL_THROUGH_VOID`) — pre-existing generic formatting.

## Leftovers on the local bed

Fixture stores `SMOKE-KLC-*` (including one `SMOKE-KLC-A-<run>` / `SMOKE-KLC-B-<run>` per driver run) with their orders, shipments, transfers, stocktakes, reports, receivables and fakturs. `spg@elorae.com` is currently assigned to the latest run store (`SMOKE-KLC-A-munqmd9y`) with an open visit.
