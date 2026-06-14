# Fulfillment Backend — Design

**Status:** Draft → review
**Date:** 2026-06-14
**Scope:** Sub-A of the Sales Fulfillment feature. Backend foundation: schema additions, state machine, web-writer helper, three outbox push handlers (Pick / Pack / Ship). No UI, no live Jubelio test. UI lands in Sub-B (action buttons on order detail) and Sub-C (Fulfillment Queue page).

## Goal

Give the ERP a server-side mechanism to advance marketplace orders through Pick → Pack → Ship and push each transition to Jubelio. Writes are constrained by a state machine and routed through an `@elorae/db` writer helper so the dual-ownership of `SalesOrder` (now api **and** web) is auditable in one place.

## Non-goals

- UI surfaces (action buttons, Fulfillment Queue page, printable pick/packing slips). Sub-B + Sub-C.
- Live smoke against real Jubelio orders. Pick/Pack/Ship are largely irreversible — testing against prod Jubelio is deferred to Sub-B with a designated test order and explicit cleanup procedure per `feedback_prod_test_rollback`.
- Mutating the existing sub-A `status` enum (the Jubelio-derived one). Fulfillment lives on a new orthogonal field.
- AWB capture path. Already implemented via sub-A's webhook handler — Jubelio asynchronously delivers `tracking_number` + `courier` through a follow-up `salesorder` webhook once the courier returns the AWB. No new code path needed.
- Batch fulfillment actions. Single-order pushes only. Batch enqueue is a Sub-C concern.

## 1. Background

EPIC-04 (Sales — Fulfillment, 9 MD) drives Pick → Pack → Ship inside Elorae and pushes each status to Jubelio. Jubelio then forwards the marketplace command (so the buyer sees "Picked" / "Shipped" in Shopee/Tokopedia/TikTok).

Sub-A (this spec) ships the backend only: schema, writer helper, three outbox handlers. Sub-B wires UI action buttons on the existing order-detail page. Sub-C ships the Fulfillment Queue index page.

## 2. Jubelio endpoints (already documented)

Reference: `reference/jubelio/jubelio-api-docs.yaml`.

| Action | Endpoint | Method | Notes |
|--------|----------|--------|-------|
| Pick | `/wms/sales/picklists/confirm-pick/` | POST | Body carries the salesorder_id and picker id |
| Pack | `/wms/sales/packlist/mark-as-complete` | POST | Body carries the salesorder_id |
| Ship | `/wms/shipments/` | POST | Body carries the salesorder_id + courier_new_id. Response includes `shipment_header_id` + `shipment_no`. AWB is later delivered async via salesorder webhook |
| Courier list | `/wms/couriers` | GET | Returned by Sub-B for the courier select dropdown — out of scope here |

The exact request/response shape for each is verified against the OpenAPI doc during handler implementation. Where ambiguous, the handler logs the raw response so Sub-B can observe the real shape on first live run.

## 3. Schema additions

### 3.1 New enum

```prisma
enum SalesOrderFulfillmentStatus {
  PENDING
  PICKED
  PACKED
  SHIPPED
}
```

`PENDING` is the default on every `SalesOrder` row, including those already in the table (backfill via column default).

The existing `SalesOrderStatus` enum (`NEW / PROCESSING / SHIPPED / COMPLETED / CANCELLED / RETURNED`) is unchanged — it represents the Jubelio-derived view of the order. `fulfillmentStatus` is the Elorae-owned view. Both can be queried independently; UI in Sub-B/Sub-C decides which one to show where.

### 3.2 New `SalesOrder` columns

| Field | Type | Notes |
|-------|------|-------|
| `fulfillmentStatus` | `SalesOrderFulfillmentStatus @default(PENDING)` | Indexed for Sub-C's queue filter |
| `pickedAt` | `DateTime?` | Set by `markOrderPicked` |
| `pickedById` | `String?` | FK → `User.id`, `onDelete: SetNull`. Audit only — no inverse relation back-ref needed (mirror the existing pattern of `enqueuedById` on `JubelioOutbox`) |
| `packedAt` | `DateTime?` | |
| `packedById` | `String?` | |
| `shippedAt` | `DateTime?` | Set when "Ship" enqueue succeeds. Distinct from `completedDate` which comes from Jubelio later |
| `shippedById` | `String?` | |
| `shipmentJubelioId` | `Int?` | Jubelio's `shipment_header_id`, returned from `POST /wms/shipments/`. Stored as audit trail |
| `courierId` | `Int?` | Jubelio courier_new_id chosen at ship time |

Index: `@@index([fulfillmentStatus])`. Sub-C's queue filter sorts/filters on this; same precedent as sub-A's `@@index([status])`.

No new tables — all additions land on existing `SalesOrder`.

### 3.3 Migration shape

