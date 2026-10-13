# Consignment lifecycle — edge-case and negative-case plan

Date: 2026-09-30 (plan)  
Board card: [EPIC-22: Consignment Lifecycle (#27)](https://github.com/okejob-elorae/elorae-mini-e-procurement/issues/27) — status **In review**  
Runtime target: local `apps/web` on `http://localhost:3000` against the **3308 test bed** (`elorae-dev-db`)  
Related: `test-run/README.md` + `evidence.md` (2026-08-14 happy-path smoke, order capture → approve only)

## Why this plan exists

The 2026-08-14 smoke run covered only the front of the lifecycle: salesman request → admin approve → reservation, plus two negatives (insufficient stock, reject). Everything the card now claims as done shipped after that run and has never been exercised end to end:

| Story | Shipped in | Covered by the August smoke run? |
|---|---|---|
| 22-01 store config: markup (not margin), tempo, assortment | PR #259, #324 | Margin only — markup was not in that run |
| 22-02 konsi stock arrives at store on delivery completion | virtual-warehouse branch | No |
| 22-03 admin push (never-sent + assortment gaps) | PR #327 | Suggestion panel only |
| 22-04 SPG sale + stocktake | PR #257 | No |
| 22-05 sell-through report, hold, resolve, approve | PR #319 | No |
| 22-06 invoicing, receivable, faktur, journals, void | PR #322, #326 | No |
| 22-07 admin return store → main | PR #258 | No |
| Monthly count sweep + auto report | PR #325 | No |

This plan targets the **edge and negative** paths of those surfaces. Each case names the refusal code or invariant the code is supposed to enforce, so a pass is checkable rather than "looked fine".

## Safety boundary

- Confirm `DATABASE_URL` points at `127.0.0.1:3308` before any write. **Never** run with the 3307 prod tunnel open in the same shell.
- Start `apps/web` only. No `apps/api`, no BullMQ workers, no outbox processor.
- Record `JubelioOutbox.count()` before/after each mutating case and assert **delta = 0** — except the admin push and konsi approve, which change a field-sales hold; with `JUBELIO_STOCK_PUSH_ENABLED` unset they must still enqueue nothing that reaches Jubelio.
- Use new fixture codes (`SMOKE-KLC-20260930-*`). Do not reuse `SMOKE-KONSI-*` or `SMOKE-PUTUS-*`.
- Any sweep, count or backfill invoked from a script must be scoped to the fixture store ids (`runKonsiCountSweep({ storeIds: [...] })`) — never the whole bed.

## Fixture

| Entity | Value |
|---|---|
| Store A | `SMOKE-KLC-A` — KONSI, markup 20%, tempo 30, `sellThroughMethod = SPG_POS`, geocoded |
| Store B | `SMOKE-KLC-B` — KONSI, markup 0 / null, tempo 14, `sellThroughMethod = STOCKTAKE` (whatever the non-POS method is called) |
| Store C | `SMOKE-KLC-C` — KONSI, **no** `sellThroughMethod` (checks the "not on count schedule" limit) |
| Store P | `SMOKE-KLC-P` — PUTUS (used only for refusal cases) |
| Salesman | non-system `SALESMAN` + `pwa:access`, assigned to A and B |
| SPG | SPG role user assigned to Store A only |
| Carrier | a salesman who can carry `SALESMAN_CARRY` shipments |
| Items | `KLC-SIMPLE` (simple, one `variantSku: ""` row only), `KLC-VAR` (M/L), `KLC-NOPRICE` (no selling price), `KLC-SHORT` (qty 2), `KLC-CASE` (variant `abc-01` in catalog, used for case-fold check) |

Permissions: admin wildcard for backoffice. Seed `deliveries:ship`, `deliveries:pod` (`seed-deliveries-permissions.sql`) if a non-admin actor is used. Map `TRADE_PROGRAM_EXPENSE` / konsi revenue roles only if a case says so. Cases 06-x are meant to exercise `JOURNAL_PENDING` when a role is left unmapped.

---

## 22-01 Store consignment configuration

| ID | Scenario | Expected |
|---|---|---|
| C-01 | Markup price math | Catalog 100.000, markup 20% → store price **120.000** (`netto × (1 + m)`), not 125.000 (the old margin formula) |
| C-02 | Markup bounds | Negative, non-numeric, `NaN`, above `MARKUP_PERCENT_MAX` → refused at the writer (not just the form). Call the server action directly with a bad value |
| C-03 | Markup 0 / empty | Store saves. SPG POS sells at catalog price. Sell-through still invoices (invoice never reads markup) |
| C-04 | `sellThroughMethod` on a PUTUS store | Refused by `assertValidSellThroughMethod` |
| C-05 | Switch KONSI → PUTUS while method still set | Writer refuses (never silently clears); the form normalises on submit |
| C-06 | Switch KONSI → PUTUS with a DRAFT sell-through report open | `StoreHasDraftSellThroughError` |
| C-07 | Change method while a DRAFT report exists | Report keeps its snapshot `KonsiSellThrough.method`; held lines do NOT become billable |
| C-08 | Assortment: duplicate variant line, qty target 0 / negative / decimal, unknown variant | Refused or normalised; the nullable target stays null when blank |
| C-09 | Assortment variant SKU differs only by case (`ABC-01` vs catalog `abc-01`) | Gap matches the stock row (case-folded match key) and displays the **catalog** spelling. No phantom gap |
| C-10 | Assortment gap counts in-transit | An item with an open (approved, unshipped) konsi qty shows as `inTransitQty`, **not** folded into `onHandQty`, and is not reported as a gap if in-transit covers it |

## 22-02 / 22-03 Konsi request, admin push, delivery → store stock

| ID | Scenario | Expected |
|---|---|---|
| T-01 | Admin push to PUTUS store | `NOT_KONSI` |
| T-02 | Admin push to inactive store / missing store | `STORE_INACTIVE` / `NOT_FOUND` |
| T-03 | Push with no lines, qty 0, qty 1.5, duplicate `(item, variant)` | `NO_LINES`, `BAD_QTY`, `BAD_QTY`, `DUPLICATE` |
| T-04 | Push an unknown item / variant with no inventory row | `UNKNOWN_ITEM` / `NO_INVENTORY` |
| T-05 | Push with an invalid salesman (not a salesman candidate) | `SALESMAN_INVALID` |
| T-06 | Double-submit the push form (same idempotency key) | Exactly one order; a second call replays. Same key reused for **another store** → `KEY_CONFLICT` |
| T-07 | Push more than available | Refused per variant, nothing reserved (all-or-nothing) |
| T-08 | Push only reserves | After push: `reservedQty` up, `qtyOnHand` unchanged, no `StoreStock` row, no receivable |
| T-09 | Never-sent exclusion is permanent | Item appeared on any live konsi line once → never in suggestions again, even after full return. It must still surface via an assortment gap |
| T-10 | Approve an already-APPROVED order with admin-added lines | Refused (not an idempotent `ok`) |
| T-11 | Reject after approve / approve after reject | Refused by status |
| T-12 | Two admins approve the same order concurrently | One wins; reservations counted once |
| T-13 | Pack a shipment for an order not `APPROVED` | `createDeliveryShipment` refuses |
| T-14 | Two shipments claiming the same remaining units | Second pack refused (remaining subtracts other PACKED/IN_TRANSIT `plannedQty`) |
| T-15 | Complete a KONSI shipment | Exactly one `KonsiTransfer` for **delivered** qty; `StoreStock` up; main on-hand down; reservation consumed; **no** `FieldSalesDelivery`, receivable, faktur or journal |
| T-16 | Complete with delivered < planned (partial) | Transfer and store stock for delivered qty only; remainder stays reserved/closable |
| T-17 | Complete with payload missing a line / duplicate line | `LINE_MISMATCH`, shipment not DELIVERED |
| T-18 | Complete with qty 0 on every line | Allowed. No stock moves. Shipment terminal |
| T-19 | Complete without POD photo / signature photo, or both keys equal | `MISSING_PROOF` |
| T-20 | `SALESMAN_CARRY`: completion by someone other than the carrier | `NOT_CARRIER` |
| T-21 | `SALESMAN_CARRY`: GPS null / out of radius / store not geocoded | `MISSING_GPS` / refused / `STORE_NOT_GEOCODED` (null must NOT coerce to distance 0) |
| T-22 | Same carrier retries after a lost response | `{ ok: true }`, no second transfer. Different actor → `INVALID_STATE` |
| T-23 | Main stock drops below planned between pack and complete | `MainStockNegativeError` thrown, whole completion rolled back, shipment still `IN_TRANSIT` (offline queue must treat it as terminal, not retry forever) |
| T-24 | Close remainder while a shipment is PACKED/IN_TRANSIT | `SHIPMENT_IN_FLIGHT` |
| T-25 | Surat keluar print | Prints from the `KonsiTransfer`, shows delivered qty, no prices |

## 22-04 SPG sell-through capture (POS + stocktake)

| ID | Scenario | Expected |
|---|---|---|
| S-01 | SPG sells more than store on-hand | Allowed — store balance goes negative on purpose (no floor) |
| S-02 | SPG sale total rounding | `subtotal` exact 2dp. `total` whole rupiah. The payment is compared against `total` |
| S-03 | SPG sale at Store B (not their store) / at PUTUS store | Refused / priced by real `termsType` via `spgUnitPrice` |
| S-04 | SPG sale writes no GL and no main stock | `StoreStock` down with a ledger row. `SalesHistory` demand row only. No journal |
| S-05 | Stocktake variance sign | Counted 8 vs expected 10 → `varianceQty = −2` (shortfall), NOT +2 |
| S-06 | Sale made after `countFinishedAt`, before approve | Approved balance = counted + post-count movements (the sale is not lost) |
| S-07 | Resave only a cause/reason after counting | `countFinishedAt` NOT re-stamped |
| S-08 | Approve a stocktake while a store transfer is pending | `TRANSFER_PENDING` |
| S-09 | Partial (non-full) count approved | Does not satisfy the monthly schedule |
| S-10 | Count that changes nothing (all match) | Approves. Writes no ledger rows. Report boundary falls back to `approvedAt` |

## 22-05 Sell-through report (create, hold, resolve, approve)

| ID | Scenario | Expected |
|---|---|---|
| R-01 | Create from a partial count / unapproved count | Refused by preconditions (same answer on the stocktake page's eligibility check) |
| R-02 | Create twice from the same count (two tabs) | One report. Second → `ALREADY_USED` / `DRAFT_EXISTS` (unique `stocktakeKey`/`chainKey`) |
| R-03 | Closing count earlier than the store's first ledger row | `BEFORE_LEDGER_CUTOVER` |
| R-04 | Retur raised before the count, still pending | `RETUR_IN_FLIGHT` |
| R-05 | Retur raised before the count, approved **after** it | Still `RETUR_IN_FLIGHT` (never narrowed to pending) |
| R-06 | Pending store transfer from/to the store that moved a counted key before the count moment | `TRANSFER_IN_FLIGHT`. An approved-later transfer is NOT refused |
| R-07 | SPG_POS store with POS-vs-count gap | Report is `HELD`. Approve refuses `HELD` until each gap is resolved (bill / shrinkage / bill POS / reduce) |
| R-08 | Resolve an arm that needs a reason, with no reason | Refused |
| R-09 | Stock moves after report created (new SPG sale in window) → approve | `STALE`. Remedy is cancel + recreate, never refresh in place |
| R-10 | STALE and HELD together | `STALE` reported (re-derive runs before the hold check) |
| R-11 | Store flipped to PUTUS after a DRAFT (via DB, since UI blocks it) → approve | `NOT_KONSI` |
| R-12 | Opening figures | Second report opens from the first APPROVED report's line `closingQty`, not from a ledger scan |
| R-13 | Ledger row committed late into the previous window | Carried into this report as a late movement, line flagged `hasLateMovements`, kept even if it nets to zero. Not billed twice in the report after that |
| R-14 | Unknown ledger `refType` in window (inject a row) | `UNKNOWN_REF_TYPE` on create and approve |
| R-15 | Cancel a DRAFT, then create again from the same count | Succeeds (cancel nulled both live keys) |
| R-16 | Store C (no method) | Can it create a report manually? Record the actual behaviour. The card says it is off the count schedule |
| R-17 | Each refusal copy renders in **both** locales, and on the stocktake page's create button (`storeStocktakes.detail.sellThrough.reason.*`) — no raw keys | Pass = human text everywhere |

## 22-06 Invoicing, receivable, faktur, journals, void

| ID | Scenario | Expected |
|---|---|---|
| I-01 | Invoice price basis | Line billed at **catalog** price (100.000), not store price (120.000) |
| I-02 | Billed line on `KLC-NOPRICE` | `UNPRICED`, names the product (not raw `itemId::variant`). Set price → approve again works **without** cancel |
| I-03 | No salesman / non-candidate salesman | `SALESMAN_REQUIRED` / `SALESMAN_INVALID` |
| I-04 | Invalid invoice date | `INVALID_INVOICE_DATE`. Due date = invoice date + store tempo (30 for A, 14 for B) |
| I-05 | BASELINE mode on a store's second report / without reason | `BASELINE_NOT_FIRST` / `BASELINE_REASON_REQUIRED` |
| I-06 | BASELINE on first report | Approved, bills nothing: no receivable, faktur or journal |
| I-07 | Report total = 0 (nothing sold) | Approved, no receivable/faktur created |
| I-08 | Normal invoice | One `Receivable` + one `TaxInvoice` with `sellThroughId` set and `deliveryId` null; revenue/COGS/shrinkage journals dated on invoice date |
| I-09 | Revenue role unmapped | Approve still succeeds; page shows journal-owed banner; retry after mapping posts it and banner disappears |
| I-10 | Receivable appears in salesman amplop / settlement | Reachable via report's `salesmanId`; settles through standard flow |
| I-11 | Void with empty reason / reason > 1000 chars | `VOID_REASON_REQUIRED` / detail `REASON_TOO_LONG` |
| I-12 | Void a DRAFT / already VOIDED report | `INVALID_STATE` |
| I-13 | Void when a later report exists | `HAS_SUCCESSOR` naming its docNo — voiding must go from the latest report back |
| I-14 | Void with a payment on the receivable | `HAS_PAYMENTS`. Void the payment first, then void works |
| I-15 | Void while a settlement / collection submission is pending | `SETTLEMENT_PENDING` (docNo) / `COLLECTION_PENDING` |
| I-16 | Successful void | Report `VOIDED`, receivable `VOIDED` with outstanding 0 (original kept), faktur `CANCELLED`, one audit row, mirrored reversal journals on original date, **no stock movement** |
| I-17 | Recreate from the same count after void | Works. `previousId` = the voided report's predecessor (or none) |
| I-18 | Nota print started before void, lands after | Silent no-op, no `TAX_INVOICE_PENDING` to finance |
| I-19 | Record payment against a VOIDED receivable | `ALREADY_SETTLED` |

## 22-07 Consignment stock return (admin, store → main)

| ID | Scenario | Expected |
|---|---|---|
| X-01 | Return more than store on-hand | Record the actual rule. Store balances can go negative, so verify whether the return writer caps at on-hand |
| X-02 | Receive with count 0 on every line (lost sack) | Allowed |
| X-03 | Receive less than raised (variance) | Variance direction enforced in writer, not only UI |
| X-04 | Between raise and receipt | Store card shows the overstatement note (known limit) |
| X-05 | Count/report while return is in flight | `RETUR_IN_FLIGHT` (ties to R-04/R-05) |
| X-06 | ADMIN-origin return without nota photo / transport | Allowed. The same omission on a FIELD-origin return is refused |
| X-07 | Main stock after receipt | `InventoryValue` up with a ledger row; store ledger out |

## Monthly count sweep + auto report

Run via script with `storeIds: [A, B, C]` and an injected `now`/`schedule`. Never write the `SystemSetting` rows.

| ID | Scenario | Expected |
|---|---|---|
| M-01 | Sweep before window opens | Target = previous month; no new count if previous month credited |
| M-02 | Sweep inside window, store not counted | Opens one full count, pushes SPG, writes `KONSI_COUNT_DUE` **last** |
| M-03 | Sweep again same month | Opens nothing (DUE row present) even if count was cancelled |
| M-04 | Count opened manually before sweep | Sweep announces it instead of opening a second |
| M-05 | Count finished before target window, approved after | Credits previous slot; sweep does not announce it; next sweep opens a fresh one |
| M-06 | Store created after target `openFrom` | `NOT_YET` |
| M-07 | Store C (no method) | Skipped by sweep (documented limit) |
| M-08 | `storeIds: []` | Sweeps nothing (never widened to all) |
| M-09 | Month edge in WIB: count finished 30 Sep 23:30 WIB (= 16:30 UTC) | Credits September, not October, on a UTC host |
| M-10 | Stocktake approve → auto report | READY / HELD / BLOCKED announced; a report failure never fails the approval |
| M-11 | Sweep-created count with several SPGs | `createdById = system:konsi-count`, detail page shows "System" without crashing |

## Cross-cutting

| ID | Scenario | Expected |
|---|---|---|
| Z-01 | Invariant after every case | Store on-hand = transferred in − SPG sold − returned out ± approved count correction (sum of store `StockLedgerEntry`) |
| Z-02 | No receivable at transfer | After T-15, zero `Receivable` rows for the store until I-08 |
| Z-03 | Permission boundaries | SPG cannot reach backoffice. Salesman cannot approve/void. ADMIN is redirected away from `/pwa` (test PWA with non-admin accounts) |
| Z-04 | Direct server-action calls | Every refusal above that is "UI hides the button" must also refuse when the action is called directly |
| Z-05 | Offline PWA replay (SPG sale, completion queue) | Terminal errors discarded, `FORBIDDEN`/`UNEXPECTED` on completion queue retried up to `MAX_RETRY_ATTEMPTS` |
| Z-06 | Outbox delta | 0 across the whole session |

## Execution order

1. Reality check: 3308 bed, port 3000 owner, outbox baseline, permission seeds.
2. Seed fixture script (new, `test-run/setup-konsi-lifecycle-edge.cjs`), scoped ids only.
3. Config (C-*) → push/delivery (T-*) → SPG + stocktake (S-*) → report (R-*) → invoice/void (I-*) → return (X-*) → sweep (M-*).
4. Z-01 invariant snapshot after each group.
5. Evidence in `test-run/konsi-lifecycle-edge-evidence.md`, screenshots in `test-run/screenshots/konsi-lifecycle/`.

Cases that need concurrency or injected rows (T-06, T-12, R-02, R-11, R-13, R-14, I-18, M-*) are script- or spec-driven rather than browser-driven. Mark them `SCRIPT` in evidence.

## Pass / fail

- **Fail** (blocks moving the card out of In review): any receivable/journal at transfer time; invoice billed at store (marked-up) price; a report approvable while HELD/STALE/retur-in-flight; void leaving a live key or moving stock; double transfer on retry; sweep touching non-fixture stores; Z-01 invariant broken.
- **Known limits, not failures**: admin-return overstatement window (X-04), Store C off schedule (M-07), no GL journal on konsi transfer, one-level-deep late-movement carry.
