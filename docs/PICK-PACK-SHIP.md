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

- Neither cancelled nor returned, stock not yet applied → `reserveOrder` creates `StockReservation`
  rows in state `RESERVED` and increments `InventoryValue.reservedQty`. `qtyOnHand` is untouched.
- Cancelled or returned after having been applied, and not reported shipped → `releaseOrder`
  reverses whatever is still `RESERVED`. "Cancelled" and "returned" are `isCanceledOrder` and
  `isReturnedOrder` in `_shared/status-derive.ts`; `is_canceled` alone misses most cancels.
- Jubelio already reports the order shipped (`reportsShipped`: `isShippedOrder` — `wms_status ===
  "SHIPPED"`, `is_shipped` or `internal_status === "SHIPPED"` — or `marked_as_complete`, or a
  `completed_date`) → reserve first if needed, then
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
| Resi (tracking number) | `apps/web/app/backoffice/sales-orders/SalesOrdersPageClient.tsx`, `apps/web/components/resi-barcode.tsx`, `apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx`, `apps/web/app/backoffice/sales-orders/[id]/packing-slip/PackingSlipPrint.tsx`, `apps/web/lib/sales-orders/resi-pending.ts` | The sales order list still just shows a dash when there is no resi — the pending state below is detail-card- and packing-slip-only. The detail card's tracking block and the packing slip render the resi as a scannable CODE128 barcode beside the text. `isAwaitingResi` (`resi-pending.ts`) gates a muted pending state to a marketplace order that can still plausibly get one — channel SHOPEE/TIKTOK/TOKOPEDIA, status NEW or PROCESSING, not cancelled, no resi yet — so an OTHER/OFFLINE order, a SHIPPED/COMPLETED/RETURNED order or a cancelled one shows nothing extra, exactly as before. When it applies, the detail card renders "Resi belum tersedia…" with a "Cek resi" button that calls `router.refresh()` (no auto-polling), and the packing slip prints a visible "belum tersedia — cetak ulang setelah resi muncul" line in place of the barcode, so nothing looks silently omitted. The barcode hides itself for a value JsBarcode refuses rather than rendering one that scans wrong, and the packing slip relies on child effects running before its own `window.print()` effect, so the bars are drawn before the print dialog opens. `apps/api/src/jubelio/handlers/salesorder.handler.ts` keeps a stored resi/courier when a later-processed webhook payload carries a BLANK or absent value; a payload carrying a different NON-BLANK value (including an older, out-of-order one) still replaces it — there is no ordering guard, only a blank guard. So an AWB that gets cancelled with no replacement resi keeps showing the old one until a new non-blank value arrives. |
| Fulfillment queue | `apps/web/app/backoffice/fulfillment/` | Filterable/sortable list of orders (default filter `PENDING`), row checkboxes, **batch** Finish Pick / Finish Pack. No batch Ship — shipping needs a per-order courier choice. |
| Order detail card | `apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx` | Status badge, a three-row who/when timeline, the single next-step button, courier `Select` + confirm dialog for Ship, tracking number once known — or, while a marketplace order waits for its resi, a pending state with a Cek resi button. |
| Pick list (print) | `apps/web/app/backoffice/sales-orders/[id]/pick-list/` | Printable line list for the warehouse, in Elorae's own terms: each line prints the variant SKU (the item SKU for a variantless item), the Elorae item name and the variant's attributes, with the variant's image. Lines resolve through `JubelioProductMapping` by `jubelioItemId` — the same lookup the reservation path uses — falling back to `SalesOrderItem.itemId` at item level (`apps/web/lib/sales-orders/pick-list-identity.ts`). Does **not** hide an unmapped line: one with no resolvable item prints the Jubelio `item_code`/name, labelled as unmapped. The packing slip deliberately still prints the Jubelio fields — it goes in the customer's box, where the marketplace name is the one the buyer recognises. |
| Packing slip (print) | `apps/web/app/backoffice/sales-orders/[id]/packing-slip/` | Printable slip that goes in the box. |
| Packing video (pack proof) | `apps/web/app/packer/` (scan + record kiosk), `apps/web/components/packing-video-actions.tsx` (review) | The packer scans the resi and records the packing on camera; the clip is stored as the order's `PackingVideo`. The SO detail page and the return decision screen show it with the time it was recorded and who recorded it. Does **not** hold more than one clip per order — `salesOrderId` is unique and a re-record overwrites the clip in place — and the time shown is the upload time, not a timestamp burnt into the video. A re-record keeps `recordedAt` on the FIRST recording and stamps `replacedAt`/`updatedById`, so the clip that plays was taken at `replacedAt ?? recordedAt`: every screen goes through `currentClipRecording` in `lib/packer/clip-recording.ts` rather than reading `recordedAt` directly. `app/packer/PackerListClient.tsx` (with `listPackingVideos`/`serializePackingVideos`) is an orphan from before the kiosk UI — no route renders it, and it still reads raw `recordedAt`. |

Actions are gated on the `sales_orders:fulfill` permission (`PERMISSIONS.SALES_ORDERS_FULFILL`),
checked server-side in every action, plus client-side to hide the buttons. The two **print pages
sit at `sales_orders:view`**, not `sales_orders:fulfill` — `proxy.ts` prefix-matches them under
`/backoffice/sales-orders` in `ROUTE_PERMISSIONS`, so anyone who can open the order list can print
its pick list. Their page components only re-check that a session exists; the proxy is what
enforces the permission.

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
| Pick | `salesorder_pick` | `POST /wms/sales/picklists/` | Create-and-autocomplete: `picklist_id: 0`, `picklist_no: "[auto]"`, `is_completed: true`, `picker_id`, `salesorderIds`, and a per-line `items[]` carrying `salesorder_detail_id`, `item_id`, `location_id`, `qty_ordered`/`qty_picked`. Cancelled lines are filtered out; zero pushable lines → `SKIPPED`. `picker_id` is `JUBELIO_PICKER_EMAIL` (falling back to the integration account), **not** the operator who clicked — Jubelio gets no per-user picker audit; `pickedById` is the only place that exists. |
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

Since Jubelio's `internal_status: "SHIPPED"` counts as shipped (`isShippedOrder`), the sync fires at Jubelio's
ship, not at completion. An order packed in Elorae but not yet shipped there is advanced to `SHIPPED` by
that webhook, after which Elorae's Ship refuses it (`expected PACKED`) and sends no `salesorder_ship`
push — Jubelio has already shipped it.

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
- **The 1–2 minute resi wait is Jubelio/marketplace AWB generation, not an Elorae delay.** After
  a courier is assigned, Jubelio still has to request the AWB from the marketplace before the
  webhook carrying `tracking_number` arrives — the pending state and "Cek resi" button exist to
  make that wait visible, not to fix it.

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
