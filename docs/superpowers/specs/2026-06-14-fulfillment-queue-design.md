# Fulfillment Queue — Design

**Status:** Draft → review
**Date:** 2026-06-14
**Scope:** Sub-C of EPIC-04. New page at `/backoffice/fulfillment` listing orders grouped by `fulfillmentStatus`, filterable + sortable + paginated, with row multi-select and batch Pick / Pack actions.

## Goal

Warehouse staff land on one page that shows every order awaiting fulfillment action, default-filtered to `fulfillmentStatus = PENDING`. They can multi-select rows and trigger batch Pick / Pack, or click through to the per-order detail page for Ship (which needs a courier choice).

## Non-goals

- Replacing the existing `/backoffice/sales-orders` list (sub-B). That page stays as the marketplace-orders admin view filtered by Jubelio's `status` enum. The queue is a parallel view focused on warehouse workflow.
- Batch Ship. Ship requires per-row courier selection; outside scope.
- Inline editing of any column.
- Picking individual line items / qty corrections within an order — still a per-detail-page concern.
- Live polling / push updates. Page reload model, same as sub-B.

## 1. Route + nav

| Path | RBAC | Purpose |
|------|------|---------|
| `/backoffice/fulfillment` | `sales_orders:view` to load. `sales_orders:fulfill` required to use batch actions (hidden otherwise). | Paginated queue with filters + multi-select + batch. |

Nav: second child under the existing "Sales" parent group. Order: Sales Orders → Fulfillment.

The URL is intentionally top-level (`/backoffice/fulfillment`) rather than `/backoffice/sales-orders/fulfillment` to avoid the `[id]` precedence trick — Next.js `[id]` already catches anything not statically defined under `sales-orders/`.

## 2. URL state (search params)

| Param | Default | Values |
|-------|---------|--------|
| `fulfillmentStatus` | `PENDING` (default when missing) | `PENDING`, `PICKED`, `PACKED`, `SHIPPED`, `ALL` |
| `channel` | omitted = all | `SHOPEE`, `TOKOPEDIA`, `TIKTOK`, `OTHER` |
| `search` | omitted | free text — matches `salesorderNo` OR `customerName` `contains`, case-insensitive |
| `dateFrom` | omitted | ISO date (local-day start applied server-side) |
| `dateTo` | omitted | ISO date (local-day end applied server-side) |
| `sortField` | `transactionDate` | `transactionDate`, `salesorderNo`, `channel`, `fulfillmentStatus` |
| `sortDir` | `desc` for date, `asc` for others | `asc`, `desc` |
| `page` | `1` | int |
| `pageSize` | `10` | one of `[10, 25, 50, 100]` |

`fulfillmentStatus=ALL` shows every row regardless. Without the param, default is PENDING — landing on the page = "what needs my attention".

Row selection state is NOT in the URL. Selections live in client React state and reset on any filter change or page navigation.

## 3. List columns

```
[ ☐ ]  Order #  Channel    Buyer        Date              FulfillStatus   Jubelio
[ ☐ ]  TT-001   Tokopedia  A***ni       11 Jun, 10:30     PENDING         NEW
[ ☐ ]  SP-002   Shopee     B***di       11 Jun, 09:14     PICKED          PROCESSING
```

| Column | Source | Notes |
|--------|--------|-------|
| Checkbox | row selection state | Header checkbox toggles all current-page rows |
| Order # | `salesorderNo` | mono font, click → detail page |
| Channel | `channel` | badge (reuse `CHANNEL_BADGE`) |
| Buyer | `customerName ?? "—"` | truncate |
| Date | `transactionDate` | locale-formatted |
| FulfillStatus | `fulfillmentStatus` | badge (reuse `FULFILLMENT_STATUS_BADGE` from sub-B) |
| Jubelio | `status` | badge (reuse `STATUS_BADGE` from sub-B) |

Hide row when `status IN (CANCELLED, RETURNED)` AND default-filter is PENDING. They're effectively dead to fulfillment but selectable via `fulfillmentStatus=ALL`.

Row click anywhere outside the checkbox → detail page navigation, same UX as sub-B's row click.

## 4. Filter bar

Same grid layout pattern as sub-B sales-orders list, with the fulfillment-status filter taking the first slot (most-used):

```
[ Fulfillment status ▾ ]  [ Channel ▾ ]  [ Search by order # or buyer ]  [ From ] [ To ]  [ Reset ]
```

