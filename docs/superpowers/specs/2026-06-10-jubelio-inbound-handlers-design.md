# Jubelio Inbound Webhook Handlers — Design Spec

**Date:** 2026-06-10
**Scope:** EPIC-01-02 completion — real handlers for `salesorder`, `salesreturn`, `product` webhook events. Today these route to `UnhandledEventHandler` and SKIP.
**Sub-project:** sub-4
**Status:** draft, awaiting approval

## 1. Goal

When Jubelio sends webhook events for marketplace orders, returns, or product edits, apply the corresponding Elorae-side change automatically:

- `salesorder` → decrement variant stock on first webhook (active state), auto-reverse on cancellation.
- `salesreturn` → STUB returning SKIPPED until Jubelio sends real samples (no payload shape available yet).
- `product` → re-ingest the affected `item_group_id` via existing `JubelioCatalogSyncService.syncCatalog({ itemGroupIds })`.

Closes EPIC-01-02 acceptance: "Payload parsed and routed to appropriate handler" — all four event types covered (the existing `stock` handler from sub-1 stays unchanged).

## 2. Scope

### In scope
- Three new handlers in `apps/api/src/jubelio/handlers/`:
  - `salesorder.handler.ts`
  - `salesreturn.handler.ts` (stub)
  - `product.handler.ts`
- New table `JubelioSalesOrderState` for "did we decrement?" idempotency + reversal tracking.
- `JubelioEventRouter` updated to dispatch the three new event types.
- New skip reasons in `webhook-status.ts`.
- Unit tests for `salesorder.handler` (~9 cases) + minimal tests for `salesreturn.handler` + `product.handler`.
- `AdminNotification` for unmapped salesorder lines (one notification per order, batched).

### Out of scope
- HPP backwrite from sale (accounting concern).
- Pricing reconciliation between Elorae `Item.sellingPrice` and webhook's `sell_price`.
- Customer/buyer record creation.
- Shipping label / fulfillment integration.
- Marketplace fee accounting.
- `salesreturn` real logic — handler returns SKIPPED until a real sample lands. Follow-up commit fills it in.

## 3. Architecture

```
Jubelio  ──webhook──►  apps/api  ──BullMQ──►  JubelioWebhookProcessor
                                                      │
                                                      ▼
                                            JubelioEventRouter
                                            ├─ "stock"        → StockWebhookHandler        (existing)
                                            ├─ "salesorder"   → SalesOrderWebhookHandler   (NEW)
                                            ├─ "salesreturn"  → SalesReturnWebhookHandler  (NEW, stub)
                                            ├─ "product"      → ProductWebhookHandler      (NEW)
                                            └─ default        → UnhandledEventHandler
```

apps/api owns all the new writes. apps/web is not involved.

## 4. Data model

One new table. No changes to existing tables.

```prisma
model JubelioSalesOrderState {
  id                  String    @id @default(cuid())
  salesorderId        Int       @unique
  stockApplied        Boolean   @default(false)
  lastStatus          String?
  lastIsCanceled      Boolean   @default(false)
  appliedAt           DateTime?
  reversedAt          DateTime?
  lastWebhookEventId  String
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@index([lastWebhookEventId])
}
```

Single source of truth for "what did we apply for this order?" — the handler reads `stockApplied` to decide transitions.

## 5. Handler logic

### 5.1 `SalesOrderWebhookHandler`

File: `apps/api/src/jubelio/handlers/salesorder.handler.ts`.

```
async handle(row):
  const p = row.rawPayload as SalesOrderPayload
  const state = await prisma.$transaction(async (tx) => {
    const existing = await tx.jubelioSalesOrderState.findUnique({ where: { salesorderId: p.salesorder_id } })
    return existing ?? await tx.jubelioSalesOrderState.create({
      data: { salesorderId: p.salesorder_id, lastWebhookEventId: row.id, lastStatus: p.channel_status, lastIsCanceled: !!p.is_canceled }
    })
  })

  const shouldApply = !p.is_canceled

  if shouldApply && !state.stockApplied:
    const { applied, unmappedItems } = await applyDecrement(p, row.id, -1)  // -1 = decrement
    if unmappedItems.length > 0:
      await adminNotify({ category: "JUBELIO_UNMAPPED_LINES", title: "Salesorder ${p.salesorder_no}: unmapped items", metadata: { salesorderId: p.salesorder_id, lines: unmappedItems } })
    await prisma.jubelioSalesOrderState.update({ where: { id: state.id }, data: { stockApplied: true, appliedAt: new Date(), lastWebhookEventId: row.id, lastStatus: p.channel_status, lastIsCanceled: false } })

  elif !shouldApply && state.stockApplied:
    await applyDecrement(p, row.id, +1)  // reversal
    await prisma.jubelioSalesOrderState.update({ where: { id: state.id }, data: { stockApplied: false, reversedAt: new Date(), lastWebhookEventId: row.id, lastStatus: p.channel_status, lastIsCanceled: true } })

  else:
    // No state transition; just record latest snapshot.
    await prisma.jubelioSalesOrderState.update({ where: { id: state.id }, data: { lastWebhookEventId: row.id, lastStatus: p.channel_status, lastIsCanceled: !!p.is_canceled } })

  return { kind: "processed" }
```

