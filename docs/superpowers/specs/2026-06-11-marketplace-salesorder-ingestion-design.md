# Marketplace Sales Order Ingestion — Design

**Status:** Draft → review
**Date:** 2026-06-11
**Scope:** Sub-A of the Sales Orders feature. Backend only — persists marketplace sales orders received via Jubelio webhook into a new `SalesOrder` + `SalesOrderItem` entity. Dashboard, detail view, and KPI widgets land in Sub-B and Sub-C.

## Goal

Receive Jubelio `salesorder` webhooks (already wired in `SalesOrderWebhookHandler`, currently used only for stock decrement) and persist a denormalized local copy as `SalesOrder` + `SalesOrderItem`. The local copy becomes the source of truth for marketplace order data inside Elorae and the data layer that Sub-B (dashboard) and Sub-C (KPI widgets) consume.

## Non-goals

- Dashboard UI, list views, detail views, filters — Sub-B.
- KPI widgets on beranda — Sub-C.
- Wiring `SalesReturnWebhookHandler` against a real return payload — deferred. Schema is forward-compatible (see §6).
- Pushing orders back out to Jubelio — outside the EPIC.
- Migrating any existing `SalesHistory` rows or merging the two tables — see §3.

## 1. Inputs

- Existing webhook envelope: rows in `JubelioWebhookEvent` with `event = "salesorder"`. `rawPayload` carries the full Jubelio salesorder document (sample at `reference/jubelio/sales-orders-by-id.json`).
- Existing handler: `apps/api/src/jubelio/handlers/salesorder.handler.ts` already runs for each event. Today it only applies stock decrements via `JubelioSalesOrderState`.

## 2. High-level approach

1. Widen `SalesOrderPayload` to expose the fields needed for SalesOrder + items.
2. Add `SalesOrder` + `SalesOrderItem` tables. Add `TOKOPEDIA` to `SalesChannel`. Add new `SalesOrderStatus` enum.
3. Extend the existing `SalesOrderWebhookHandler` to upsert `SalesOrder` (keyed on `salesorderId`) and replace the `SalesOrderItem` set in the same transaction the stock writer already runs in.
4. Keep `JubelioSalesOrderState` untouched. `SalesOrder` is the ERP entity; `JubelioSalesOrderState` remains the internal stock-state machine. Both keyed unique on `salesorderId`.

## 3. Why a new table (not SalesHistory)

`SalesHistory` already exists. It is line-grain (no order header), mandatory FK to `SalesHistoryImport`, owned by `apps/web` (CSV import for forecast), with a narrow `SalesHistoryStatus { COMPLETED, CANCELLED, RETURNED }` enum.

Reusing it would force order-level fees onto every line, manufacture synthetic import-batch rows per webhook, add buyer/shipping columns to a table that doesn't want them, and create a dual-ownership migration with double-count risk against forecast.

`SalesOrder` is a separate concept: live marketplace stream owned by `apps/api`, header + lines, full fee + buyer + shipping detail. If forecast eventually wants marketplace orders as input, a projection job (`SalesOrder.status=COMPLETED` → `SalesHistory.insert`) is cheap. We keep the entities distinct.

## 4. Schema

### `SalesChannel` (extend existing enum)

```
SHOPEE
TIKTOK
TOKOPEDIA  // new
OTHER      // new — unknown source_name falls here, with raw string preserved in sourceName column
```

### `SalesOrderStatus` (new enum)

```
NEW
PROCESSING
SHIPPED
COMPLETED
CANCELLED
RETURNED  // schema-ready for sub-A-followup; not emitted by this slice
```