Fulfillment status options include `ALL` (no filter) as the first item — distinct from omitting the param, but UI-wise the default-when-empty behavior makes `PENDING` the implicit landing state.

Reset clears all params back to defaults (no fulfillmentStatus param = renders PENDING).

## 5. Batch actions

When ≥1 row selected, a sticky action bar appears at the top of the table area:

```
┌─────────────────────────────────────────────────────────────┐
│ 7 selected      [ Finish Pick ]  [ Finish Pack ]  [ Clear ] │
└─────────────────────────────────────────────────────────────┘
```

Both buttons require `sales_orders:fulfill` permission. Hidden when missing.

### 5.1 Batch Pick

Server action `batchFinishPickAction(orderIds: string[])`:

1. `requireFulfillSession()` (existing helper from sub-B).
2. Loop sequentially over `orderIds`:
   - Call `markOrderPicked(prisma, { orderId, userId })` — sub-A writer.
   - Catch `InvalidFulfillmentTransition` per row → bucket as `skipped`.
   - Re-throw other errors immediately (abort batch).
3. `revalidatePath("/backoffice/fulfillment")`.
4. Return `{ ok: N, skipped: M, errors: 0 }`.

Sequential because each call writes to DB + enqueues an outbox row in one transaction. Parallel would saturate the mariadb adapter's 10-connection pool again (lesson from courier sync). N=50 sequential calls × ~50ms = ~2.5s acceptable for warehouse batch.

Errors that aren't `InvalidFulfillmentTransition` (e.g. DB down, prisma type error) propagate and abort the batch. Client shows a destructive toast. Partial progress is committed because each row is its own transaction — already-processed rows stay processed.

### 5.2 Batch Pack

Same shape but calls `markOrderPacked`. Rows with `fulfillmentStatus ≠ PICKED` get `InvalidFulfillmentTransition` and bucket as skipped.

### 5.3 Client UX

On batch click:
- Disable buttons + show spinner.
- Await action result.
- Toast: "12 processed, 3 skipped" (or "12 processed" if skipped=0).
- Clear selection state.
- `router.refresh()` to repaint rows with new statuses.

## 6. Data layer

New server actions in `apps/web/app/actions/fulfillment-queue.ts`:

```ts
export type FulfillmentQueueRow = {
  id: string;
  salesorderNo: string;
  channel: SalesChannel;
  status: SalesOrderStatus;            // Jubelio-derived
  fulfillmentStatus: SalesOrderFulfillmentStatus;
  customerName: string | null;
  transactionDate: Date;
};

export async function listFulfillmentQueue(opts: {
  fulfillmentStatus?: SalesOrderFulfillmentStatus | "ALL";
  channel?: SalesChannel;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortField?: "transactionDate" | "salesorderNo" | "channel" | "fulfillmentStatus";
  sortDir?: "asc" | "desc";
  page: number;
  pageSize: number;
}): Promise<{ rows: FulfillmentQueueRow[]; totalCount: number }>;

export async function batchFinishPickAction(orderIds: string[]): Promise<BatchResult>;
export async function batchFinishPackAction(orderIds: string[]): Promise<BatchResult>;

type BatchResult = { processed: number; skipped: number };
```

