# Inventory Extensions — edge & negative case plan

Card: [#23 Inventory Extensions](https://github.com/okejob-elorae/elorae-mini-e-procurement/issues/23) (board status "In review").
Scope per the card and its client-decision comment: consignment store as virtual warehouse (`StoreStock`), store-to-store transfer (Sales initiates, Admin Sales approves, KONSI and PUTUS allowed), location-aware movement ledger (`StockLedgerEntry`) and its read view, canvasser van stock (`VanStock` load / sale / reconcile).

Environment: local only — MariaDB test bed `:3308`, dev server `:3100`. Fixtures: `test-run/setup-inventory-ext-edge.cjs` (main stock), driver `apps/web/lib/inventory/inventory-ext-e2e.test.ts` (opt-in, `IXT_E2E=1`).

## V — Virtual warehouse (store stock)
| ID | Case | Expected |
|---|---|---|
| V-01 | Store detail stock card for a KONSI store after stock arrives | Per-variant rows with qty and movements |
| V-02 | `getStockAcrossLocations` after main→store, main→van moves | `total = main + store + van` per key; totals unchanged by moves between locations |
| V-03 | Main `available` after stock sits at a store / van | `qtyOnHand − reservedQty` on main only; store/van stock never counted |
| V-04 | PUTUS store that received a transfer — store detail page | Stock is visible somewhere (card currently renders for KONSI only) |

## T — Store-to-store transfer
| ID | Case | Expected |
|---|---|---|
| T-01 | Same source and destination | `SAME_STORE` |
| T-02 | No lines | `NO_LINES` |
| T-03 | qty 0 / negative / NaN | `BAD_QTY` |
| T-04 | movedAt > now + tolerance | `MOVED_AT_IN_FUTURE` |
| T-05 | Unknown store id | `STORE_NOT_FOUND`, nothing written |
| T-06 | Unknown item id | `ITEM_NOT_FOUND` |
| T-07 | Variant key the item does not have (bogus SKU, or `""` on a variant item) | Refused — no phantom `StoreStock` row at either store |
| T-08 | Inactive destination store | Refused (or documented as allowed) |
| T-09 | Create | PENDING, no stock or ledger moves, line `unitCost` = source avgCost snapshot |
| T-10 | Approve after the source repriced | Both legs cost at the source's CURRENT avgCost; two ledger rows per line, balances right |
| T-11 | Destination balance negative before approve | Qty moves by real balance; blend clamps negative qty to 0 |
| T-12 | Source holds less than the transfer qty | Allowed — source goes negative (no floor by design) |
| T-13 | Approve twice | `INVALID_STATE`, stock moved once |
| T-14 | Cancel an approved transfer | `INVALID_STATE` |
| T-15 | Cancel pending → approve it | Cancel writes an audit row, no ledger; later approve `INVALID_STATE` |
| T-16 | Destination approved a count of the key after movedAt | `COUNTED_SINCE_MOVE` naming the count, CAS rolled back (still PENDING) |
| T-17 | Count approved BEFORE movedAt, or one that counted a different key | Approve succeeds |
| T-18 | Store stocktake approval while a transfer of a counted key is PENDING | `TRANSFER_PENDING` |
| T-19 | KONSI → PUTUS transfer | Allowed |
| T-20 | Two lines on the same key | Moves the sum, ledger consistent |
| T-21 | Non-`stores:manage` user calls the action / opens the page | `FORBIDDEN` / no access |
| T-22 | Sales initiates a transfer from the PWA (client decision) | A Sales-facing entry point exists |

## L — Movement ledger view
| ID | Case | Expected |
|---|---|---|
| L-01 | Item moved main→store→store, main→van→sale→return | Sections per location/variant with running balance |
| L-02 | `refTypes: []`, `includeUnregistered: false` | Nothing (selected nothing ≠ no filter) |
| L-03 | Both undefined | Every row |
| L-04 | `locationTypes: ["STORE"]` / `[]` | Store rows only / nothing |
| L-05 | Date range `to` = today (WIB) | Includes rows from later today |
| L-06 | Section closing balance vs balance table | Equal for MAIN, STORE, VAN |
| L-07 | Malformed `from` string | Refused, not silently dropped |

## C — Canvasser van stock
| ID | Case | Expected |
|---|---|---|
| C-01 | Load with only qty 0 lines | `EMPTY` |
| C-02 | Load more than available (with a reservation on main) | `INSUFFICIENT_STOCK` against `onHand − reserved`, all-or-nothing |
| C-03 | Load with duplicate lines | Merged; one ledger row per location |
| C-04 | Load | Main −qty, van +qty, VAN_LOAD adjustment, ledger both sides |
| C-05 | Load a variant key the item lacks | Refused |
| C-06 | Van sale above van stock | `INSUFFICIENT_VAN_STOCK`, nothing moves |
| C-07 | Van sale of an unpriced item | `NO_PRICE` |
| C-08 | Payment below total | `INSUFFICIENT_PAYMENT` |
| C-09 | Van sale attributed to a KONSI store with markup | PUTUS price (no markup) |
| C-10 | Same idempotency key twice | Same sale, stock moved once |
| C-11 | Reconcile missing / extra / duplicate count | `COUNT_MISMATCH` |
| C-12 | Variance with no / whitespace note | `VARIANCE_NEEDS_REASON` |
| C-13 | Reconcile with shortfall | Counted back to main, van emptied, `varianceQty = expected − counted` |
| C-14 | Reconcile an empty van | `EMPTY_VAN` |
| C-15 | Count above expected (surplus) | Behaviour documented (main receives more than the van held) |
| C-16 | Non-`canvassing:manage` user opens canvassing pages | No access |

## Z — Cross-cutting
| ID | Case | Expected |
|---|---|---|
| Z-01 | Ledger last `balanceQty` equals balance table for every touched STORE / VAN key | Equal |
| Z-02 | Moving between locations conserves total across locations | Equal before/after (sales/variance excepted) |
