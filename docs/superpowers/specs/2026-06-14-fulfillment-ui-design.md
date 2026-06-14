# Fulfillment UI — Design

**Status:** Draft → review
**Date:** 2026-06-14
**Scope:** Sub-B of EPIC-04. UI action buttons (Finish Pick / Finish Pack / Ship) on the order detail page, server actions that call sub-A's writer helpers, and a small `JubelioCourier` table that backs the Ship courier dropdown.

## Goal

Warehouse staff can drive an order through Pick → Pack → Ship from inside Elorae. Each click writes to `SalesOrder` (web-owned fulfillment columns) and enqueues a `JubelioOutbox` row that pushes the status to Jubelio. The detail page exposes the current `fulfillmentStatus`, the audit timeline (when + by whom), and exactly one state-aware action button.

## Non-goals

- Live Jubelio smoke. Sub-B ships with unit-tested server actions only. First real run will reveal Jubelio's actual `isAlreadyInStateError` shape; the handler helpers in sub-A get a fix-forward commit at that point. Not part of this PR.
- Print views (pick list, packing slip). Deferred to a small sub-D follow-up.
- Fulfillment Queue page at `/backoffice/sales-orders` with filters by fulfillmentStatus + batch actions. Sub-C.
- Multi-location courier handling. `JubelioCourier` is global; per-location courier subsets are a future concern.
- Reverse transitions (un-pick / un-pack). Sub-A's state machine is forward-only; UI matches.

## 1. Detail page changes

### 1.1 New Fulfillment Card

Adds a new shadcn `<Card>` to `apps/web/app/backoffice/sales-orders/[id]/SalesOrderDetailClient.tsx`, placed BETWEEN the order header strip and the existing two-column "buyer / order meta" cards.

Layout:

```
┌─────────────────────────────────────────────────────────┐
│ Fulfillment                                              │
├─────────────────────────────────────────────────────────┤
│ Status: [PENDING badge]                                  │
│                                                          │
│ Timeline:                                                │
│   Picked:    — / by —                                    │
│   Packed:    — / by —                                    │
│   Shipped:   — / by —                                    │
│                                                          │
│ Tracking:    — (filled by sub-A webhook when Jubelio     │
│              relays the AWB)                             │
│                                                          │
│ [ Finish Pick ]   ← only the action matching current     │
│                     fulfillmentStatus shows              │
└─────────────────────────────────────────────────────────┘
```

State machine drives which action renders:

| `fulfillmentStatus` | Button shown |
|---------------------|--------------|
| `PENDING` | `Finish Pick` |
| `PICKED` | `Finish Pack` |
| `PACKED` | Courier `<Select>` + `Ship` button (confirm dialog before commit) |
| `SHIPPED` | No button. Display "Shipped at … by …" only. |
| Any state when `status IN (CANCELLED, RETURNED)` | No button. Banner "Cancelled — fulfillment locked." |

Audit-timeline rows only render with values once their `*At` field is non-null. Until then the row shows "—".

When `pickedById` is set, look up the user via Prisma and display their name. The detail page server component pre-resolves these (one `prisma.user.findMany` with the ID set), so the client gets `pickedByName` etc. inline.

### 1.2 Status badge palette

New colours via the existing `STATUS_BADGE` pattern in `apps/web/lib/sales-orders/badges.ts` — extend with `FULFILLMENT_STATUS_BADGE`:

```ts
export const FULFILLMENT_STATUS_BADGE = {
  PENDING: { tailwindClass: "..." },   // grey
  PICKED:  { tailwindClass: "..." },   // amber
  PACKED:  { tailwindClass: "..." },   // blue
  SHIPPED: { tailwindClass: "..." },   // green
} as const;
```

Reuses the same Tailwind palette family as the existing sub-B sales-orders badges.

### 1.3 Ship button confirmation

Only the Ship action gets a confirmation dialog (shadcn `<AlertDialog>`):

> "Ship order {salesorderNo} with {courier_name}?
> Jubelio will request the AWB from the courier. This action cannot be undone."

