# Marketplace KPI Widgets — Design

**Status:** Draft → review
**Date:** 2026-06-11
**Scope:** Sub-C of the Sales Orders feature. Two KPI cards on `/backoffice/dashboard` (beranda): "Pending Fulfillment" (count) and "Today's Sales" (IDR total + order count). Reads from `SalesOrder` (sub-A).

## Goal

Operations admins see at-a-glance health of the marketplace order stream the moment they land on beranda: how many orders need to be packed/shipped, and how much revenue today has booked.

## Non-goals

- Live polling. Page reload is the refresh model. Beranda already declares `dynamic = "force-dynamic"` — every navigation re-queries.
- New nav entries. The widgets live inside the existing dashboard page.
- Drill-down click-through to a filtered list. Cards are display-only; users navigate to `/backoffice/sales-orders` themselves if they want details.
- Per-channel breakdown. Aggregate across all channels.
- Comparison metrics (vs yesterday, vs last week). Pure current-state.

## 1. Metric definitions

### 1.1 Pending Fulfillment

```sql
SELECT COUNT(*) FROM "SalesOrder" WHERE status IN ('NEW', 'PROCESSING')
```

Definition: orders that have been accepted but not yet shipped. Excludes `SHIPPED` (warehouse done), `COMPLETED`, `CANCELLED`, `RETURNED`. This matches the warehouse-team meaning of "still needs pack/ship work".

`status` is the derived enum maintained by sub-A's `SalesOrderWebhookHandler` (`apps/api/src/jubelio/handlers/_shared/status-derive.ts`). It is the source of truth — no need to re-evaluate raw fields here.

### 1.2 Today's Sales

Two sub-metrics, both bound to `transactionDate` in the user's local day:

- **Total revenue**: `SUM(grandTotal)` where `transactionDate >= local-today-00:00 AND <= local-today-23:59:59.999 AND status NOT IN ('CANCELLED', 'RETURNED')`.
- **Order count**: `COUNT(*)` with the same filter.

"Local-day" boundaries follow the existing dashboard convention at `apps/web/lib/dashboard/queries.ts` — `new Date()` then `setHours(0, 0, 0, 0)` for the start, `setHours(23, 59, 59, 999)` for the end. This trusts the server's local timezone (production should set `TZ=Asia/Jakarta`). Any drift from a UTC-default deploy environment is a pre-existing dashboard concern, not introduced here — fixing it would be a separate effort across all dashboard queries.

Cancelled and returned orders are excluded so the number doesn't fluctuate downward as buyers cancel through the day. Includes pending/processing/shipped/completed — those are all "money the seller has booked".

## 2. Data layer

Add one new function to `apps/web/lib/sales-orders/queries.ts`:

```ts
export type MarketplaceKpi = {
  pendingFulfillmentCount: number;
  todaySalesCount: number;
  todaySalesTotal: string; // IDR, serialised at the query boundary
};

export async function getMarketplaceKpi(): Promise<MarketplaceKpi>;
```

Implementation uses two parallel queries:

```ts
const [pending, todayAgg] = await Promise.all([
  prisma.salesOrder.count({
    where: { status: { in: ["NEW", "PROCESSING"] } },
  }),
  prisma.salesOrder.aggregate({
    where: {
      transactionDate: { gte: startOfToday, lte: endOfToday },
      status: { notIn: ["CANCELLED", "RETURNED"] },
    },
    _count: { _all: true },
    _sum: { grandTotal: true },
  }),
]);
```

Return shape converts the `_sum.grandTotal` Decimal to a string at the boundary (sum may be null when no orders → fall back to `"0"`).

The two queries run in parallel inside the same beranda `Promise.all` block that already fetches other dashboard stats — no extra latency.

## 3. Beranda integration

### 3.1 Server changes

`apps/web/app/backoffice/dashboard/page.tsx`:

- Import `getMarketplaceKpi` from `@/lib/sales-orders/queries`.
- Add it to the existing `Promise.all([...])` array.
- Pass `marketplaceKpi` as a new prop to `DashboardPageClient`.

### 3.2 Client changes

`apps/web/app/backoffice/dashboard/DashboardPageClient.tsx`:

- Accept `marketplaceKpi: MarketplaceKpi` in the props type.
- Render a new "Marketplace" section ABOVE the existing "Stats Grid" (`grid gap-4 sm:grid-cols-2 lg:grid-cols-5` at ~line 487). Two cards in a `sm:grid-cols-2` grid.

