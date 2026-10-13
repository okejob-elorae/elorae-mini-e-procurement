# Consignment sales smoke test

Date: 2026-08-14  
Runtime: `origin/master` at `69e85fa` in an isolated worktree  
Application: `http://localhost:3000`  
Database: local MariaDB (`localhost:3306/elorae`)

## User story

As a field salesman visiting a consignment store, I can select available products without seeing prices, submit a consignment transfer request, and have an authorized backoffice user review it, optionally add never-sent products, and approve it so stock is reserved for the store transfer.

## Safety boundary

- Local MariaDB mutations are allowed.
- No operation may call or mutate production Jubelio.
- The smoke runtime starts `apps/web` only; `apps/api`, BullMQ workers, and the Jubelio outbox processor are not started.
- Fixtures are inserted directly into local MariaDB and do not create `JubelioOutbox` rows.
- Do not use catalog sync, product push, stock adjustment, fulfillment, marketplace order, or any Jubelio menu action.
- Konsi create/approve/reject is local-only in the current implementation: it writes field-sales orders, reservations, store visits, notifications, and local inventory aggregates.

## Fixture

- Store: `SMOKE-KONSI-20260814` / `Smoke Test Konsi Store`
- Terms: `KONSI`
- Payment tempo: 30 days
- Margin: 20%
- Salesman: `salesman@elorae.com` with only `pwa:access`
- Products: local ERP-source finished goods with local-only inventory rows

## Smoke cases

| ID | Scenario | Expected result |
|---|---|---|
| K-01 | Backoffice creates a KONSI store | Store detail shows Active, Konsi, 30-day tempo, and 20% margin |
| K-02 | Salesman signs in | Login lands under `/pwa`; backoffice routes are unavailable |
| K-03 | Salesman views the store before check-in | Store is visible; ordering controls require check-in |
| K-04 | Salesman checks in | An active visit is created and catalog ordering becomes available |
| K-05 | Salesman opens the KONSI catalog | Available stock and “Baru” are shown; all prices and price appeals are hidden |
| K-06 | Salesman selects a simple item and a variant | Cart counts item units and SKU lines; quantities cannot exceed availability |
| K-07 | Salesman reviews and submits | Review has no money total; a `KONSI` order is created as `PENDING_APPROVAL` with line prices/totals at zero |
| K-08 | Admin filters Field Orders by Konsi | Submitted transfer appears with the correct store, salesman, type, and pending status |
| K-09 | Admin opens pending transfer | Money is hidden before approval; stock availability is shown; deliveries are absent |
| K-10 | Admin uses never-sent suggestions | Suggestions exclude items already on the order or previously sent, show per-variant availability, and stage valid integer quantities |
| K-11 | Admin approves with an added line | All lines reserve atomically; order becomes APPROVED; grossed-up prices appear; no stock is consumed and no `SalesHistory` is created |
| K-12 | Store history after approval | Recent orders and Items Sent include the approved KONSI transfer |
| K-13 | Negative: approval with insufficient stock | Approval is refused, names the short line, and leaves the order pending with no partial reservations |
| K-14 | Reject path on a second transfer | A reason is required; rejected order remains unreserved and excluded from “sent” history |

## Evidence policy

- Screenshots are saved under `test-run/screenshots/`.
- `test-run/evidence.md` records observed results, URLs, fixture IDs, and deviations.
- Cases blocked to protect Jubelio are marked `NOT RUN (SAFETY)` rather than bypassed through production integration.