### `SalesOrder` (new model)

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(cuid())` | ERP-side surrogate |
| `salesorderId` | `Int @unique` | Jubelio canonical id |
| `salesorderNo` | `String` | e.g. `TT-583291012717971150-128001` |
| `channel` | `SalesChannel` | Derived from `source_name` (see §5.1) |
| `sourceName` | `String` | Raw `source_name` preserved verbatim |
| `status` | `SalesOrderStatus` | Derived (see §5.2) |
| `channelStatus` | `String?` | Raw marketplace status string |
| `internalStatus` | `String?` | Raw Jubelio `internal_status` |
| `wmsStatus` | `String?` | Raw Jubelio `wms_status` |
| `isCanceled` | `Boolean @default(false)` | Raw `is_canceled` |
| `isPaid` | `Boolean @default(false)` | Raw `is_paid` |
| `markedAsComplete` | `Boolean @default(false)` | Raw `marked_as_complete` |
| `customerName` | `String?` | `customer_name` |
| `customerPhone` | `String?` | `customer_phone` |
| `customerEmail` | `String?` | `customer_email` |
| `shippingProvince` | `String?` | Indexed (geo) |
| `shippingCity` | `String?` | Indexed (geo) |
| `shippingAddress` | `Json?` | Full shipping snapshot: name/phone/address/area/postcode/country/subdistrict/etc |
| `subTotal` | `Decimal @db.Decimal(15, 2)` | |
| `totalDisc` | `Decimal @db.Decimal(15, 2)` | |
| `totalTax` | `Decimal @db.Decimal(15, 2)` | |
| `shippingCost` | `Decimal @db.Decimal(15, 2)` | |
| `grandTotal` | `Decimal @db.Decimal(15, 2)` | KPI aggregation target |
| `feeBreakdown` | `Json?` | `insurance_cost`, `add_fee`, `service_fee`, `escrow_amount`, `voucher_amount`, `cod_fee`, `order_processing_fee`, `shipping_tax`, `add_disc`, `total_amount_mp` |
| `paymentMethod` | `String?` | |
| `paymentDate` | `DateTime?` | |
| `transactionDate` | `DateTime` | `transaction_date` (when buyer placed). Required column — handler falls back to `created_date` then `Date.now()` if Jubelio omits it (log WARN on fallback). KPI/sorting depends on a non-null value. |
| `createdDateJubelio` | `DateTime?` | `created_date` (when Jubelio recorded) |
| `completedDate` | `DateTime?` | `completed_date` |
| `cancelDate` | `DateTime?` | `internal_cancel_date` |
| `lastModifiedJubelio` | `DateTime?` | `last_modified` |
| `trackingNumber` | `String?` | |
| `courier` | `String?` | |
| `lastWebhookEventId` | `String?` | FK to `JubelioWebhookEvent.id`, no relation back-ref (audit pointer) |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt` | |
| `items` | `SalesOrderItem[]` | |

Indexes: `@@index([channel])`, `@@index([status])`, `@@index([transactionDate])`, `@@index([shippingProvince])`, `@@index([shippingCity])`.