The new section sits between the page heading and the existing stats grid because the marketplace KPIs are time-sensitive (today's activity) and warrant top-of-page real estate.

### 3.3 Card layout

Each card uses the existing dashboard card pattern, with a small info icon next to the title that shows a tooltip on hover/focus explaining what the metric counts:

```
┌─────────────────────────────────┐
│ Pending Fulfillment (i)  📦     │  ← title + info icon + section icon
├─────────────────────────────────┤
│ 42                              │  ← big number
│ Orders awaiting pack/ship       │  ← description
└─────────────────────────────────┘
```

For Today's Sales:

```
┌─────────────────────────────────┐
│ Today's Sales (i)        🛒     │
├─────────────────────────────────┤
│ Rp 12.450.000                   │  ← big number (IDR total)
│ 7 orders today                  │  ← description (count)
└─────────────────────────────────┘
```

**Tooltips (criteria):**

- Pending Fulfillment: `"Orders with status New or Processing. Excludes shipped, completed, cancelled, and returned."`
- Today's Sales: `"Orders placed today (by transaction date). Excludes cancelled and returned. Includes pending, processing, shipped, and completed."`

Implementation: shadcn `<Tooltip>` (`apps/web/components/ui/tooltip.tsx` — Radix-based, already in the project). Wrap a small `<Info className="h-3.5 w-3.5 text-muted-foreground" />` icon (lucide-react) as the `<TooltipTrigger>`. Mounted inside `<TooltipProvider>` (one provider can wrap both cards; or the existing dashboard provider if one already exists higher up).

Tooltip content is i18n-translated (see §5). Cards stay non-interactive otherwise — no click handler.

Icons (section header): `Package` for pending, `Store` for today's sales. Both already imported in the dashboard chunk or elsewhere — re-use existing imports where possible to keep the new import surface tiny.

## 4. RBAC

Gated by the existing dashboard-page access. No new permission. Same precedent as `inventoryValue` and other aggregate KPIs on beranda — viewing a count or total isn't row-level data exposure.

Users without `sales_orders:view` still see the two cards. If that becomes a policy concern later, gate the section client-side with `hasPermission(permissions, "sales_orders:view")` — but YAGNI for v1.

## 5. i18n

New keys in the existing `dashboard` namespace (both `en.json` and `id.json`):

| Key | en | id |
|-----|----|----|
| `dashboard.marketplaceSection` | Marketplace | Marketplace |
| `dashboard.pendingFulfillmentTitle` | Pending Fulfillment | Belum Dikirim |
| `dashboard.pendingFulfillmentDesc` | Orders awaiting pack/ship | Pesanan menunggu pengepakan/pengiriman |
| `dashboard.pendingFulfillmentTooltip` | Orders with status New or Processing. Excludes shipped, completed, cancelled, and returned. | Pesanan dengan status Baru atau Diproses. Tidak termasuk yang sudah dikirim, selesai, dibatalkan, atau dikembalikan. |
| `dashboard.todaySalesTitle` | Today's Sales | Penjualan Hari Ini |
| `dashboard.todaySalesCount` | `{count, plural, one {# order today} other {# orders today}}` | `{count, plural, other {# pesanan hari ini}}` |
| `dashboard.todaySalesTooltip` | Orders placed today (by transaction date). Excludes cancelled and returned. Includes pending, processing, shipped, and completed. | Pesanan yang dibuat hari ini (berdasarkan tanggal transaksi). Tidak termasuk yang dibatalkan atau dikembalikan. Termasuk baru, diproses, dikirim, dan selesai. |

The `todaySalesCount` uses ICU plural for the English copy; Indonesian has no plural distinction so it stays singular form in the `other` bucket.

## 6. Testing

`apps/web/lib/sales-orders/queries.test.ts` extension:

1. `getMarketplaceKpi` empty DB → `{ pendingFulfillmentCount: 0, todaySalesCount: 0, todaySalesTotal: "0" }`.
2. Mock `prisma.salesOrder.count` returning 3 and `aggregate` returning `{ _count: { _all: 2 }, _sum: { grandTotal: { toString: () => "150000" } } }` → assert the shape `{ 3, 2, "150000" }`.
3. `_sum.grandTotal === null` (no rows match) → returned `todaySalesTotal === "0"`.
4. Verify the `where` clause shapes: pending uses `{ status: { in: ["NEW", "PROCESSING"] } }`; today uses `{ transactionDate: { gte, lte }, status: { notIn: ["CANCELLED", "RETURNED"] } }` with the date bounds spanning a single local day.

No snapshot tests for the dashboard JSX — too brittle given DashboardPageClient is 1198 lines and changes often.

Manual smoke after merge:
- Trigger a webhook → arrives as `NEW`. Beranda's "Pending Fulfillment" increments on reload.
- Cancel that order in Jubelio → next webhook flips it to `CANCELLED`. Pending count decrements; "Today's Sales" total drops.
- Settle an order → moves to `COMPLETED`. Pending count drops, today's-sales total unchanged (still counted because not cancelled/returned).

## 7. Out of scope (deferred)

- Channel breakdown (Shopee X, Tokopedia Y, TikTok Z) inside each card.
- Comparison vs yesterday (% delta arrows).
- Click-through to filtered list.
- Live auto-refresh (polling or SSE).
- Time-of-day filter ("last hour").

## 8. Decisions log

| Decision | Resolution |
|----------|------------|
| Pending Fulfillment def | `status IN (NEW, PROCESSING)`. Tightest meaning of "still needs pack/ship". |
| Today's Sales def | `transactionDate today + status NOT IN (CANCELLED, RETURNED)`. Total revenue + order count. Includes pending/shipped/completed so the number doesn't lurch down on cancellations. |
| Refresh | Manual reload only. Beranda is `force-dynamic`. |
| Placement | New "Marketplace" section ABOVE existing 5-col stats grid. Doesn't squeeze existing cards. |
| RBAC | Existing `dashboard:view` gate. No new permission. Aggregate KPI, no row exposure. |
| Click-through | None. Display-only cards. |
| Tooltip on metric definition | Info icon next to each card title with hover/focus tooltip listing the included/excluded statuses. i18n-translated. |
| Channel breakdown | Out of scope. Single aggregate per metric. |