`listFulfillmentQueue` runs `findMany` + `count` in parallel — same shape as sub-B's `listSalesOrders`. Decimal columns aren't returned (the queue doesn't show totals); skips the toString conversion the detail query needs.

Default `fulfillmentStatus` filter applied at action level when caller omits — keeps the "landing on page shows PENDING" behavior single-sourced. The page's `parseSearchParams` honors an explicit `ALL` from the URL.

`batchFinishPickAction` + `batchFinishPackAction` live in the same `fulfillment-queue.ts` (NOT in the existing `sales-order-fulfillment.ts`) because they're queue-specific and the two files together cover all fulfillment write paths cleanly.

`BatchResult` shape — final:

```ts
export type BatchResult =
  | { ok: true; processed: number; skipped: number }
  | { ok: false; reason: "forbidden" };
```

Forbidden returns a discriminable shape (no thrown message — same pattern as sub-B's `finishPickAction` from PR #48). The client maps `ok: false + reason: forbidden` to a destructive "Insufficient permissions" toast. Other unexpected errors (DB down, etc.) propagate as thrown exceptions and the client shows the generic networkError toast.

## 7. Permission check

Server page: `requirePermission(session.user.permissions, "sales_orders:view")`. Same gate as sub-B's list (already covered by `ROUTE_PERMISSIONS` proxy middleware if we add an entry).

Server actions: `authorize()` returns `{ ok: false, reason: "forbidden" }` for users without `sales_orders:fulfill`. UI hides batch buttons when `!canFulfill`, and the action itself rejects gracefully even if the button somehow renders.

The `canFulfill` boolean is computed once on the server page and passed to the client component.

`ROUTE_PERMISSIONS` map gets one new entry: `'/backoffice/fulfillment': 'sales_orders:view'`. `BACKOFFICE_ROUTES_ORDER` gets the entry near `/backoffice/sales-orders`.

## 8. i18n

New top-level namespace `fulfillmentQueue.*` in en + id. ~25 keys covering page title, filter labels, status filter options, table columns, empty states, batch bar, toasts.

Nav-level: `navigation.navFulfillment` ("Fulfillment" / "Pemenuhan").

## 9. Architecture summary

```
[Server page /backoffice/fulfillment]
        │
        ├── parseSearchParams → listFulfillmentQueue(filter, pagination)
        │
        └── compute canFulfill → pass to <FulfillmentQueueClient>
                                          │
                                          │ row clicks → /backoffice/sales-orders/[id]
                                          │ batch click → batchFinish{Pick,Pack}Action(ids)
                                          ▼
                                  [Server action]
                                          │
                                          │ for each id: markOrder{Picked,Packed}(prisma, ...)
                                          ▼
                                  [@elorae/db/sales-order-fulfillment-writer]
                                          │ inside $transaction:
                                          │   - update SalesOrder web cols
                                          │   - enqueue JubelioOutbox row
                                          ▼
                                  [Outbox poller — async, sub-A]
```

No changes to apps/api. No new schema. Pure apps/web feature on top of existing layers.

## 10. Testing

`apps/web/app/actions/fulfillment-queue.spec.ts`:

1. `listFulfillmentQueue` empty result.
2. Default fulfillmentStatus = PENDING when caller passes undefined.
3. `fulfillmentStatus=ALL` skips the column filter.
4. Date range translates to `transactionDate.gte/lte`.
5. Sort field + direction passed to `orderBy`.
6. Search builds OR clause on salesorderNo + customerName.
7. `batchFinishPickAction` happy path: 3 PENDING orders → 3 processed, 0 skipped.
8. `batchFinishPickAction` mixed state: 2 PENDING + 1 already-PICKED → 2 processed, 1 skipped, no throw.
9. `batchFinishPickAction` permission denied → returns `{ ok: false, reason: "forbidden" }`; writer helper never called.
10. Same shape for `batchFinishPackAction`.

No UI render tests (per sub-B precedent — too brittle, low ROI).

Manual smoke (post-merge, no Jubelio touch):
- Load `/backoffice/fulfillment`. Default shows PENDING rows.
- Select 3 rows. Click Finish Pick. Toast "3 processed". Page refreshes — those rows now PICKED. With filter still on PENDING, they disappear from the list. Switch to PICKED filter — they appear there.
- Select a mix of PENDING + PICKED rows. Click Finish Pick. Toast "1 processed, 2 skipped". Only the PENDING row advances.
- Switch to `sales_orders:view`-only user. Batch buttons hidden. Page still loads.

## 11. Open questions

None blocking.

## 12. Decisions log

| Decision | Resolution |
|----------|------------|
| Where the queue lives | New page `/backoffice/fulfillment`. Sub-B's list stays Jubelio-status-focused. |
| Default landing filter | `fulfillmentStatus=PENDING` when param missing. URL-explicit `ALL` overrides. |
| Batch actions | Pick + Pack. Ship excluded (per-row courier). |
| Mixed-status batch | Process matching rows, skip others, toast `N processed, M skipped`. |
| Batch concurrency | Sequential per-order writer calls. Avoids 10-conn mariadb pool exhaustion. |
| Permission for batch | `sales_orders:fulfill`. View-only users see the page but no batch buttons. |
| Row click | Anywhere outside checkbox navigates to `/backoffice/sales-orders/[id]`. |
| Schema changes | None. Pure UI + query layer over sub-A schema. |

## 13. Out-of-scope follow-ups

- Sub-D: print views (pick list, packing slip) + manual "Sync couriers" admin button (already deferred from sub-B + sub-courier).
- Sub-A-followup: `isAlreadyInStateError` fix once observed in live Jubelio response.
- Batch Ship with default courier per order. Needs a `defaultCourierId` column or per-channel-default lookup — separate effort.