One Prisma migration `add_fulfillment_columns`:
- Add the enum.
- `ALTER TABLE SalesOrder ADD COLUMN fulfillmentStatus ENUM(...) NOT NULL DEFAULT 'PENDING'`.
- Add the 8 audit/state columns.
- Add the FK constraints to `User(id)` with `ON DELETE SET NULL`.
- Add the index on `fulfillmentStatus`.

Shared TiDB. Author SQL by hand. User runs `migrate:deploy` per project convention (`feedback_service_control`).

## 4. State machine

### 4.1 Transitions

```
PENDING ──pick──▶ PICKED ──pack──▶ PACKED ──ship──▶ SHIPPED
```

No skips. No reverse. No re-entry. Any other transition throws `InvalidFulfillmentTransition` from the writer helper.

`CANCELLED` from sub-A's status is irrelevant to this machine — fulfillment is independent. A cancelled order can still be in `fulfillmentStatus=PENDING`; the writer helper checks both. If `status` (Jubelio-derived) is `CANCELLED` or `RETURNED`, fulfillment writes are blocked entirely. The check lives in the writer helper.

### 4.2 Idempotency

Sub-B's UI sends a server action → server action calls writer helper → writer helper updates column + enqueues outbox row. The state-machine check rejects double-clicks naturally (`PICKED → pick` throws).

The outbox processor is already idempotent on `JubelioOutbox.id`. A double-enqueue (network glitch, two browser tabs) results in two rows — both get processed, but the second hits Jubelio's already-picked state and is mapped to a SKIP outcome by the handler.

## 5. Writer helper

New file: `packages/db/src/sales-order-fulfillment-writer.ts`. Exports three functions:

```ts
export async function markOrderPicked(
  prisma: PrismaService,
  opts: { orderId: string; userId: string },
): Promise<void>;

export async function markOrderPacked(
  prisma: PrismaService,
  opts: { orderId: string; userId: string },
): Promise<void>;

export async function markOrderShipped(
  prisma: PrismaService,
  opts: { orderId: string; userId: string; courierId: number },
): Promise<void>;
```

Each function:

1. Opens a `$transaction(tx)`.
2. Reads the order, checks current `fulfillmentStatus` permits the requested transition. Checks `status NOT IN (CANCELLED, RETURNED)`. Throws `InvalidFulfillmentTransition` (extends `Error` with a stable code) on violation.
3. Updates `fulfillmentStatus` + corresponding `*At` + `*ById` columns.
4. Inserts one `JubelioOutbox` row with `entityType` set per action (see §6).
5. Returns.

The user (Sub-B server action) handles the error → 4xx response → UI toast.

### 5.1 Why a helper, not bare Prisma

Sub-A spec §8 deferred this exact question to "when a future ERP workflow needs to write back". That's now. Direct `prisma.salesOrder.update` calls from Sub-B would skip the state machine and bypass the outbox enqueue. The helper is the only legal write path for fulfillment fields. BOUNDARY.md §3.2 updates to enforce this contract.

Existing precedent: `@elorae/db/item-writer.ts` (sub-3) and `applyJubelioStockAdjustment` (sub-A stock-writer). Same shape.

### 5.2 Subpath export

Following the `feedback_client_db_imports` convention: helper is exported via `@elorae/db/sales-order-fulfillment-writer` subpath. Client components must not import it — but since Sub-B's server actions are server-only, that's natural here.

## 6. Outbox push handlers

Three new files in `apps/api/src/jubelio/outbox/handlers/`, mirroring the existing `product-push.handler.ts` + `stock-push.handler.ts` pattern.

### 6.1 entityType values

| Handler | `entityType` value | Jubelio endpoint |
|---------|-------------------|------------------|
| `salesorder-pick.handler.ts` | `salesorder_pick` | `POST /wms/sales/picklists/confirm-pick/` |
| `salesorder-pack.handler.ts` | `salesorder_pack` | `POST /wms/sales/packlist/mark-as-complete` |
| `salesorder-ship.handler.ts` | `salesorder_ship` | `POST /wms/shipments/` |

The existing outbox processor's `entityType` switch is extended to route these three.

### 6.2 Payload shapes

All payloads carry the `SalesOrder.id` (Elorae cuid) and the Jubelio `salesorder_id` (int). The handler reads the order from DB on each tick — defensive against payload staleness if the order was edited between enqueue and process.

Ship's payload also includes `courierId: number`. Pick/Pack do not need additional fields.

```ts
type SalesOrderPushPayload = {
  salesOrderId: string;       // Elorae cuid
  jubelioSalesorderId: number;
  courierId?: number;         // ship only
};
```

### 6.3 Handler flow

Each handler:

1. Receives an outbox row (existing infra).
2. Reads the corresponding `SalesOrder` row.
3. Calls `JubelioHttpService.apiFetch` against the endpoint with the action-specific body.
4. On 2xx response: marks outbox row `PROCESSED`. Ship handler additionally updates `SalesOrder.shipmentJubelioId` from the response body.
5. On 4xx with "already-picked"/"already-shipped" Jubelio error code: marks outbox row `SKIPPED` with reason `jubelio_already_in_state`. Returns success.
6. On other 4xx: marks outbox row `DEAD` after retries exhausted. Logs the response body. Admin notification fires (existing infra).
7. On 5xx / network: retries per existing outbox retry policy.

