# Putus (cash/transfer) field-sales smoke test

Date: 2026-08-14 (plan)  
Runtime target: local `apps/web` on `http://localhost:3000` against local DB  
Related: consignment plan remains in `test-run/README.md` — **do not reuse its store, products, visits, or screenshots as PUTUS evidence**

## User story

As a field salesman visiting a putus store, I can check in, see priced catalog stock, build an order that meets the minimum quantity, and submit it so stock is reserved. An authorized backoffice user can approve (paperwork only), then record one or more deliveries that consume stock, write sales history, and open a tax-invoice queue row — without any Jubelio mutation.

## Safety boundary

- Local DB mutations are allowed.
- No operation may call or mutate production Jubelio.
- The smoke runtime starts **`apps/web` only**; do **not** start `apps/api`, BullMQ workers, or the Jubelio outbox processor.
- Fixtures are inserted directly into local DB and must not create `JubelioOutbox` rows.
- Do not use catalog sync, product push, stock adjustment UI against Jubelio-linked flows, fulfillment, marketplace orders, or any Jubelio menu action.
- PUTUS create / approve / deliver / reject / close-remainder is ERP-local in the current implementation (field-sales orders, reservations, inventory aggregates, stock adjustments with `FIELD_SALES_CONSUME`, `SalesHistory`, `TaxInvoice`, notifications).
- Before and after each mutating case, record `JubelioOutbox.count()` and assert **delta = 0** (compare delta, not absolute count — a pre-existing outbox row may already exist).

## Environment prerequisites

- Confirm which process owns port 3000 (main repo vs prior smoke worktree) before browser steps.
- Schema must include field-sales delivery + `FieldSalesOrderLine.addedById` and tax-invoice tables. If a MariaDB-only migration fails on local MySQL, document the detour; do not invent schema.
- Backoffice actor: system admin (wildcard) **or** a user with `field_sales_orders:view` + `field_sales_orders:approve` + `field_sales_orders:deliver`. If deliver is missing locally, apply `packages/db/prisma/seed-field-sales-delivery-permissions.sql` (or equivalent) before delivery cases.
- Optional finance actor for P-12: `tax_invoices:view` / `tax_invoices:manage` (admin wildcard is enough).
- Prefer running against a **known git revision** (document SHA in evidence). Uncommitted F-02/F-03/picker patches do not change PUTUS behavior; still record the revision under test.

## Fixture

Seed via a dedicated script (mirror `setup-consignment-smoke.cjs`, **new codes**):

| Entity | Value |
|---|---|
| Store code | `SMOKE-PUTUS-20260814` |
| Store name | Smoke Test Putus Store |
| Terms | `PUTUS` |
| Payment tempo | 30 days |
| Margin | n/a / unused for putus pricing |
| Lat/lng | set (so check-in distance is measurable; out-of-radius warn-only is OK) |
| Salesman | `salesman@elorae.com` / `salesman123` with non-system `SALESMAN` + `pwa:access` only |
| UOM | `SMOKE-PCS-PUTUS-20260814` |
| Products | Local ERP-source `FINISHED_GOOD` with non-null `sellingPrice` and nonzero `avgCost` |

Products (suggested):

| SKU | Shape | Stock | Notes |
|---|---|---|---|
| `SMOKE-PUTUS-BASE` | Simple (`variants` null; one inventory row `variantSku: ""` **only** — never also `null`) | qtyOnHand ≥ 40, reservedQty 0 | Set `minOrderQty = 1` (or 2) so the smoke cart is not forced to the global default of 6 |
| `SMOKE-PUTUS-VARIANT` | Variants M + L with matching inventory rows | M ≥ 20, L ≥ 20, reservedQty 0 | Same minOrderQty override; smoke uses M only unless a case needs L |
| `SMOKE-PUTUS-SHORT` | Simple | qtyOnHand 2, reservedQty 0 | Used only for negative delivery / oversell cases |

Rules:

- Do **not** reuse `SMOKE-KONSI-*` store, items, visits, or orders.
- Do **not** seed both `variantSku: null` and `""` for the same simple item (detail caps sum both; writer consumes one).
- Keep active PUTUS promos away from these SKUs/stores for the baseline happy path (promo is extended only).
- Prefer browser check-in for the active visit (do not hand-insert an open visit unless documenting a detour).

## Smoke cases