### `SalesOrderItem` (new model)

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(cuid())` | |
| `salesOrderId` | `String` | FK → `SalesOrder.id`, `onDelete: Cascade` |
| `salesorderDetailId` | `Int @unique` | Jubelio canonical line id |
| `jubelioItemId` | `Int` | Raw Jubelio item id |
| `jubelioItemCode` | `String` | Raw Jubelio item code (sku) |
| `itemId` | `String?` | Nullable FK → `Item.id`, resolved via `JubelioProductMapping` lookup |
| `productName` | `String` | Denormalized — survives if Item renamed/deleted |
| `qty` | `Decimal @db.Decimal(15, 4)` | `qty` |
| `qtyInBase` | `Decimal @db.Decimal(15, 4)` | `qty_in_base` |
| `returnedQty` | `Decimal @db.Decimal(15, 4) @default(0)` | Schema-ready for salesreturn follow-up |
| `isCanceledItem` | `Boolean @default(false)` | |
| `unitPrice` | `Decimal @db.Decimal(15, 2)` | `sell_price` |
| `pricePaid` | `Decimal @db.Decimal(15, 2)` | `price` (post-discount unit price Jubelio uses) |
| `discAmount` | `Decimal @db.Decimal(15, 2)` | |
| `taxAmount` | `Decimal @db.Decimal(15, 2)` | |
| `lineTotal` | `Decimal @db.Decimal(15, 2)` | `amount` |
| `discMarketplace` | `Decimal @db.Decimal(15, 2) @default(0)` | `disc_marketplace` / `discount_marketplace` |
| `weightInGram` | `Decimal @db.Decimal(15, 4) @default(0)` | |
| `salesOrder` | `SalesOrder` | Relation |

Indexes: `@@index([itemId])`, `@@index([jubelioItemCode])`.

## 5. Behavior

### 5.1 Channel detection

Parse `source_name`. Format observed: `"Shop | <MarketplaceName>"`. Split on `|`, trim, take the last segment, uppercase, match against:

| Token | Channel |
|-------|---------|
| `SHOPEE` | `SHOPEE` |
| `TOKOPEDIA` | `TOKOPEDIA` |
| `TIKTOK` | `TIKTOK` |
| anything else (incl. empty) | `OTHER` |

`sourceName` column always preserves the raw verbatim string. If `OTHER` is emitted, the handler logs a warning with the raw `source_name` so a new channel can be added to the enum later.

### 5.2 Status derivation

Computed at ingest from raw fields. Order of precedence:

1. `is_canceled === true` OR `internal_status === "CANCELED"` → `CANCELLED`
2. `marked_as_complete === true` OR `internal_status === "COMPLETED"` OR `completed_date !== null` → `COMPLETED`
3. `wms_status === "SHIPPED"` OR `is_shipped === true` → `SHIPPED`
4. `wms_status` ∈ {`PROCESSING`, `PICKED`, `PACKED`, `READY_TO_PACK`} OR `internal_status === "PROCESSING"` → `PROCESSING`
5. default → `NEW`

`RETURNED` is reserved for the salesreturn follow-up. Sub-A never emits it.

The raw triplet (`channelStatus`, `internalStatus`, `wmsStatus`) is always stored alongside the derived enum so we can revise the mapping later without re-ingesting.

### 5.3 Idempotency

Webhook is upsert keyed on `salesorderId`. Re-receiving an event for the same order updates the row in place. Lines are replaced as a set: delete all `SalesOrderItem` for the `SalesOrder` then re-insert, all within the same transaction as the existing stock-state update. The `salesorderDetailId` uniqueness gives us a sanity check at the DB layer.

Why delete-then-insert rather than per-line upsert: Jubelio can send a payload with fewer lines than before (cancelled lines removed). Set-replace matches "the payload IS the truth at this moment." Stock writer is unaffected because it keys on `JubelioSalesOrderState`, not on `SalesOrderItem`.

### 5.4 Handler shape

`SalesOrderWebhookHandler.handle` keeps its current outer flow. New work inside the existing `$transaction(tx)` block, after the stock-state read/upsert and before the stock adjustment loop:

```ts
await this.upsertSalesOrder(tx, p, row.id);
```

A new private method `upsertSalesOrder(tx, payload, webhookEventId)`:

1. Compute `channel` (§5.1) and `status` (§5.2) from `payload`.
2. Resolve `itemId` for each line: `tx.jubelioProductMapping.findFirst({ where: { jubelioItemId: line.item_id } })`. Reuse the same lookup the stock loop does (factor it out — see §7).
3. `tx.salesOrder.upsert({ where: { salesorderId }, create, update })` with `update.lastModifiedJubelio = payload.last_modified`.
4. `tx.salesOrderItem.deleteMany({ where: { salesOrderId: order.id } })`.
5. `tx.salesOrderItem.createMany({ data: lines })` (skipDuplicates: false — let any collision surface).

Important: upsert runs even when the order is canceled. EPIC-03 dashboard shows cancelled orders too — they exist, they're just marked `CANCELLED`. The stock side-effect path is independent.

### 5.5 Failure handling

If `upsertSalesOrder` throws, the entire transaction rolls back (stock state included). Outbox retries kick in via the existing BullMQ machinery. No new dead-letter or alert path beyond what `JubelioWebhookEvent` already provides.

`OTHER` channel emission logs at WARN but does NOT throw. Order persists with `channel = OTHER`.

## 6. Salesreturn handling

`SalesReturnWebhookHandler` stays a stub (`SKIPPED` with `awaiting_samples`) until a real return webhook is captured.

Schema is forward-compatible:
- `SalesOrderItem.returnedQty` column exists, defaults to 0.
- `SalesOrderStatus.RETURNED` enum value exists, unused by this slice.

Sub-A-followup will (a) decode the live webhook envelope, (b) update `returnedQty` per line, (c) set `SalesOrder.status = RETURNED` when all (or all non-cancelled) lines are returned, (d) write the salesreturn-driven stock adjustment alongside.

## 7. Refactors landing with sub-A

The line-lookup `tx.jubelioProductMapping.findFirst({ where: { jubelioItemId } })` runs once for the stock loop and again for `SalesOrderItem.itemId`. Extract a small helper:

```ts
// apps/api/src/jubelio/handlers/_shared/mapping-lookup.ts
export async function resolveItemMapping(tx, jubelioItemId): Promise<JubelioProductMapping | null>
```

Both the stock loop and the new line-builder use it. One query per line, same as today.

No other refactors. Sub-4's handlers stay as-is.

## 8. Data layer ownership

- `SalesOrder` + `SalesOrderItem` are written exclusively by `apps/api` (via the webhook handler). `apps/web` reads only.
- `BOUNDARY.md §3` gets one new row: `SalesOrder / SalesOrderItem — api owns writes; web read-only`.
- No `@elorae/db` writer helper needed since there is no dual-ownership scenario (web never writes these tables).

## 9. Migration

One Prisma migration `add_sales_order_tables`:
- Add `TOKOPEDIA` + `OTHER` to `SalesChannel`.
- Add `SalesOrderStatus` enum.
- Create `SalesOrder`.
- Create `SalesOrderItem`.

No destructive change. No data backfill. Shared TiDB cluster — apply via `pnpm -F @elorae/db migrate:deploy` only. Per the `feedback_db_build` memory: run both `prisma generate` AND `pnpm -F @elorae/db build` after the schema edit so the package dist/ ships the new types.

## 10. Testing

Unit (Jest, `salesorder.handler.spec.ts` extension):

1. Salesorder webhook → SalesOrder row created with derived channel + status + totals.
2. Channel detection: `source_name = "Shop | Tokopedia"` → `TOKOPEDIA`. `"Shop | LazadaXYZ"` → `OTHER` + warn log.
3. Status derivation matrix: feed (isCanceled, internalStatus, wmsStatus, markedAsComplete, completedDate) tuples, assert derived enum.
4. Idempotency: send the same payload twice → one SalesOrder row, lines re-inserted (count unchanged), `lastWebhookEventId` updated.
5. Set-replace: send first payload with 2 lines, then same `salesorderId` with 1 line → one line remains.
6. Item FK resolution: line with `jubelioItemId` matching a mapping → FK set. Unmatched line → FK null, denormalized SKU/name still stored.
7. Cancellation: payload with `is_canceled=true` → SalesOrder persists with `status=CANCELLED`. Stock-state behavior unchanged from sub-4.
8. Transaction atomicity: simulate `salesOrderItem.createMany` throwing → stock state NOT updated, no half-written SalesOrder row.

Integration smoke (live ngrok):

1. Trigger a real Jubelio salesorder webhook (any test order from Jubelio's test store).
2. Verify `SalesOrder` row exists with sensible values for channel, totals, items.
3. Verify the existing stock decrement still fires (sub-4 regression guard).

Read-only inbound — no writes to Jubelio, no rollback path needed per `feedback_prod_test_rollback`.

## 11. Open questions

None blocking. The salesreturn webhook shape is genuinely unknown until Jubelio delivers one — sub-A explicitly defers this and ships return-ready schema.

## 12. Decisions log

| Decision | Resolution |
|----------|------------|
| Reuse `SalesHistory` vs new tables | New `SalesOrder` + `SalesOrderItem`. Different owner, shape, lifecycle. |
| Channel detection | Parse `source_name`. `OTHER` bucket + warn for unknown tokens. Raw verbatim preserved. |
| Fee storage | Hybrid: core totals as Decimal columns, exotic fees as `feeBreakdown Json`. |
| Status modeling | Raw strings + derived enum, computed at ingest. |
| Upsert vs reject duplicates | Upsert (EPIC text "reject if exists" is wrong for webhook streams). |
| Item link | Nullable FK + denormalized sku/name fallback. |
| Address storage | `shippingProvince` + `shippingCity` flat, rest in `shippingAddress Json`. |
| Salesreturn integration | Schema-ready now; handler wired in sub-A-followup once live webhook captured. |
| State table relation | Keep `JubelioSalesOrderState` separate. Both keyed on `salesorderId`. |

## 13. Out-of-scope follow-ups

- Sub-B: dashboard list + filters + detail view.
- Sub-C: KPI widgets on `/backoffice/dashboard`.
- Sub-A-followup: real salesreturn webhook wiring once payload sample captured.
- `BOUNDARY.md §3` row addition lands with sub-A's PR.
