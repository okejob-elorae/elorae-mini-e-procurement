# Pick → Pack → Ship

How a marketplace order gets fulfilled in Elorae, from the moment it lands via a Jubelio
webhook to the moment stock leaves the ledger and a shipment exists in Jubelio's WMS.

Two services participate. `apps/web` owns the operator UI and every local state transition;
`apps/api` owns the outbound push to Jubelio. They never call each other — `apps/web` writes a
`JubelioOutbox` row inside the same transaction as the state change, and `apps/api` picks it up.
See `docs/BOUNDARY.md` for the general contract.

## 1. Before fulfillment: the order arrives

`SalesOrderWebhookHandler` (`apps/api/src/jubelio/handlers/salesorder.handler.ts`) ingests the
`salesorder` webhook and upserts a `SalesOrder` + its `SalesOrderItem` lines. In the same pass it
moves the stock ledger:

- Not cancelled, stock not yet applied → `reserveOrder` creates `StockReservation` rows in state
  `RESERVED` and increments `InventoryValue.reservedQty`. `qtyOnHand` is untouched.
- Cancelled after having been applied → `releaseOrder` reverses the reservation.
- Jubelio already reports the order shipped (`reportsShipped`: `wms_status === "SHIPPED"`,
  `is_shipped`, `marked_as_complete`, or a `completed_date`) → reserve first if needed, then
  `consumeOrder` immediately — stock is off `qtyOnHand` before an operator ever sees the order,
  and `fulfillmentStatus` is seeded or advanced to `SHIPPED` (§4 for the ledger writes, §6 for the
  status sync).

Otherwise — the normal path — an order enters the fulfillment queue with stock **reserved but
still on hand**. Available-to-sell is `qtyOnHand − reservedQty`, derived at read time.

## 2. The state machine

`SalesOrder.fulfillmentStatus` is a strict forward-only chain:

```
PENDING ──finishPick──> PICKED ──finishPack──> PACKED ──ship(courier)──> SHIPPED
```

Enforced in `packages/db/src/sales-order-fulfillment-writer.ts`, not in the UI. Each writer runs
in its own transaction and:

1. Loads the order; throws `InvalidFulfillmentTransition` if it is missing.
2. Refuses outright when `SalesOrder.status` is `CANCELLED` or `RETURNED` (`assertNotCancelled`).
3. Refuses when `fulfillmentStatus` is not exactly the expected predecessor. There is no skip,
   no rewind, no re-run — a second click on the same step throws.
4. Stamps the status, the timestamp (`pickedAt` / `packedAt` / `shippedAt`) and the actor
   (`pickedById` / `packedById` / `shippedById`).
5. Creates a `JubelioOutbox` row for the matching push.

`shipOrderAction` additionally takes a `courierId`, stores it on the order, and calls
`consumeOrder` — that last call is where stock actually leaves (§4).

Every transition error surfaces to the operator as a warning toast, never as a crash: the server
actions catch `InvalidFulfillmentTransition` and return `{ ok: false, reason }`.

## 3. Operator surfaces

| Surface | File | What it does |
|---|---|---|
| Fulfillment queue | `apps/web/app/backoffice/fulfillment/` | Filterable/sortable list of orders (default filter `PENDING`), row checkboxes, **batch** Finish Pick / Finish Pack. No batch Ship — shipping needs a per-order courier choice. |
| Order detail card | `apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx` | Status badge, a three-row who/when timeline, the single next-step button, courier `Select` + confirm dialog for Ship, tracking number once known. |
| Pick list (print) | `apps/web/app/backoffice/sales-orders/[id]/pick-list/` | Printable line list with primary item images for the warehouse. |
| Packing slip (print) | `apps/web/app/backoffice/sales-orders/[id]/packing-slip/` | Printable slip that goes in the box. |

Actions are gated on the `sales_orders:fulfill` permission (`PERMISSIONS.SALES_ORDERS_FULFILL`),
checked server-side in every action, plus client-side to hide the buttons. The two **print pages
check only that a session exists** — they are read-only views, but note the asymmetry before
assuming print is fulfil-gated.

Batch behaviour: `runBatch` loops the selected ids one at a time and counts an
`InvalidFulfillmentTransition` as `skipped` rather than aborting the batch, so a mixed selection
processes what it can and reports `{ processed, skipped }`.

## 4. Where stock actually moves

Only when the order is **consumed**, which happens on exactly two paths: Elorae's Ship step
(`markOrderShipped`) and the inbound already-shipped path in §1. Both call `consumeOrder`
(`packages/db/src/reservation-writer.ts`) inside a transaction, which per reservation line:

- CAS-flips the `StockReservation` from `RESERVED` to `CONSUMED` via `updateMany`; a zero-row
  result means another path already consumed it, and the line is skipped (race-safe).
- Decrements `qtyOnHand`, `reservedQty` and `totalValue` on `InventoryValue` with atomic
  `decrement` (never read-modify-write — the webhook worker is concurrent).
- Writes a `StockAdjustment` audit row, source `FULFILLMENT_CONSUME`, idempotency key
  `salesorder-<id>-consume-line-<detailId>`.
- Stamps `SalesOrderItem.cogs` as `qty × avgCost` — a **line total**, not a unit cost — using the
  average cost in force at that moment. Finance sums this column later, so read it as a total.

Pick and Pack never touch the ledger. They are workflow stamps plus a push.