| ID | Scenario | Expected result |
|---|---|---|
| P-01 | Backoffice creates / opens the PUTUS store | Store detail shows Active, Putus, 30-day tempo |
| P-02 | Salesman signs in | Login lands under `/pwa`; wildcard admin is redirected away from PWA |
| P-03 | Salesman views the store before check-in | Store visible; catalog/order CTAs require check-in |
| P-04 | Salesman checks in | Active visit created; ordering unlocked (out-of-radius badge warn-only if GPS far) |
| P-05 | Salesman opens the PUTUS catalog | Stock + **prices** shown; no KONSI-style price hide; appeals UI may exist but is unused in baseline |
| P-06 | Salesman builds cart (simple + variant) | Selects base qty ≥ item min and variant M qty ≥ 1; sticky bar shows money total and line counts |
| P-07 | Salesman reviews and submits | `PUTUS` order created `PENDING_APPROVAL` with server-priced lines and nonzero total; **`FIELD_SALES` reservations** exist for ordered qty; on-hand unchanged |
| P-08 | Admin filters Field Orders by Putus | Submitted order appears with store, salesman, type Putus, pending status; total shows rupiah (not `—`) |
| P-09 | Admin opens pending detail | Money columns visible; availability shown; **no delivery controls yet** (or delivery gated until approved — confirm UI); status Pending |
| P-10 | Admin approves (no price changes) | Status `APPROVED`; **on-hand still unchanged**; reservations still held; **`SalesHistory` still 0**; `deliveryStatus` still awaiting first delivery (`PENDING`) |
| P-11 | Admin records a **full** delivery (invoice + due dates) | Delivery doc created; on-hand decremented; reservations consumed/released for delivered qty; `SalesHistory` rows keyed by **delivery** docNo; `deliveryStatus=DELIVERED`; one `TaxInvoice` row `PENDING` |
| P-12 | Nota prints + tax queue | Nota Gudang and Nota Tagihan open from the delivery; first tagihan print stamps `notaPrintedAt`; finance queue `/backoffice/finance/faktur-pajak` lists the pending faktur for this nota |
| P-13 | Store history after delivery | Recent orders show the putus order; Items Sent reflects **delivered** quantities (not merely approved) |
| P-14 | Negative: reject a second pending putus order | Empty reject reason blocked; with reason → `REJECTED`, reservations released, excluded from Items Sent as sold/sent |
| P-15 | Negative: insufficient stock at **delivery** (optional if time) | Separate short-stock order or partial; delivery refused with stock error; order remains approved with outstanding qty; no partial consume |

### Explicit non-goals for this run (defer)

Unless time remains after P-01…P-14:

- Price appeal + owner final prices
- Active promo snapshot / multi-delivery discount allocation
- Partial delivery then second delivery
- Partial delivery then **close remainder**
- Smart Request / pack-ratio
- Offline Dexie replay
- Dashboard “approved but undelivered vanishes from both buckets” as a formal case (note in evidence if observed)

## DB assertions (per mutating case)

Capture after P-07 (pending):

- `orderType=PUTUS`, `status=PENDING_APPROVAL`, `total > 0`
- Reservation rows `source=FIELD_SALES` matching line qtys
- `qtyOnHand` unchanged vs pre-submit snapshot
- `SalesHistory` count for this order/delivery = 0
- Outbox delta = 0

Capture after P-10 (approved):

- `status=APPROVED`, `approvedAt` set
- `qtyOnHand` still unchanged
- Reservations still present (not consumed)
- `SalesHistory` still 0
- `deliveryStatus=PENDING` (or equivalent “not yet delivered”)
- Outbox delta = 0

Capture after P-11 (delivered):

- Delivery row + lines; `deliveredQty` on order lines = ordered qty
- `qtyOnHand` decreased by delivered qty
- `SalesHistory` rows present, `channel=OFFLINE`, keyed by delivery `docNo` (not order number alone if multiple deliveries ever exist)
- `TaxInvoice` 1:1 with delivery, status `PENDING`
- Outbox delta = 0

## Evidence policy

- Screenshots under `test-run/screenshots/putus/` (separate from KONSI `01`–`10` files).
- Suggested names: `01-putus-store.png`, `02-putus-catalog-priced.png`, `03-putus-review-submit.png`, `04-backoffice-pending-putus.png`, `05-putus-approved-reserved.png`, `06-putus-delivered.png`, `07-putus-nota-or-tax-queue.png`, `08-store-putus-items-sent.png`, `09-putus-rejected.png` (plus optional `10-putus-delivery-refused.png`).
- Write results to `test-run/putus-evidence.md` (new file — do not overwrite `evidence.md` KONSI results).
- Cases blocked to protect Jubelio are marked `NOT RUN (SAFETY)`.
- Environment detours (schema, permission seed, GPS warn-only) are marked `PASS WITH …` and explained once.

## Execution order

1. Reality re-check: port 3000 owner, outbox baseline, deliver permission present.
2. Seed PUTUS fixtures (new script); confirm outbox unchanged by seed.
3. Browser: P-01 → P-14 in order (P-15 optional).
4. After each mutating step, DB snapshot + screenshot.
5. Final outbox delta for the whole session = 0.
6. Fill `putus-evidence.md`.

## Pass / fail criteria

- **Pass:** All of P-01…P-14 meet expected results; outbox delta 0; no api/Jubelio process started.
- **Fail:** Approve consumes stock or writes `SalesHistory`; deliver does not consume / does not write history; tax row missing after delivery; order created without reservation; any outbox growth; accidental use of KONSI store/terms.