### 6.4 Authentication

Reuses the existing `JubelioHttpService` (auth + token refresh + 429 backoff). No new HTTP infra.

## 7. Testing

Unit tests for the writer helper (`packages/db/src/sales-order-fulfillment-writer.spec.ts` — or wherever existing db helpers test):

1. `markOrderPicked` happy path: PENDING order → PICKED status, `pickedAt` set, `pickedById` set, one outbox row enqueued with correct entityType + payload.
2. `markOrderPicked` on already-picked order throws `InvalidFulfillmentTransition` with the expected code.
3. `markOrderPicked` on cancelled order throws.
4. Same three for `markOrderPacked` (must require PICKED) and `markOrderShipped` (must require PACKED, must include courierId).
5. Transition skipping: PENDING → markOrderPacked throws.

Unit tests per handler (Jest, `apps/api/src/jubelio/outbox/handlers/salesorder-{pick,pack,ship}.handler.spec.ts`):

1. Happy path: 2xx response → outbox PROCESSED. Ship variant: `shipmentJubelioId` written.
2. Already-in-state response → outbox SKIPPED with `jubelio_already_in_state` reason.
3. 4xx error → outbox DEAD after retry exhaustion. Admin notification asserted.
4. Network error → outbox stays PENDING for retry.

No live Jubelio smoke. Sub-B introduces a designated test order with explicit cleanup steps before any real-Jubelio fulfillment write.

## 8. Boundary update

`docs/BOUNDARY.md` §3.2 transitions from "Sales writes (api-only as of 2026-06-11)" to dual-writer. Specifically:

- **api** still owns: all columns sub-A maintains via `SalesOrderWebhookHandler.upsertSalesOrder` (channel/status/totals/buyer/shipping/timestamps/etc).
- **web** now owns (via `@elorae/db/sales-order-fulfillment-writer` only): `fulfillmentStatus`, `pickedAt`, `pickedById`, `packedAt`, `packedById`, `shippedAt`, `shippedById`, `shipmentJubelioId`, `courierId`.

Column-level ownership matrix added to BOUNDARY.md so the contract is explicit. Web bare-prisma writes to web-owned columns is fine (e.g. internal notes if ever added); web-owned writes that need to also push to Jubelio go through the helper.

## 9. Failure modes

| Failure | Behavior |
|---------|----------|
| User clicks Pick on an already-PICKED order | Writer helper throws. UI shows toast. No outbox row created. |
| User clicks Pick, Jubelio is down | Outbox row stays PENDING. Existing retry kicks in. Status column is PICKED in Elorae. Eventual delivery. |
| User clicks Pick, Jubelio rejects with "order doesn't exist" | Outbox goes DEAD. Status stays PICKED in Elorae (mismatch). Admin notification fires for manual reconciliation. Reasoning: better to surface the mismatch than auto-revert and confuse the warehouse user. Sub-B's UI can surface "DEAD outbox row exists for this order" as a banner on the detail page. |
| Multi-user race (two browsers click Pick) | First write wins; second hits the state-machine check, throws. Web returns 4xx. Standard optimistic-locking UX in the UI. |

## 10. Out-of-scope follow-ups (Sub-B / Sub-C)

- Action buttons on the order detail page (Finish Pick / Finish Pack / Ship with courier select). Server actions calling the writer helper.
- Printable pick list (SKUs + qtys + bin locations).
- Printable packing slip.
- Fulfillment Queue page at `/backoffice/sales-orders?fulfillment=PENDING` (or a dedicated route).
- Batch actions (multi-select rows → bulk-enqueue Pick).
- Live Jubelio smoke against a test order with documented cleanup.

## 11. Decisions log

| Decision | Resolution |
|----------|------------|
| Decomposition | A/B/C. Sub-A: backend (this spec). Sub-B: UI actions on detail page. Sub-C: Fulfillment Queue page. |
| Fulfillment status field | New `fulfillmentStatus` enum, separate from sub-A's `status`. Orthogonal concerns. |
| Outbox handler granularity | Three handlers (one per action). Matches existing `product-push` + `stock-push` pattern. |
| AWB return path | Already covered by sub-A's salesorder webhook handler. EPIC-04 does not add a new write path. |
| Smoke test in sub-A | Unit tests only. Live Jubelio smoke deferred to Sub-B with designated test order + cleanup procedure. |
| Dual-writer mechanism | `@elorae/db/sales-order-fulfillment-writer` subpath helper. Web never bare-writes fulfillment fields. BOUNDARY.md updated. |
| State machine | PENDING → PICKED → PACKED → SHIPPED. No skip. No reverse. Server-side guard in helper. |
| Cancelled order handling | Fulfillment writes blocked when `status` IN (CANCELLED, RETURNED). |