Downstream, the sales-journal sweep (`apps/web/lib/finance/sales/sweep.ts`) treats an order as
journalable when `status IN ('SHIPPED','COMPLETED') OR fulfillmentStatus = 'SHIPPED'`.

## 5. Pushing to Jubelio

Each transition enqueues a `JubelioOutbox` row. The poller
(`apps/api/src/jubelio/outbox/outbox-poller.service.ts`, every 5 s, batches of 100) hands it to a
BullMQ job; `OutboxRouter` dispatches by `entityType`; the processor marks the row `DONE`,
`SKIPPED`, or — after 5 attempts with exponential backoff — `DEAD` plus an admin notification.

| Step | `entityType` | Jubelio endpoint | Body shape |
|---|---|---|---|
| Pick | `salesorder_pick` | `POST /wms/sales/picklists/` | Create-and-autocomplete: `picklist_id: 0`, `picklist_no: "[auto]"`, `is_completed: true`, `picker_id`, `salesorderIds`, and a per-line `items[]` carrying `salesorder_detail_id`, `item_id`, `location_id`, `qty_ordered`/`qty_picked`. Cancelled lines are filtered out; zero pushable lines → `SKIPPED`. |
| Pack | `salesorder_pack` | `POST /wms/sales/packlist/mark-as-complete/` | `{ ids: [salesorderId] }` and nothing else — **no `location_id`**. |
| Ship | `salesorder_ship` | `POST /wms/shipments/` | `courier_new_id`, `location_id`, `shipment_type: "2"`, `shipment_date`, `orders: [salesorderId]`. |

`location_id` is **`-1`** — the real id of the tenant's only warehouse, confirmed live via
`GET /jubelio/locations`. It is not a sentinel and not a typo; see the comment on
`JUBELIO_WMS_LOCATION_ID` in `apps/api/src/jubelio/outbox/jubelio-outbox.config.ts` before
touching it.

All three handlers wrap the call in `isAlreadyInStateError` (`already-in-state.ts`). Jubelio
answers "this order is already past that step" with an **HTTP 500 carrying free-text Indonesian**
at `err.cause.code`, so the handler downgrades that specific failure to
`SKIPPED: jubelio_already_in_state` instead of retrying it to `DEAD`.

Couriers come from the `JubelioCourier` table; `getCouriersForShipDialog` lazily triggers
`syncJubelioCouriers()` the first time the table is empty.

## 6. Sync back from Jubelio

An operator can also mark an order shipped inside Jubelio's own admin UI, or a marketplace can
auto-ship it. The inbound salesorder handler covers that with a **forward-only** sync:

- New row + Jubelio already reports shipped → seed `fulfillmentStatus: "SHIPPED"` on create.
- Existing row → `updateMany` guarded on `fulfillmentStatus: { not: "SHIPPED" }`, so an order
  that went through Elorae's Ship button keeps its `shippedById` audit and is not overwritten.
  Idempotent on webhook re-delivery.

`shippedAt` falls back through `completed_date` → `last_modified` → now.

Note what this sync does **not** do: it never walks an order back, and it never fills in
`pickedAt`/`packedAt` for an order that skipped those steps in Elorae. An order can legitimately
be `SHIPPED` with a null pick/pack timeline.

## 7. Known gaps

- **The local stamp is not proof Jubelio agrees.** The `fulfillmentStatus` write and the outbox
  row commit together, but a push that later goes `SKIPPED` or `DEAD` never rolls the stamp back,
  and nothing reconciles the two directions. Read `fulfillmentStatus` as "what Elorae did", not
  "what Jubelio has".
- **Pick pushes were silently broken in production for months** (shipped PR #47, fixed PR #276 on
  2026-09-02): the handler posted a `{ids, is_completed}` body that Jubelio rejects on
  `picklist_no`, then, once the shape was fixed, died on `location_picklist_header` FK violations
  from the wrong `location_id`. A poller wedge kept the failed rows `PENDING` instead of `DEAD`,
  so no alert ever fired. Both causes are fixed; the lesson — a green fulfillment queue proves
  nothing about the push — is not.
- **Single warehouse assumption.** `JUBELIO_WMS_LOCATION_ID` is a module constant. Widen it to a
  per-order lookup before a second location is onboarded.
- **No un-ship / un-pick path.** The chain is forward-only by construction. A mis-shipped order is
  corrected through the sales-return flow, not by rewinding fulfillment.

## File map

```
packages/db/src/sales-order-fulfillment-writer.ts      state machine + outbox enqueue
packages/db/src/reservation-writer.ts                  reserveOrder / consumeOrder / releaseOrder
apps/web/app/actions/sales-order-fulfillment.ts        per-order actions + courier list
apps/web/app/actions/fulfillment-queue.ts              queue query + batch pick/pack
apps/web/app/backoffice/fulfillment/                   queue page
apps/web/app/backoffice/sales-orders/[id]/             detail card + pick-list + packing-slip
apps/api/src/jubelio/handlers/salesorder.handler.ts    inbound ingest + reservation + ship sync
apps/api/src/jubelio/outbox/outbox-router.ts           entityType → handler
apps/api/src/jubelio/outbox/handlers/salesorder-*.ts   the three pushes
apps/api/src/jubelio/outbox/jubelio-outbox.config.ts   location id, queue + poller tuning
```
