# Marketplace Sales Order Dashboard — Design

**Status:** Draft → review
**Date:** 2026-06-11
**Scope:** Sub-B of the Sales Orders feature. Pure `apps/web` UI on top of the `SalesOrder` + `SalesOrderItem` tables persisted by sub-A. Adds two routes: a paginated list with filters + a per-order detail view.

## Goal

Operations staff can browse marketplace orders in the ERP UI, filter by channel/status/date, find an order by number or buyer name, and click through to a detail page showing line items, fee breakdown, buyer + shipping snapshot, and raw Jubelio statuses.

## Non-goals

- KPI widgets on beranda — Sub-C.
- Editing or refunding orders from the UI — read-only.
- Live polling. The list reloads on user action; no background refresh.
- Bulk actions, exports, CSV downloads.
- Server-side push-back to Jubelio. Web never writes to `SalesOrder` per BOUNDARY §3.2.

## 1. Routes

| Path | RBAC | Purpose |
|------|------|---------|
| `/backoffice/sales-orders` | `sales_orders:view` | Paginated list + filters + search. |
| `/backoffice/sales-orders/[id]` | `sales_orders:view` | Per-order detail. `[id]` is `SalesOrder.id` (cuid). |

URL state for the list (search params): `search`, `channel`, `status`, `dateFrom`, `dateTo`, `page`. Back/forward navigation preserves the view.

## 2. Architecture

Follows the existing list-page pattern (`/backoffice/items`, `/backoffice/purchase-orders`):

```
app/backoffice/sales-orders/
  page.tsx                          # server: auth + RBAC + parse searchParams + query
  SalesOrdersPageClient.tsx         # client: filter bar, table, pagination
  [id]/
    page.tsx                        # server: auth + RBAC + load order + items
    SalesOrderDetailClient.tsx      # client: rendering only, no data fetch
```

Server components run all DB queries. Client components are presentational and handle URL-search-param mutations through `useRouter().push()` (no useState for filter values — URL is the truth). This matches the items page and gives us shareable links + back-button correctness for free.

Data access lives in `lib/sales-orders/queries.ts` (new). Pure functions taking `{ search, channel, status, dateFrom, dateTo }` + `{ page, pageSize }`, returning `{ orders, totalCount }`. Tested with vitest against a mocked `prisma` (matches sub-5 server-action pattern).

## 3. List page

### 3.1 Filter bar

Top of the page, single row:

- **Search input** — text, debounced 300ms client-side. Server matches case-insensitive `contains` against `salesorderNo` OR `customerName` (Prisma `OR`). Empty string = no filter.
- **Channel select** — `All | Shopee | Tokopedia | TikTok | Other`. Backed by the `SalesChannel` enum imported from `@/lib/constants/enums` (NOT `@elorae/db` — client component, per `feedback_client_db_imports`).
- **Status select** — `All | New | Processing | Shipped | Completed | Cancelled | Returned`. `SalesOrderStatus` enum, same import path.
- **Date range** — shadcn `date-range-picker.tsx`. Filters `transactionDate` `>= dateFrom` and `<= dateTo`. Either bound is optional.
- **Reset button** — clears all params, returns to `/backoffice/sales-orders`.

Each control writes to URL search params on change. The server re-runs the query on the next navigation. No client-side fetching beyond the debounce.

### 3.2 Table

Columns (left → right):

| Column | Source | Format |
|--------|--------|--------|
| Order # | `salesorderNo` | Monospaced; copies on click (existing copy-to-clipboard helper) |
| Channel | `channel` | Coloured badge (`SHOPEE` orange, `TOKOPEDIA` green, `TIKTOK` black, `OTHER` grey) |
| Buyer | `customerName ?? "—"` | Truncate at ~24 chars |
| Total | `grandTotal` | IDR thousand-separated |
| Status | `status` | Badge (`COMPLETED` green, `CANCELLED` red, `SHIPPED` blue, `PROCESSING` amber, `NEW` neutral, `RETURNED` purple) |
| Date | `transactionDate` | Locale-formatted `dd MMM yyyy, HH:mm` |

Row click → `/backoffice/sales-orders/[id]` (Next `<Link>`).

Default sort: `transactionDate DESC`. No column-click sorting in v1 — fixed default is enough until the user asks for more.

Empty states:
- No orders at all → "No marketplace orders yet — orders appear here as Jubelio webhooks arrive."
- No orders matching filter → "No orders match these filters." + "Clear filters" button.

### 3.3 Pagination

Server-side, offset-based via `page` search param. `DEFAULT_PAGE_SIZE` from `@/lib/constants/pagination` (the same 20 used by items). Footer renders the existing `Pager` component (`components/Pager.tsx`).