Pick and Pack fire directly on click. They're individually reversible at the warehouse level (re-pick later if mis-counted) but not at the Jubelio side — the state-machine guard in sub-A's writer helper means double-click is a no-op anyway.

## 2. Courier list

### 2.1 `JubelioCourier` table

```prisma
model JubelioCourier {
  id           Int      @id   // Jubelio's courier_new_id
  name         String
  syncedAt     DateTime
  updatedAt    DateTime @updatedAt

  @@index([name])
}
```

Stores all couriers Jubelio knows about. Tiny (~56 rows). One migration.

### 2.2 Sync action

The Jubelio API call lives on apps/api (web never calls Jubelio directly). Web uses the existing `@/lib/internal-api` `apiFetch` channel (signed via shared `INTERNAL_API_SECRET`) to ask apps/api to refresh the cache.

**apps/api side** — new controller `apps/api/src/jubelio/couriers/couriers.controller.ts`:

```
POST /jubelio/couriers/sync
```

Calls `JubelioHttpService.get('/wms/couriers')`, then upserts each `{ courier_id, courier_name }` row into `JubelioCourier`. Rows present locally but missing from Jubelio's latest response are deleted. Stamps `syncedAt = now()`. Returns `{ count: number }`.

**apps/web side** — server action `syncJubelioCouriers()` in `apps/web/app/actions/jubelio-couriers.ts` wraps:

```ts
import { apiFetch } from "@/lib/internal-api";
const r = await apiFetch<{ count: number }>("POST", "/jubelio/couriers/sync", {});
```

Idempotent. Re-runs replace the table content cleanly.

### 2.3 Lazy-populate on first need

When the Ship dialog opens, the server component first reads `JubelioCourier.count()`. If 0 → kick off `syncJubelioCouriers()` server-side, await, then return the populated list. Otherwise serve the cached list directly.

This avoids a hard prerequisite step ("you must sync couriers before first ship"). User just clicks Ship and it works.

### 2.4 Manual refresh

Out of scope for sub-B. If staleness becomes an issue, a future sub-D adds a "Sync couriers" button on `/backoffice/jubelio/admin`.

## 3. Server actions

New file `apps/web/app/actions/sales-order-fulfillment.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import {
  markOrderPicked,
  markOrderPacked,
  markOrderShipped,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";

type ActionResult = { ok: true } | { ok: false; reason: string };

export async function finishPickAction(orderId: string): Promise<ActionResult>;
export async function finishPackAction(orderId: string): Promise<ActionResult>;
export async function shipOrderAction(orderId: string, courierId: number): Promise<ActionResult>;
export async function getCouriersForShipDialog(): Promise<Array<{ id: number; name: string }>>;
```

Each fulfillment action:

1. `requirePermission(session, "sales_orders:fulfill")` — 403 to UI if missing.
2. Calls the corresponding writer helper. Catches `InvalidFulfillmentTransition` → returns `{ ok: false, reason }`.
3. On success: `revalidatePath('/backoffice/sales-orders/' + orderId)` so the detail page reflects new state on refresh.
4. Returns `{ ok: true }` so the client can show a toast.

`getCouriersForShipDialog` does the lazy-populate logic from §2.3 then returns the rows.

### 3.1 Error UX

Client wraps each action in a try/catch + toast. The existing `sonner` toaster in the project handles display.

Examples:
- `{ ok: false, reason: "Order so1 fulfillmentStatus is PICKED, expected PENDING" }` → toast warning "Already picked. Refresh the page."
- Network error → toast destructive "Couldn't reach server. Try again."

Permission denied (`403`) → toast destructive "Insufficient permissions".

## 4. queries.ts extension

`apps/web/lib/sales-orders/queries.ts` `SalesOrderDetail` type and `getSalesOrderById` need to include the new fulfillment columns:

