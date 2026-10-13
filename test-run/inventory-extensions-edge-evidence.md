# Inventory Extensions — edge & negative case evidence

Card: [#23 Inventory Extensions](https://github.com/okejob-elorae/elorae-mini-e-procurement/issues/23). Plan: `test-run/inventory-extensions-edge-plan.md`.

Environment: local MariaDB test bed `:3308` (migrations current), dev server `:3100`. Fixtures `test-run/setup-inventory-ext-edge.cjs`; driver `apps/web/lib/inventory/inventory-ext-e2e.test.ts` (opt-in, `IXT_E2E=1`), last run `munsnanm` — 9/9 tests green, raw log `test-run/ixt-run.log`.

## Result summary

| Area | Cases | Result |
|---|---|---|
| Store-to-store transfer (T) | T-01..T-20 | All PASS after the `BAD_VARIANT` fix; T-08 NOTE |
| Transfer access (T-21) | SPG opens store-transfers / new | Bounced to "No access" (browser) |
| Sales entry point (T-22) | PWA | NOT PRESENT — backoffice only |
| Virtual warehouse (V) | V-01..V-03 | PASS (V-01 in browser: stock card with "Lokasi lain" gudang/van figures) |
| PUTUS store stock (V-04) | Store page | NOTE — not shown |
| Movement ledger (L) | L-01..L-06 | PASS; L-07 NOTE |
| Van stock (C) | C-01..C-14, C-16 | PASS; C-15 NOTE |
| Cross-cutting (Z) | Z-01, Z-02 | PASS (ledger last balance = balance table for 7 store + 3 van keys; total 664 conserved across the load) |

## Bug found and fixed

**T-07 — a store transfer line could name a variant the item does not stock.** `createStoreTransfer` accepted `V-XXL` on a variant item, `""` on a variant item and `V-M` on a simple item; approval then created a destination `StoreStock` row under a key no stock can exist at (source going negative on a phantom row). Fix: the writer refuses `BAD_VARIANT` unless the key is stockable for the item (`isStockableVariantKey`) OR the source store already holds a row under it — so legacy stock under a key the item no longer lists stays transferable. Copy added in both locales. Regression tests in `lib/stores/transfer/writer.test.ts`; one sell-through spec that transferred an unheld, unlisted key now seeds a zero source row.

## Findings logged to `docs/FOLLOWUPS.md` (not fixed — need a decision)

- T-08: inactive destination store accepted; the form lists inactive stores.
- T-22: no PWA/Sales entry point for store transfers although the client decided Sales initiates.
- V-04: `StoreStock` at a PUTUS store is invisible on the store page (PUTUS pricing still an open client question).
- C-15: van reconcile surplus returns more to main than the van held (only the variance note guards it).
- L-07: a malformed movement-card date is silently dropped instead of refused.

## Verification

- `lib/stores/transfer` (33), `lib/konsi-sell-through/writer`, `stock-balance-guard`, `reconciliation-runner` (29) — green.
- Scoped run over `lib/canvassing lib/inventory lib/stores lib/items/variants app/actions/stock-card` — green once the local environment was current (the guard needs Git's `grep` on PATH on Windows; `reconciliation-runner` needed the upstream migration applied and `@elorae/db` rebuilt).