Helper `applyDecrement(p, webhookEventId, sign)`:

```
for line in p.items:
  if line.is_canceled_item: continue
  mapping = await prisma.jubelioProductMapping.findFirst({ where: { jubelioItemId: line.item_id } })
  if !mapping:
    unmappedItems.push({ item_code: line.item_code, item_id: line.item_id, qty: line.qty })
    continue
  const direction = sign === -1 ? "decrement" : "reversal"
  await applyJubelioStockAdjustment(prisma, {
    itemId: mapping.itemId,
    variantSku: mapping.erpVariantSku,
    delta: sign * Number(line.qty),
    idempotencyKey: `salesorder-${p.salesorder_id}-${direction}-line-${line.salesorder_detail_id}`,
    externalRef: `salesorder:${p.salesorder_id}`,
    reason: `Jubelio salesorder ${p.salesorder_no} ${direction}`,
  })
return { applied: matchedCount, unmappedItems }
```

### 5.2 `SalesReturnWebhookHandler`

File: `apps/api/src/jubelio/handlers/salesreturn.handler.ts`.

```
async handle(row):
  this.logger.log(`Salesreturn received (id=${row.id}) — awaiting payload sample`)
  return { kind: "skipped", reason: "awaiting_samples" }
```

Comment in source: "Filled in after Jubelio sends a real return webhook. See spec §5.2."

### 5.3 `ProductWebhookHandler`

File: `apps/api/src/jubelio/handlers/product.handler.ts`.

```
async handle(row):
  const p = row.rawPayload as ProductPayload  // { action, item_group_id, item_group_name }
  if !p.item_group_id: return { kind: "skipped", reason: "missing_item_group_id" }
  await this.catalogSync.syncCatalog({ itemGroupIds: [p.item_group_id] })
  this.logger.log(`Re-ingested item_group_id=${p.item_group_id}`)
  return { kind: "processed" }
```