Total count is a `prisma.salesOrder.count()` with the same `where` clause. Yes that's 2 queries — same as items page; not optimising until it bites.

## 4. Detail page (`/backoffice/sales-orders/[id]`)

Single column on mobile, two-column on desktop (≥1024px):

```
┌────────────────────────────────────────────────────────────┐
│ Header strip                                               │
│   Back to list • Order # • Channel badge • Status badge    │
└────────────────────────────────────────────────────────────┘
┌──────────────────────────────┐ ┌─────────────────────────┐
│ Buyer card                   │ │ Order meta card         │
│  - name / phone / email      │ │  - transactionDate      │
│  - shipping address (Json)   │ │  - paymentMethod        │
│                              │ │  - paymentDate          │
│                              │ │  - courier + trackingNo │
└──────────────────────────────┘ └─────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│ Line items table                                           │
│   SKU • Product • Qty • Unit price • Disc • Line total     │
│   (one row per SalesOrderItem)                             │
└────────────────────────────────────────────────────────────┘
┌──────────────────────────────┐ ┌─────────────────────────┐
│ Totals card                  │ │ Raw status card         │
│  subTotal                    │ │  channelStatus          │
│  totalDisc                   │ │  internalStatus         │
│  totalTax                    │ │  wmsStatus              │
│  shippingCost                │ │  isCanceled / isPaid    │
│  ─────────                   │ │  markedAsComplete       │
│  grandTotal (bold)           │ │                         │
└──────────────────────────────┘ └─────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│ Fee breakdown card                                         │
│   one row per non-zero key in `feeBreakdown` Json          │
│   (i18n label, IDR amount)                                 │
│   (collapsed by default if all values zero or null)        │
└────────────────────────────────────────────────────────────┘
```

Each card is shadcn `<Card>` with a heading. Line items render as a borderless table inside the card.

Shipping address rendered as a multi-line block from the JSON: `full_name / phone / address / city / province / post_code / country`. Missing fields skipped, no "N/A" filler.

Line item rows show `productName` (denormalised), with the `itemId` link wired through to `/backoffice/items/[id]` when present. When `itemId` is null (catalog not synced yet), the row shows only the SKU+name (read-only).

No actions on this page. No edit, no refund, no manual status change. Backout link only.

## 5. Channel + status badge palette

Centralised in `lib/sales-orders/badges.ts` (new), keyed by enum value. One source of truth for both list table and detail header strip.

```ts
export const CHANNEL_BADGE = {
  SHOPEE:    { label: "Shopee",    variant: "shopee"    },
  TOKOPEDIA: { label: "Tokopedia", variant: "tokopedia" },
  TIKTOK:    { label: "TikTok",    variant: "tiktok"    },
  OTHER:     { label: "Other",     variant: "neutral"   },
} as const;

export const STATUS_BADGE = {
  NEW:        { variant: "neutral" },
  PROCESSING: { variant: "amber"   },
  SHIPPED:    { variant: "blue"    },
  COMPLETED:  { variant: "green"   },
  CANCELLED:  { variant: "red"     },
  RETURNED:   { variant: "purple"  },
} as const;
```

`variant` keys map to Tailwind classes inside the existing shadcn `<Badge>` wrapper. New variants added there (only the colours not yet defined).

## 6. Data layer

`apps/web/lib/sales-orders/queries.ts`:

```ts
export type SalesOrderListFilter = {
  search?: string;
  channel?: SalesChannel;
  status?: SalesOrderStatus;
  dateFrom?: Date;
  dateTo?: Date;
};

export async function listSalesOrders(
  filter: SalesOrderListFilter,
  pagination: { page: number; pageSize: number },
): Promise<{ orders: SalesOrderListRow[]; totalCount: number }>;

export async function getSalesOrderById(
  id: string,
): Promise<{ order: SalesOrderDetail; items: SalesOrderItem[] } | null>;
```

`SalesOrderListRow` is a `Pick` of `SalesOrder` with only the columns the table shows — keeps the row payload small. `SalesOrderDetail` is the full row.

Cross-boundary serialisation contract: `queries.ts` returns Decimal columns as `string` (via `.toString()` at the query layer) so the client never sees `Decimal.js` instances. Dates stay as `Date` — Next.js 16 RSC serialisation reconstructs Date objects on the client side. JSON columns (`shippingAddress`, `feeBreakdown`) come through as plain objects. Net effect: client components depend only on built-in types + the locally-mirrored enum literals from `@/lib/constants/enums`.

## 7. i18n

New keys in `apps/web/lib/i18n/messages/en.json` and `id.json`:

- `nav.salesOrders` — sidebar entry
- `salesOrders.title`, `salesOrders.subtitle`, `salesOrders.empty`, `salesOrders.emptyFiltered`
- `salesOrders.filter.search.placeholder`, `salesOrders.filter.channel`, `salesOrders.filter.status`, `salesOrders.filter.dateRange`, `salesOrders.filter.reset`
- `salesOrders.table.col.*` for the 6 column headers
- `salesOrders.detail.section.*` for the 6 card titles (Buyer, Order meta, Line items, Totals, Raw status, Fee breakdown)
- `salesOrders.detail.field.*` for every individual field label
- `salesOrders.channel.*` and `salesOrders.status.*` for badge labels (matches existing badge i18n in other modules)
- `salesOrders.fee.*` for the 10 known feeBreakdown keys (insurance_cost, service_fee, ...)

Indonesian strings are first-class — not English fallbacks. The existing i18n setup has both files always in sync.

## 8. Nav + RBAC wiring

- `apps/web/app/backoffice/BackofficeShell.tsx` — add a new nav entry under the "Sales" group (creating the group if it doesn't exist) pointing to `/backoffice/sales-orders` with the `sales_orders:view` gate.
- `apps/web/lib/rbac.ts` — add `SALES_ORDERS_VIEW = "sales_orders:view"` to the `PERMISSIONS` const + `/backoffice/sales-orders → sales_orders:view` + `/backoffice/sales-orders/[id] → sales_orders:view` to `ROUTE_PERMISSIONS` + insert the route into `BACKOFFICE_ROUTES_ORDER` (after `audit-trail` is fine).
- `packages/db/prisma/seed.ts` — add `{ code: "sales_orders:view", module: "sales_orders", action: "view", description: "View marketplace sales orders" }` and assign it to the roles currently holding `items:view` (i.e. anyone with general read access).

The user runs `pnpm -F @elorae/db seed` after merge to populate prod (or assigns manually via the RBAC admin UI).

## 9. Client component constraint

Per the `feedback_client_db_imports` memory: client components MUST NOT import from `@elorae/db`. The `SalesChannel` and `SalesOrderStatus` literals need a client-safe source. Add them to `apps/web/lib/constants/enums.ts`:

```ts
export const SALES_CHANNEL_VALUES = ["SHOPEE", "TOKOPEDIA", "TIKTOK", "OTHER"] as const;
export type SalesChannelLiteral = (typeof SALES_CHANNEL_VALUES)[number];

export const SALES_ORDER_STATUS_VALUES = ["NEW", "PROCESSING", "SHIPPED", "COMPLETED", "CANCELLED", "RETURNED"] as const;
export type SalesOrderStatusLiteral = (typeof SALES_ORDER_STATUS_VALUES)[number];
```

Server components import from `@elorae/db` directly; client components import from `@/lib/constants/enums`. The Prisma values stay the source of truth — the constants file is a manually-mirrored alias, validated at the queries-file boundary.

## 10. Testing

- `lib/sales-orders/queries.spec.ts` (vitest) covers the query helpers:
  - Filter shape: search empty → no `OR` clause. Search set → OR over salesorderNo + customerName.
  - Channel / status filter → translates to `where.channel` / `where.status`.
  - Date bounds applied to `transactionDate`.
  - Pagination → correct `skip` + `take`.
  - `getSalesOrderById` returns null for unknown id.
- `lib/sales-orders/badges.spec.ts` — pure mapping tables; one assertion per enum value to guard against silent rename.
- Snapshot or render test of the list page is overkill. Skip — no logic in the JSX worth asserting.
- Manual smoke: real Jubelio order present in DB after sub-A merge → list shows it → detail page shows lines + fees correctly. Verifies the cross-boundary serialisation works (Decimal → string).

## 11. Out of scope (deferred to follow-ups)

- Column-click sorting on the list.
- Saved filter presets.
- Order export (CSV/PDF).
- Per-item drill-down beyond the existing `/backoffice/items/[id]` link.
- Live polling. Beranda KPI (Sub-C) is the real-time surface.

## 12. Decisions log

| Decision | Resolution |
|----------|------------|
| Detail UX | Route page `/backoffice/sales-orders/[id]`. Deep-linkable, back-button works, matches other backoffice patterns. |
| RBAC | New `sales_orders:view` permission. Adds enum const + route map + seed entry. |
| Search field | salesorderNo + customerName (case-insensitive contains). One input, debounced 300ms. |
| Default sort | `transactionDate DESC`. No column-click sort in v1. |
| Filter state | URL search params (no client useState). Shareable links + back-button correctness. |
| Pagination | Server-side offset, `page` param, `DEFAULT_PAGE_SIZE = 20` (matches items). |
| Live updates | No polling. Manual refresh / next nav. Sub-C handles real-time KPI. |
| Client `@elorae/db` import | Forbidden by `feedback_client_db_imports`. Enum literals duplicated in `lib/constants/enums.ts`. |