```ts
export type SalesOrderDetail = {
  // ... existing fields ...
  fulfillmentStatus: SalesOrderFulfillmentStatusLiteral; // new client-safe literal
  pickedAt: Date | null;
  pickedById: string | null;
  pickedByName: string | null;    // resolved from User table
  packedAt: Date | null;
  packedById: string | null;
  packedByName: string | null;
  shippedAt: Date | null;
  shippedById: string | null;
  shippedByName: string | null;
  courierId: number | null;
  courierName: string | null;     // joined from JubelioCourier
  shipmentJubelioId: number | null;
};
```

`SalesOrderFulfillmentStatusLiteral` lives in `apps/web/lib/constants/enums.ts` (matching the sub-A enum), to keep client components free of `@elorae/db`.

Query side: `getSalesOrderById` does a parallel `prisma.user.findMany({ where: { id: { in: distinctIds } } })` for the three `*ById` columns + a `prisma.jubelioCourier.findUnique` for `courierId`. Resolved values get folded in before returning.

## 5. RBAC

New permission `sales_orders:fulfill` registered in:

- `apps/web/lib/rbac.ts` — `PERMISSIONS.SALES_ORDERS_FULFILL`. Not added to `ROUTE_PERMISSIONS` — checked at action-call time, not at route load.
- `packages/db/prisma/seed.ts` — granted to PURCHASER + WAREHOUSE + PRODUCTION (warehouse-adjacent roles). Office/admin support roles intentionally do not get it.

The detail page itself stays gated by the existing `sales_orders:view` from sub-B. Users who can view can READ the audit timeline; only those with `:fulfill` can click the buttons. UI hides the buttons when permission missing.

## 6. i18n keys

New keys in the existing `salesOrders` namespace (en + id):

| Key | en | id |
|-----|----|----|
| `salesOrders.fulfillment.section` | Fulfillment | Pemenuhan |
| `salesOrders.fulfillment.status` | Status | Status |
| `salesOrders.fulfillment.status.PENDING` | Pending | Menunggu |
| `salesOrders.fulfillment.status.PICKED` | Picked | Sudah diambil |
| `salesOrders.fulfillment.status.PACKED` | Packed | Sudah dikemas |
| `salesOrders.fulfillment.status.SHIPPED` | Shipped | Sudah dikirim |
| `salesOrders.fulfillment.timeline` | Timeline | Linimasa |
| `salesOrders.fulfillment.timeline.picked` | Picked | Diambil |
| `salesOrders.fulfillment.timeline.packed` | Packed | Dikemas |
| `salesOrders.fulfillment.timeline.shipped` | Shipped | Dikirim |
| `salesOrders.fulfillment.tracking` | Tracking | No. Resi |
| `salesOrders.fulfillment.action.finishPick` | Finish Pick | Selesai Pick |
| `salesOrders.fulfillment.action.finishPack` | Finish Pack | Selesai Pack |
| `salesOrders.fulfillment.action.ship` | Ship | Kirim |
| `salesOrders.fulfillment.action.courier` | Courier | Kurir |
| `salesOrders.fulfillment.action.courierPlaceholder` | Select courier… | Pilih kurir… |
| `salesOrders.fulfillment.action.shipConfirmTitle` | Ship this order? | Kirim pesanan ini? |
| `salesOrders.fulfillment.action.shipConfirmBody` | `Jubelio will request the AWB from {courier}. This action cannot be undone.` | `Jubelio akan meminta resi dari {courier}. Aksi ini tidak bisa dibatalkan.` |
| `salesOrders.fulfillment.action.shipConfirmOk` | Ship | Kirim |
| `salesOrders.fulfillment.action.shipConfirmCancel` | Cancel | Batal |
| `salesOrders.fulfillment.cancelledLocked` | Cancelled — fulfillment locked. | Dibatalkan — pemenuhan dikunci. |
| `salesOrders.fulfillment.byUser` | `by {name}` | `oleh {name}` |
| `salesOrders.fulfillment.toast.success` | Action completed. | Berhasil. |
| `salesOrders.fulfillment.toast.invalidTransition` | Status already changed. Refresh the page. | Status sudah berubah. Muat ulang halaman. |
| `salesOrders.fulfillment.toast.forbidden` | Insufficient permissions. | Akses tidak diizinkan. |
| `salesOrders.fulfillment.toast.networkError` | Couldn't reach the server. Try again. | Gagal terhubung ke server. Coba lagi. |