Reuses `JubelioCatalogSyncService` (post-PR-#39, single-item resync ~1-2s).

## 6. Boundary respect

- `JubelioSalesOrderState` (NEW): api-owned.
- `StockAdjustment` (dual-owner per BOUNDARY §3.1): api writes via `applyJubelioStockAdjustment` from `@elorae/db`. `source=JUBELIO_WEBHOOK` + idempotencyKey. Unchanged path from sub-1.
- `Item` + `InventoryValue` (dual-owner per §3.3): api writes go through `applyJubelioStockAdjustment` (decrements/increments `InventoryValue.qtyOnHand`).
- `AdminNotification`: api writes via existing `AdminNotificationService` (sub-1 infra).
- `JubelioProductMapping`: api reads only.
- `Item` + variants via catalog re-ingest path for product handler: writes via `createItemFromIngest` / `updateItemFromIngest` (sub-1, stamps `source=JUBELIO_INGEST`).

No new boundary work. All writes through existing helpers.

## 7. Error handling + idempotency

- **Webhook idempotency** (sub-1): `JubelioWebhookEvent` row uniqueness on `(event, payloadHash)`. Duplicate webhook = no second processing.
- **Stock-adjustment idempotency** (sub-1): `applyJubelioStockAdjustment` uses `idempotencyKey` unique constraint on `StockAdjustment`. Re-applying same key is a no-op. Keys:
  - Decrement: `salesorder-${id}-decrement-line-${detail_id}`
  - Reversal: `salesorder-${id}-reversal-line-${detail_id}`
- **State table**: `JubelioSalesOrderState.salesorderId @unique` → upsert is atomic. Transition logic always reads current `stockApplied` before deciding action.
- **Partial-failure during decrement**: 3 of 5 lines succeed, 4th throws → handler catches per-line, fires AdminNotification with line context + continues. `state.stockApplied=true` set at end. BullMQ retry would idempotency-skip the 3 successful + retry the 2 failed.
- **Reversal asymmetry**: an unmapped line skipped on decrement is also skipped on reversal (no phantom rollback).
- **Concurrent webhooks for same salesorderId**: BullMQ jobId = webhookEventId (unique) so the same webhook is processed at most once. Two DIFFERENT webhooks for same salesorderId arriving back-to-back: wrap state read + transitions in `$transaction` to serialize. Race window narrow given single-worker queue.
- **Product handler failure**: catalog sync fails → handler throws → BullMQ retry → eventually DEAD → AdminNotification via sub-1 sweeper.
- **AdminNotification grouping**: ONE notification per `salesorder_id` (not per line) carrying `unmappedLines: [...]` array in metadata. Avoids flood when admin orders 50 new SKUs.

## 8. Testing

### `salesorder.handler.spec.ts` (~9 cases)
Mock `prisma` + `applyJubelioStockAdjustment` + `AdminNotificationService`. Cover:
- First webhook, active state, all lines mapped → decrements applied, state.stockApplied=true.
- First webhook, `is_canceled=true` → no decrement, state.stockApplied=false.
- Second webhook (same salesorderId, still active) → no-op (state.stockApplied already true).
- Cancellation webhook after decrement → reversal applied, state.stockApplied=false, reversedAt set.
- Un-cancel webhook after reversal → re-decrement, state.stockApplied=true.
- Unmapped item_id → AdminNotification fired once with the unmapped line, other lines processed.
- `is_canceled_item=true` on a single line → that line skipped, others processed.
- All lines unmapped → one AdminNotification, no stock writes, state still updates.
- Re-run handler on same webhook (BullMQ retry) → idempotent (no double-decrement thanks to `applyJubelioStockAdjustment` key).

### `salesreturn.handler.spec.ts` (1 case)
- Returns SKIPPED with reason `awaiting_samples`.

### `product.handler.spec.ts` (~2 cases)
- Happy path: calls `syncCatalog({ itemGroupIds: [id] })` with right id, returns PROCESSED.
- Missing `item_group_id` in payload → SKIPPED `missing_item_group_id`.
- Catalog sync throws → handler rethrows (BullMQ handles retry).

### Router unit test update
- `event-router.spec.ts`: add cases for salesorder, salesreturn, product routing to the right handler.

### Manual smoke (per `feedback_prod_test_rollback`)

**This involves real Jubelio orders — needs client greenlight.** Sub-3 set the precedent: don't smoke against prod until greenlight + test-cleanup path is documented.

Required steps before smoke begins:
1. Document on Jubelio admin: how to cancel a test order (manual UI path).
2. Document on Elorae: where to verify InventoryValue + StockAdjustment after each step.

Smoke checklist:
1. Place a test order on a Jubelio storefront (small qty, recognizable product like the TEST-PUSH-* SKUs from sub-3).
2. Wait for webhook → check `JubelioSalesOrderState` row created + `stockApplied=true`.
3. Verify `InventoryValue.qtyOnHand` decreased by qty.
4. Verify `StockAdjustment` row with `source=JUBELIO_WEBHOOK` + correct `idempotencyKey`.
5. Cancel the order on Jubelio admin → second webhook → state.stockApplied=false, reversedAt set, stock returned.
6. Edit a product on Jubelio admin → product webhook → Item updates locally within ~2s.
7. Manual cleanup: delete the test order from Jubelio side.

## 9. Open implementation questions (settle during plan)

1. AdminNotification grouping verified to be per-order (not per-line) — fix during impl if it ends up per-line.
2. `lastStatus` field on `JubelioSalesOrderState` — debugging-only. Plan can drop if unused.
3. State transaction scope: wrap entire handler in a `$transaction` vs just the state CAS. Lean toward the latter — stock adjustments are themselves transactional via `applyJubelioStockAdjustment`.
4. Single-item catalog re-ingest performance post-PR-#39 — confirm during smoke (expected <2s for 1 group_id).
5. Migration timestamp: pick something later than `20260605120000_jubelio_category_mapping_unique_itemcategoryid` (the latest migration on master).

## 10. Decisions log

- **salesorder trigger**: ANY active state (decrement on first webhook unless `is_canceled=true`). Most aggressive of the three options.
- **Cancellation reversal**: auto-reverse with `-reversal-` idempotencyKey suffix + state tracking.
- **Mapping miss handling**: partial-decrement + AdminNotification grouped per-order.
- **salesreturn**: stub returning SKIPPED `awaiting_samples`. Real logic in follow-up commit once Jubelio sends a sample.
- **product**: re-ingest via `JubelioCatalogSyncService.syncCatalog({ itemGroupIds: [id] })`.
- **State storage**: new `JubelioSalesOrderState` table (api-owned).
- **No reverse-cascade on AdminNotification**: unmapped lines reported once at decrement-time. Reversal silently skips them.