## 7. Architecture summary

```
[Order detail page client component]
        │
        │ user click → server action
        ▼
[Server action] ──── requirePermission("sales_orders:fulfill")
        │
        │ calls writer helper
        ▼
[@elorae/db/sales-order-fulfillment-writer]
        │ inside one $transaction:
        │   - update SalesOrder web-owned cols
        │   - insert JubelioOutbox row (entityType: salesorder_pick/pack/ship)
        ▼
[OutboxPoller (apps/api) — async, sub-A]
        │
        │ routes to SalesOrderPickHandler / Pack / Ship
        ▼
[Jubelio WMS endpoint POST]
```

No changes to apps/api in this PR beyond a new `/jubelio/couriers/sync` endpoint for the courier table seeding.

## 8. Testing

vitest in apps/web (server actions are server-only but vitest mocks them fine):

`apps/web/app/actions/sales-order-fulfillment.spec.ts`:

1. `finishPickAction` happy path: mock writer helper returns success, action returns `{ ok: true }`, `revalidatePath` called.
2. `finishPickAction` invalid transition: writer throws `InvalidFulfillmentTransition`, action returns `{ ok: false, reason }`.
3. `finishPickAction` permission denied: `auth()` returns user without `sales_orders:fulfill`, action throws 403.
4. `shipOrderAction` passes `courierId` to `markOrderShipped`.
5. Same shape for `finishPackAction`.
6. `getCouriersForShipDialog` empty cache: triggers sync, returns fresh list.
7. `getCouriersForShipDialog` warm cache: skips sync, returns cached list.

No JSX render tests — same precedent as sub-B's queries-only test pattern.

Manual smoke (after merge, no Jubelio touch):
1. Open the order detail page for a real order with `fulfillmentStatus=PENDING`.
2. Click Finish Pick. Watch the toast appear. Refresh the page. Status now PICKED, timeline shows the user.
3. Inspect `JubelioOutbox` table directly — one new row `entityType=salesorder_pick`, `status=PENDING`. Outbox poller picks it up. Watch logs.
4. The first real handler run will reveal Jubelio's actual error shape. Capture the error code/message text from logs and fix-forward `isAlreadyInStateError` in all three handlers from sub-A.

## 9. Out-of-scope follow-ups

- Sub-C: Fulfillment Queue page (filter by `fulfillmentStatus`, batch enqueue).
- Sub-D: Print views (pick list, packing slip) + manual "Sync couriers" button on the jubelio admin page.
- `isAlreadyInStateError` fix-forward in sub-A's handlers, once observed.
- AWB display refresh: sub-A's webhook handler already writes `trackingNumber`/`courier` to `SalesOrder` when Jubelio sends the followup. The detail page reads these from sub-A's existing schema — no new code path needed.

## 10. Decisions log

| Decision | Resolution |
|----------|------------|
| Action placement | New Fulfillment card on detail page, between header and buyer card. State-aware single action button. |
| Courier list source | New `JubelioCourier` DB table. Lazy-populated on first Ship-dialog open. Manual refresh deferred to sub-D. |
| RBAC | New `sales_orders:fulfill` permission. Detail page stays on `:view`; buttons gated by `:fulfill`. |
| Print views | Deferred to sub-D. |
| Live smoke | Skipped. Unit tests only. Sub-A's `isAlreadyInStateError` fix-forwards when real shape observed. |
| Ship confirmation | shadcn AlertDialog. Pick and Pack fire directly. |
| Audit names | Pre-resolved server-side via `prisma.user.findMany` over the three `*ById` columns. Client gets `pickedByName` etc. as plain strings. |
| Courier name on detail | Pre-joined server-side from `JubelioCourier` lookup on `courierId`. |
