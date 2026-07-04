# Service boundary — `apps/web` ↔ `apps/api`

Status: **active** · Owner: backend integration · Last updated: 2026-06-24

This document defines the responsibility split between the Next.js app
(`apps/web`) and the NestJS Jubelio integration service (`apps/api`) in the
Elorae monorepo. It is the source of truth for *who writes what* and *how the
two services talk*. Any PR that violates the rules below must either update
this document or be rejected.

For day-to-day developer usage of the Jubelio-touching surface (how to enqueue
a push, which `entityType` and `source` strings to use, which helpers to call),
see [INTEGRATION-GUIDE.md](./INTEGRATION-GUIDE.md). This file owns the why; the
guide owns the how.

Legend used throughout: **✅ built** · **🟡 partial** · **⏳ planned**.

---

## 0. Status snapshot

| Layer | Item | State |
| ----- | ---- | :---: |
| Monorepo | `apps/web` + `apps/api` + `packages/db` + `reference/jubelio` + `docs/` | ✅ |
| Monorepo | pnpm workspaces + Turborepo (`turbo.json`, `pnpm-workspace.yaml`) | ✅ |
| `@elorae/db` | Prisma schema, migrations, generated client, MariaDB adapter | ✅ |
| `@elorae/db` | Shared helpers (`writeAuditLog`, stock writer, sales-order guard, `SystemSetting` namespace enforcement) | ⏳ |
| `apps/web` | Existing Next.js ERP (untouched by carve, imports `@elorae/db`) | ✅ |
| `apps/api` | NestJS scaffold (`PrismaModule`, `HealthModule`, `JubelioModule`) | ✅ |
| `apps/api` | Swagger `/docs` behind HTTP Basic auth (`SWAGGER_USER`/`SWAGGER_PASS`) | ✅ |
| Jubelio token | env creds + DB persistence + 12 h TTL + in-memory cache + single-flight refresh + on-demand re-fetch within 5 min of expiry | ✅ |
| Jubelio token | Proactive scheduled refresh (`@Cron` hourly prewarm) + exponential backoff on `refresh()` failure + `AdminNotification` write on persistent failure | ✅ |
| Webhooks | Receivers (`salesorder`, `stock`, `salesreturn`, `product`) + signature verify + dedupe via `JubelioWebhookEvent` | ✅ |
| Webhook handlers | `stock` ✅, `salesorder` ✅ (with forward-sync to `fulfillmentStatus=SHIPPED`), `product` ✅ (triggers single-group catalog re-ingest), `salesreturn` 🟡 (stub awaiting live payload samples) | 🟡 |
| Catalog ingest | `POST /jubelio/catalog/sync` — Jubelio → ERP (upserts `Item` via `@elorae/db` helper with `source=JUBELIO_INGEST`, `JubelioProductMapping`, zero `InventoryValue`) | ✅ |
| Outbox queue | `JubelioOutbox` table + outbox poller + outbox router + handlers (`stock_push`, `product_push`, `salesorder_pick`, `salesorder_pack`, `salesorder_ship`); already-in-state skip; entityType registry at `@elorae/db/jubelio-outbox` | ✅ |
| Bulk migration | One-shot ERP→Jubelio backfill tool (`/backoffice/jubelio/migration`) — enqueues `product_push` rows, polls outbox status for progress | ✅ |
| API audit | `JubelioApiCall` audit log + HTTP interceptor + 429 rate-limit handling | ✅ |
| Admin alerts | `AdminNotification` table + writer in api + read in web admin UI | ✅ schema + api writer; ⏳ web UI consumer |
| Cross-service auth bridge (NextAuth JWT verify in api) | | ⏳ |
| Internal `api → web` revalidate endpoint | | ⏳ |
| Render deployment + Upstash Redis provisioning + CI for migrations lint | | ⏳ |
| `@elorae/types` shared package (Zod schemas, permission constants re-export) | | ⏳ |

---

## 1. Principle

- `apps/web` owns ERP business logic and UI.
- `apps/api` owns Jubelio integration: HTTP client, token lifecycle, push,
  ingest, webhook receivers, queues, long-running jobs.
- Each table has one **write owner**. Other service may read via the shared
  Prisma client in `@elorae/db`.

### Decision rule

> "Does this code talk to Jubelio (push, pull, webhook, or background job
> related to a Jubelio resource)?"
>
> - **Yes** → `apps/api`
> - **No** → `apps/web`

**Exception — ERP triggers with Jubelio side-effects.** Actions like
`receiveFG`, `createGRN`, `createStockAdjustment` stay in `apps/web` and write
to the local DB. In the same Prisma transaction they append a row to
`JubelioOutbox`. The `apps/api` outbox worker drains it. The ERP action does
not call Jubelio directly. **⏳ planned.**

---

## 2. Service responsibilities

| Concern                                | `apps/web` | `apps/api` | State |
| -------------------------------------- | :--------: | :--------: | :---: |
| UI rendering (App Router)              | ✅          |            | built |
| NextAuth session                       | ✅          |            | built |
| ERP CRUD (items, GRN, PO, vendors)     | ✅          |            | built |
| Production / costing / reports         | ✅          |            | built |
| RBAC checks (UI + ERP actions)         | ✅          |            | built |
| Audit log writer (ERP side)            | ✅          |            | built |
| Encryption / decryption (supplier PII) | ✅          |            | built |
| File upload (R2, GRN photos)           | ✅          |            | built |
| Firebase admin (push notifications)    | ✅          |            | built |
| Jubelio HTTP client + token cache      |            | ✅          | built |
| Jubelio webhook receivers              |            | ✅          | built |
| Catalog ingest (Jubelio → ERP)         |            | ✅          | built (`Item` dual-write per §3.3) |
| Long-running jobs and queues           |            | ⏳          | planned |
| Audit log writer (Jubelio side)        |            | ⏳          | planned |
| RBAC guard for Jubelio endpoints       |            | ⏳          | planned (auth bridge) |
| Catalog push (ERP → Jubelio)           |            | ⏳          | planned |
| Marketplace listing                    |            | ⏳          | planned |
| Stock push                             |            | ⏳          | planned |
| Sales order ingest                     |            | ⏳          | planned |
| WMS pick / pack / ship                 |            | ⏳          | planned |
| Returns ingest                         |            | ⏳          | planned |

---

## 3. Data ownership

**Write owner** is the service authorised to issue `INSERT`/`UPDATE`/`DELETE`
on the table. Reads are unrestricted via `@elorae/db`.

Tables marked ⏳ do not exist in Prisma schema yet — listed here as the target
contract for the migrations that will introduce them.

| Table                          | Owner                       | Reads from other            | State |
| ------------------------------ | --------------------------- | --------------------------- | :---: |
| `User`, `Role`, `Permission`   | web                         | api (read)                  | ✅ |
| `Item`, `ItemVariant`          | **both** — see §3.3         | —                           | ✅ schema + `source` column; api ingest via helper ✅; web continues bare prisma 🟡 |
| `Supplier`, `SupplierType`     | web                         | —                           | ✅ |
| `GRN`, `GRNItem`               | web                         | api (read)                  | ✅ |
| `PurchaseOrder`, `POItem`      | web                         | api (read)                  | ✅ |
| `VendorReturn`                 | web                         | —                           | ✅ |
| `Production*`                  | web                         | api (read FG receipts)      | ✅ |
| `PlanYear`, `PlanCategory`, `PlanMonthly`, `PlanColorAllocation`, `PlanAccessory` | web | — | ✅ |
| `PlanCmtAllocation`, `PlanStage` | web — WO creation via `createWorkOrder` in `apps/web`; `PlanStage` auto-synced when generating from CMT rows (`planCmtAllocationId`) | — | ✅ |
| `InventoryValue`               | **both** — see §3.1         |                             | ✅ schema; 🟡 dual-write helper ⏳ |
| `StockAdjustment`              | **both** — see §3.1         |                             | ✅ schema; 🟡 dual-write helper ⏳ |
| `StockReservation`             | **both** — see §3.1         |                             | ✅ schema + writer — api (Jubelio salesorder webhook via `reserveOrder`/`consumeOrder`/`releaseOrder` with `source=JUBELIO`), web (ship button `consumeOrder`, field-sales putus orders via `reserveFieldSalesOrder`/`consumeFieldSalesOrder`/`releaseFieldSalesOrder` with `source=FIELD_SALES`). Written ONLY through `@elorae/db/reservation-writer.ts` — never bare prisma. |
| `SalesOrder`                   | **both** — see §3.2         | —                           | ✅ api owns Jubelio-derived cols; web owns fulfillment cols via helper |
| `SalesOrderItem`               | api                         | web (read)                  | ✅ schema + api writer |
| `SalesHistory`                 | web                         | api (read)                  | ✅ Excel import (`channel=MARKETPLACE`) + putus approval (`channel=OFFLINE`); identity fields (`itemId`, `erpVariantSku`, `jubelioItemId`, `resolutionStatus`) stamped at import via `marketplace-sku-resolver` — see §3.7 |
| `SalesHistoryImport`           | web                         | —                           | ✅ |
| `ForecastConfig`, `ForecastResult` | web                     | —                           | ✅ `ForecastResult.itemId` for item-centric grouping |
| `SalesReturn`                  | api ingest; web decision (planned) | —                    | 🟡 webhook stub shipped; EPIC-05 will introduce web-side Accept/Reject writer + new outbox type `salesreturn_decision_push` |
| `FieldSalesOrder`, `FieldSalesOrderLine` | web           | api (read)                  | ✅ schema; web-written putus orders (ERP-originated), api never writes |
| `JubelioProductMapping`        | api                         | web (read)                  | ✅ |
| `JubelioCategoryMapping`       | api                         | web (read)                  | ✅ schema; writer ⏳ (currently seed-only, no runtime writer) |
| `JubelioOutbox`                | web insert, api consume/update | — | ✅; `entityType` MUST come from `@elorae/db/jubelio-outbox` registry — see §4.2.1 |
| `JubelioWebhookEvent`          | api                         | —                           | ✅ |
| `JubelioApiCall`               | api                         | web (read for admin UI)     | ✅ |
| `AdminNotification`            | **both** — see §3.5; api on integration alerts, web on ERP-detected alerts (negative-available, opname variance, AR overdue) | — | ✅ schema + api writer; web writer expected with EPIC-07/08/21 |
| `SystemSetting` (Jubelio keys) | api                         | web (read for settings UI)  | ✅ (`JUBELIO_SESSION_TOKEN`) |
| `SystemSetting` (other keys)   | web                         | —                           | ✅ |
| `AuditLog`                     | both — shared writer        | —                           | ✅ schema; 🟡 shared writer ⏳ |
| `Notification`                 | both                        | —                           | ✅ |

### 3.1 Stock writes — multi-writer

- **web** writes `InventoryValue` and `StockAdjustment` when an ERP action
  triggers (`receiveFG`, `createGRN`, manual adjustment, opname approval). Same
  transaction inserts a `JubelioOutbox` row of type `stock_push` when the
  change should propagate outbound.
- **api** writes `InventoryValue` and `StockAdjustment` when the Jubelio
  `stock` webhook arrives (external mutation in Jubelio).
- **api cron** (EPIC-07-04, ⏳) writes `StockAdjustment` with
  `source = JUBELIO_RECONCILE` when the reconcile loop auto-corrects a small
  variance. Lives in apps/api because reading Jubelio inventory is api's
  responsibility. **Must compare against `available` (`qtyOnHand - reservedQty`),
  not raw `qtyOnHand` — see D6 note below D5/D7.**
- **`StockReservation` ledger writes** (resolved 2026-07-02, D6): api's
  `SalesOrderWebhookHandler` calls `reserveOrder` on ingest and `consumeOrder`
  on ship-webhook; web's Ship button calls `consumeOrder`. `releaseOrder` on
  cancel is wired on the api webhook path today; a future web-side cancel action
  can call it safely (idempotent). All three helpers live in
  `@elorae/db/reservation-writer.ts` and are the only sanctioned writers of
  `StockReservation` and `InventoryValue.reservedQty`. `consumeOrder` also
  writes `StockAdjustment` (`source = FULFILLMENT_CONSUME`) to deduct
  `qtyOnHand` at ship time — see D6 in §9.

`StockAdjustment.source` is a free-form `String` column but the allowed values
are codified in the registry `packages/db/src/stock-adjustment-source.ts`
(`@elorae/db/stock-adjustment-source`). All callers MUST use
`satisfies StockAdjustmentSource` to compile-check the string. Audit dashboard
filters and reconcile-cron logic key off the exact values.

Allowed values today: `ERP`, `ERP_OPNAME`, `ERP_RETURN_ACCEPT`,
`FULFILLMENT_CONSUME`, `JUBELIO_WEBHOOK`, `JUBELIO_RECONCILE`.

To add a new source, see [INTEGRATION-GUIDE §2](./INTEGRATION-GUIDE.md).

**Reconcile-cron note (relevant to D5/D7, added with D6):** when the
EPIC-07-04 reconcile cron is built, it must diff Jubelio-reported qty against
ERP **available** (`qtyOnHand - reservedQty`), never raw `qtyOnHand`. Comparing
against `qtyOnHand` would treat every open reservation as a variance and fight
the reservation model — the cron would "correct" stock that is intentionally
held back from sale.

### 3.5 `AdminNotification` writes — two writers (planned)

- **api** writes integration alerts: token-refresh failure, outbox DLQ growth,
  rate-limit exhaustion, webhook signature failure. (✅ shipped where helpers
  exist.)
- **web** writes ERP-detected alerts: negative-available stock (EPIC-08-03),
  opname variance over threshold (EPIC-07-04), AR overdue (EPIC-21-06), konsi
  sell-through discrepancy (EPIC-22-05). (⏳ ships per EPIC.)

No shared writer helper is mandated yet — the table is simple. If multiple web
call sites accumulate, lift into a `@elorae/db/admin-notification-writer.ts`
helper.

### 3.6 Single-owner web tables — default rule

Any table not enumerated in this section is **single-owner web**. This includes
all ERP-only tables introduced by upcoming EPICs (finance/CoA, journal, AR,
field sales, settlement, retur management, etc). The enumeration here is
**Jubelio-touching tables only**. New tables that *do* touch Jubelio (push or
ingest) must be added to §3 explicitly.

### 3.7 `SalesHistory` — certified Excel demand (web-owned, 2026-06-24)

`SalesHistory` is **Excel-only certified demand** for S&OP forecast and reconciliation.
It is never populated from `SalesOrder` or Jubelio webhooks.

- **web** writes all rows via `executeSalesHistoryImport` (`apps/web/lib/forecast/import-sales-history.ts`).
- At import, each row is resolved through `marketplace-sku-resolver` (same heuristics as `umkm-sku-bridge`): `itemId`, `erpVariantSku`, `jubelioItemId`, `resolutionStatus` (`MAPPED` / `UNMAPPED` / `AMBIGUOUS`).
- Unmapped rows remain in `SalesHistory` and still contribute to forecast demand (grouped by `parentSku`).

**Reconciliation (read-only report):** `apps/web/lib/sales/sales-reconciliation.ts` compares aggregated Excel `SalesHistory.netQuantity` vs Jubelio `SalesOrderItem.qty` for a channel + calendar month. Default strategy is **B-Aggregate** (per item / period totals). Line-level matching requires a verified marketplace order key (`channelOrderId`) — not shipped until Gate 2 confirms the field.

**Stock non-goal:** Excel import and sales reconciliation **do not** write `InventoryValue`, `StockAdjustment`, or any stock ledger. Operational stock mutations from marketplace sales flow only through Jubelio `SalesOrder` ingest + fulfillment.

### 3.2 Sales writes — dual-writer (as of 2026-06-14)

`SalesOrder` is now dual-writer, split by column:

**api-owned columns** (written by `SalesOrderWebhookHandler.upsertSalesOrder` on every Jubelio webhook):

- All marketplace metadata: `channel`, `sourceName`, `salesorderNo`, etc.
- Status (raw + derived): `channelStatus`, `internalStatus`, `wmsStatus`, `status`, `isCanceled`, `isPaid`, `markedAsComplete`.
- Buyer + shipping snapshot: `customerName`, `customerPhone`, `customerEmail`, `shippingProvince`, `shippingCity`, `shippingAddress`.
- Totals + fees: `subTotal`, `totalDisc`, `totalTax`, `shippingCost`, `grandTotal`, `feeBreakdown`.
- Timestamps from Jubelio: `transactionDate`, `createdDateJubelio`, `completedDate`, `cancelDate`, `lastModifiedJubelio`, `paymentDate`.
- `trackingNumber`, `courier`, `paymentMethod`, `lastWebhookEventId`.

**web-owned columns** (written EXCLUSIVELY via `@elorae/db/sales-order-fulfillment-writer` — never bare prisma):

- `fulfillmentStatus` (with api forward-sync exception — see below)
- `pickedAt`, `pickedById`
- `packedAt`, `packedById`
- `shippedAt`, `shippedById` (with api forward-sync exception — see below)
- `shipmentJubelioId`
- `courierId`

The writer helper enforces the state machine (PENDING → PICKED → PACKED → SHIPPED, no skip, no reverse) and enqueues a `JubelioOutbox` row per transition in the same transaction. Web bare-prisma writes to any fulfillment column are a contract violation.

**api forward-sync exception (added 2026-06-14):** `SalesOrderWebhookHandler.upsertSalesOrder` MAY advance `fulfillmentStatus → SHIPPED` and stamp `shippedAt` when the inbound Jubelio salesorder webhook reports the order shipped (any of `wms_status === "SHIPPED"`, `is_shipped === true`, `marked_as_complete === true`, or `completed_date` present). The advancement is:

- **Forward-only.** Guarded by `where: { fulfillmentStatus: { not: "SHIPPED" } }` — never overwrites an existing SHIPPED audit set by the writer helper (preserves `shippedById` + original `shippedAt`).
- **No `shippedById` write.** When advanced via webhook, `shippedById` stays null (no user clicked Ship). UI distinguishes "Shipped at … by NAME" vs "Shipped at …" accordingly.
- **No intermediate cascade.** `pickedAt`/`pickedById`/`packedAt`/`packedById` are NOT backfilled when the webhook arrives directly at SHIPPED — they stay whatever the web writer last set (likely null if the order shipped externally).
- **Why:** prevents drift between Jubelio-reported `status = SHIPPED` and Elorae-internal `fulfillmentStatus = PENDING/PICKED/PACKED` when operators ship from Jubelio admin UI, the marketplace auto-ships, or any external WMS performs the action.

`SalesOrderItem` remains api-only — web never writes line items.

### 3.3 `Item` writes — two writers (resolved 2026-05-25)

`Item` has an `ItemSource` discriminator column:

- `ERP` — row created/edited via apps/web (ERP forms, GRN receive-new-SKU).
  Default on `INSERT`.
- `JUBELIO_INGEST` — row created/edited by apps/api catalog ingest.

**api** writes `Item` only through the shared helper
`@elorae/db/item-writer.ts` (`createItemFromIngest`, `updateItemFromIngest`).
The helper stamps `source = JUBELIO_INGEST` automatically. Direct
`prisma.item.create` / `prisma.item.update` from apps/api is still forbidden
(§7).

**web** continues to use `prisma.item.*` directly; rows default to
`source = ERP`. Migrating web call sites to an `ErpItemWriter` helper is a
future cleanup, not a prerequisite for ingest.

Backfill in migration `20260525100000_add_item_source`: any pre-existing row
joined to `JubelioProductMapping` was set to `JUBELIO_INGEST`; all others
default to `ERP`.

**Conflict policy:** none yet. If both services edit the same item
near-simultaneously, last-write-wins. Add a policy in the helper when a real
collision case appears (low probability; ingest is push-button, not
continuous).

---

## 4. Communication patterns

### 4.1 `web → api` (sync, low-volume) — ⏳ planned

User-facing flows where api must respond inline.

- Use cases: "Push catalog now" button, fetch WMS list for UI, fetch Jubelio
  token state, manual sync trigger.
- Auth: NextAuth JWT in cookie → forwarded by web server action as
  `Authorization: Bearer <jwt>` → Nest verifies with shared `NEXTAUTH_SECRET`.
- Latency budget: 200 ms guard at gateway. Errors surfaced to user.

**Current state:** api endpoints `/jubelio/status` and `/jubelio/refresh` exist
but are unguarded (any caller can hit them). Auth bridge to apps/web NextAuth
JWT is pending.

### 4.2 `web → api` (async, write-coupled via outbox) — ✅ shipped

ERP action commits local write **and** `JubelioOutbox` row in one Prisma
transaction. api outbox poller + router + handlers drain. See
[INTEGRATION-GUIDE §1](./INTEGRATION-GUIDE.md) for the call-site recipe.

- **Idempotency key:** `${entityType}:${entityId}:${version}` — Jubelio call
  must accept this key (or be naturally idempotent).
- **No sync HTTP call** from a Prisma transaction. Always outbox.
- **Already-in-state Jubelio responses** are skipped (not retried) — see
  `OUTBOX_SKIP_REASONS.ALREADY_IN_STATE`.

#### 4.2.1 `entityType` registry

The canonical list lives in `packages/db/src/jubelio-outbox.ts` and is
exported via `@elorae/db/jubelio-outbox`. Every web insert and every api
router branch MUST be typed against `JubelioOutboxEntityType`. The router has
an exhaustiveness guard (`const _exhaustive: never = entityType`) — adding a
new value to the registry without a handler is a compile error, not a runtime
silent drop.

Current values: `stock_push`, `product_push`, `salesorder_pick`,
`salesorder_pack`, `salesorder_ship`.

To add: append to the registry array, run `pnpm -F @elorae/db build`, add a
handler under `apps/api/src/jubelio/outbox/handlers/`, wire the router case,
register in the Nest module, add a `.spec.ts`. See
[INTEGRATION-GUIDE §1](./INTEGRATION-GUIDE.md).

### 4.2.2 `web → api` (async, long-running job) — ✅ shipped (bulk migration)

For jobs that take minutes (e.g. EPIC-02-05 bulk migration), web triggers via
a server action that batch-inserts `JubelioOutbox` rows. Progress is observed
by polling the outbox status grouped by `enqueuedById` + `createdAt` window.
No separate job-state table required when the outbox itself models the unit
of work.

### 4.3 `api → web` (rare) — ⏳ planned

Only for cache invalidation:
- `POST /api/internal/revalidate` with `{ paths: string[] }`.
- Auth: shared `INTERNAL_API_KEY` header (env), **not** user JWT.

Avoid otherwise. Prefer api owning its own data and web fetching from api.

### 4.4 Jubelio → api (webhooks) — ✅ shipped

- Path: `POST /webhooks/jubelio/:event` (events: `salesorder`, `stock`,
  `salesreturn`, `product`).
- Verify Jubelio signature header `Sign`:
  `HMAC-SHA256(data=rawBody + secret, key=secret)` (per Jubelio's Node.js
  example — the docs *text* says "SHA256" but the code uses `CryptoJS.HmacSHA256`).
- Persist raw payload to `JubelioWebhookEvent` table, ack 200 immediately,
  process asynchronously via BullMQ queue.
- Idempotency: dedupe by Jubelio's `event_id` (or hash of payload if missing).
- Jubelio retries non-200 responses up to 3 times — return 200 quickly even
  when payload processing is deferred to the queue.

### 4.5 Scheduled jobs — cron home rule

When a scheduled job needs to read from Jubelio or call Jubelio, it lives in
**apps/api**. Web cron (Vercel) does not have access to the Jubelio token
cascade and must not be tempted to import the api's Jubelio HTTP client.

When a scheduled job is pure-ERP (no Jubelio touch — e.g. nightly settlement
parser, AR aging recomputation, FCM cleanup), it lives in **apps/web** via
Vercel cron, calling a server action.

Cross-service writes from scheduled jobs use the same `@elorae/db` helpers as
on-demand writes. An api cron that writes a web-owned table goes through the
helper (e.g. EPIC-07-04 reconcile writes `StockAdjustment` via the same
`stock-writer.ts` infrastructure, stamping `source = JUBELIO_RECONCILE`).

### 4.6 External integrations beyond Jubelio — punted

Some upcoming EPICs touch external systems other than Jubelio:

- EPIC-21-05: e-Faktur (DJP)
- EPIC-23 (future): bank reconciliation APIs

Today these are scoped as **manual entry only** — no automation. When the
first automated external integration lands, choose between (a) extending
apps/api with a new module per external system, or (b) splitting into a new
`apps/integrations` service. Decision deferred until the first concrete EPIC
plan exists.

---

## 5. Auth model

| Endpoint type           | Mechanism                                              | State |
| ----------------------- | ------------------------------------------------------ | :---: |
| api: user-facing        | NextAuth JWT (shared secret) + RBAC guard              | ⏳ |
| api: webhook receivers  | Jubelio `Sign` header (sha256 scheme)                  | ⏳ |
| api: internal (web→api) | Shared bearer JWT (same `NEXTAUTH_SECRET`)             | ⏳ |
| api → web revalidate    | Shared `INTERNAL_API_KEY` (env, rotated quarterly)     | ⏳ |
| api: `/docs`            | HTTP Basic (`SWAGGER_USER`/`SWAGGER_PASS`) — disabled if env missing | ✅ |

- Permission constants live in `@elorae/types/erp/permissions` (⏳). Both services
  import them. No duplication.
- RBAC matrix in `apps/web/lib/rbac.ts` is the single source. api imports it
  via `@elorae/types` re-export (⏳).

**Current state:** apps/api routes are open to any caller on the network. Token
refresh and status endpoints are NOT gated. Acceptable for local-only dev; must
be closed before any public deploy.

---

## 6. Failure modes

| Failure          | Behaviour                                                                                          | State |
| ---------------- | -------------------------------------------------------------------------------------------------- | :---: |
| api down         | web ERP fully functional. `JubelioOutbox` accumulates. No data loss. Drains on api restart.        | ⏳ requires outbox |
| Jubelio down     | api outbox retries with backoff. UI shows "N items pending Jubelio sync" indicator.                | ⏳ requires outbox |
| web down         | api still ingests Jubelio webhooks and persists. Outbox idle (no producers).                       | ⏳ requires webhooks |
| DB down          | Both services 500. Standard.                                                                       | ✅ |
| Outbox stuck     | Alert when `PENDING + FAILED > threshold` for `> X min`. Manual replay tool in api admin.          | ⏳ |
| Webhook replay   | Dedup by `event_id` in `JubelioWebhookEvent`. Safe to replay.                                      | ⏳ |
| Token expired    | api auto-refreshes within 5 min of expiry (on demand). Single-flight refresh per process. Hourly `@Cron` prewarm + exponential backoff + `AdminNotification` on persistent failure. | ✅ |
| Schema drift     | Migrations run only via `@elorae/db`. CI blocks PRs that add migrations elsewhere.                 | 🟡 convention enforced socially; ⏳ CI guard |

---

## 7. Anti-patterns

- ❌ api importing from `apps/web/lib/*`. Circular dependency, blurs boundary.
  If logic must be shared, lift into `packages/types` or new `packages/*`.
- ❌ web calling Jubelio directly via `fetch('https://api2.jubelio.com')`.
- ❌ Two services running `prisma migrate`. Only `@elorae/db` runs migrations.
  Both apps run `prisma generate` only.
- ❌ Duplicating Zod schemas. Define once in `@elorae/types`.
- ❌ Writing to a table not listed in §3 without updating this doc first.
- ❌ Sync HTTP call from ERP server action to api inside a Prisma transaction.
  Always outbox.
- ❌ api writing to `User`, `Role`, `Permission`, `GRN`, `PO`, or any table
  marked web-owned. `Item` is dual-owned (§3.3) — api writes **only** via
  `@elorae/db/item-writer.ts` helpers, never `prisma.item.create/update`
  directly.
- ❌ Hardcoding `JubelioOutbox.entityType` or `StockAdjustment.source` strings
  (including `FULFILLMENT_CONSUME`) without `satisfies` against the registry
  types. A typo becomes a silent runtime drop — the router skips with
  `unknown_entity_type:…`. See §4.2.1 and §3.1.
- ❌ Writing `StockReservation` rows or `InventoryValue.reservedQty` via bare
  `prisma.stockReservation.*` / `prisma.inventoryValue.update`. Always go
  through `reserveOrder`/`consumeOrder`/`releaseOrder` in
  `@elorae/db/reservation-writer.ts` — see D6.
- ❌ Comparing Jubelio-reported stock against raw `InventoryValue.qtyOnHand`
  in any reconcile/audit logic. Use `available` (`qtyOnHand - reservedQty`) or
  it will "correct" quantity that is intentionally held by an open
  reservation. See D6 and the reconcile note in §3.1.
- ❌ Pushing virtual-warehouse stock (consignment, canvasser mobile) to
  Jubelio. The push formula must exclude virtual qty:
  `pushable = mainWarehouse.onHand - reserved - virtualWarehouseQty`.
  EPIC-19 will introduce the warehouse model; EPIC-02-03 push helper must
  apply the filter.
- ❌ Reusing marketplace `SalesOrder` for offline `OfflineSalesOrder` writes
  (EPIC-17/18/22). Marketplace SO is api-owned and Jubelio-shaped; offline SO
  is web-owned. Either separate model or explicit channel discriminator.
- ❌ Pre-filling EPIC-24-02 warehouse received qty from salesman claim. The
  acceptance criterion explicitly forbids it — warehouse independence is the
  whole point.
- ❌ Sync HTTP call to non-Jubelio external systems (DJP, payment gateway)
  from inside a Prisma transaction. Same rule as Jubelio (§4.2) — use
  outbox or job queue.

---

## 8. Monorepo migration — completion log

| # | Step | State |
| - | ---- | :---: |
| 1 | `git mv frontend apps/web` (drop `apps/web/prisma/` after step 2) | ✅ commits `01e2bb2`, `996d310` |
| 2 | Create `packages/db`; move `frontend/prisma/*` to `packages/db/prisma/` | ✅ `996d310` |
| 3 | Update `apps/web` imports of `@/lib/prisma` → `@elorae/db` (+ swap `@prisma/client` imports) | ✅ `996d310` |
| 4 | Remove `backend/` Go scaffold (throwaway) | ✅ `01e2bb2` |
| 5 | Wire NestJS at `apps/api` (hand-crafted, not `nest new`) — `PrismaModule`, `HealthModule`, `JubelioModule`, Swagger UI gated by Basic auth | ✅ `0758033`, `4d306da`, `a0526be` |
| 6 | `git mv jubelio reference/jubelio` (sample JSON + yaml + plans, gitignored) | ✅ `01e2bb2`, `885c8a0` |
| 7 | Add `pnpm-workspace.yaml`, `turbo.json`, root `package.json` | ✅ `e34d26d` |
| 8 | CI: block migrations outside `@elorae/db`; lint forbidden imports (`apps/api` → `apps/web`) | ⏳ |

Additional bring-up: prisma generator swapped to ESM (`prisma-client`),
`bootstrap-env.ts` loads `.env` before `AppModule` resolves `@elorae/db`, dev
script uses `nest start --watch --builder swc` (SWC honours
`emitDecoratorMetadata` which tsx/esbuild do not).

---

## 9. Decisions

| # | Topic | Decision |
| - | ----- | -------- |
| Q1 | Webhook signature | Jubelio uses `HMAC-SHA256(data=rawBody + secret, key=secret)`, hex-encoded. Header name: **`Sign`** (verified 2026-05-28 from real delivery and Jubelio's docs Node.js example). Note: Jubelio's docs *text* incorrectly says "SHA256" without mentioning HMAC — their code example is the source of truth. Secret configured in Jubelio dashboard (Pengaturan → Developer → Webhook). Rate limit: 600 req/min, 429 on exceed. Jubelio retries non-200 callbacks up to 3 times. |
| Q2 | Redis | **Upstash Redis** (managed). Free tier covers MVP. Used by BullMQ. |
| Q3 | api deployment | **Render** (persistent web service, Docker). |
| Q4 | Audit log writer | Shared helper in `@elorae/db` (e.g. `writeAuditLog()`). Single Prisma call site. Both services call it. |
| Q5 | `SystemSetting` namespace | api-owned keys prefixed `JUBELIO_*` (e.g. `JUBELIO_SESSION_TOKEN`). All other keys web-owned. Enforce in a small helper that rejects writes from the wrong owner. |
| D1 | Outbound queue | **BullMQ + Upstash Redis** (per Q2). All `apps/web` → `apps/api` async writes enqueued; `apps/api` workers drain. |
| D2 | Admin alert channel | **In-DB `AdminNotification` table.** Written by api on token-refresh failure, outbox-stuck, rate-limit hit, etc. Consumed by apps/web admin UI. Web may also write for ERP-detected alerts — see §3.5. |
| D3 | Admin dashboard | **Full UI in apps/web** at `/backoffice/jubelio/admin` — queue depth, failed items, audit log, outbox status, retry buttons. api exposes JSON endpoints; apps/web renders. |
| D4 | Local Redis | **Docker compose** (`redis:7-alpine`) declared in repo-root `docker-compose.dev.yml`. apps/api reads `REDIS_URL` env. Upstash used for staging/prod. |
| D5 | Stock reconciliation cron home (EPIC-07) | **apps/web owns orchestration + persistence.** A secret-guarded `POST /api/cron/reconciliation` (and in-process `node-cron` every 6h on VPS) calls `runReconciliation('CRON')` in web. Config lives in `SystemSetting` (`RECON_AUTO_CORRECT_THRESHOLD`, `RECON_AUTO_CORRECT_DIRECTION`, `RECON_CRON_ENABLED`). Launch posture: `FLAG_ONLY` + threshold 0. **apps/api** exposes signed `GET /jubelio/inventory/snapshot` (InternalSignGuard); web fetches Jubelio qty via `apiFetch`. Auto-correct writes `StockAdjustment` with `source = JUBELIO_RECONCILE` + `StockMovement` `refType = RECON`. FG-only scan (items with `JubelioProductMapping`). Overlap guard skips when a `ReconciliationRun` is already `RUNNING`. |
| D6 | Reservation modeling (EPIC-08) | **Resolved.** `StockReservation` ledger — one row per `salesorderDetailId` (unique), `state: ReserveState { RESERVED, CONSUMED, RELEASED }` — plus an aggregate `InventoryValue.reservedQty` (Decimal, default 0) kept in sync by the ledger writes. Three order-level helpers in `@elorae/db/reservation-writer.ts`: `reserveOrder` (webhook ingest — creates ledger rows + bumps `reservedQty`, raises `AdminNotification` on oversell), `consumeOrder` (ship — flips `RESERVED → CONSUMED`, deducts `InventoryValue.qtyOnHand` via a `StockAdjustment` stamped `source = FULFILLMENT_CONSUME`), `releaseOrder` (cancel — flips `RESERVED → RELEASED`, decrements `reservedQty` without touching `qtyOnHand`). Idempotency: unique `salesorderDetailId` on create, and every transition is a conditional `updateMany WHERE state = 'RESERVED'` so the Jubelio ship webhook and the ERP Ship button can both fire — whichever lands first wins, the other is a no-op. Model: **reserve-at-ingest, consume-onHand-at-ship, release-on-cancel**; `available = qtyOnHand - reservedQty`, derived at read time (not stored). Jubelio stock push (`stock-push.handler.ts`) sends `available` (`onHand - reserved`, clamped at 0), not raw `qtyOnHand`. |
| D7 | Warehouse scope on Jubelio stock push (EPIC-19 + EPIC-02-03) | **Push only main-warehouse availability.** Formula: `pushable = mainWarehouse.onHand - reserved - virtualWarehouseQty`. Konsi, canvasser-mobile, and any future virtual warehouses are excluded. Codified before EPIC-19 implementation; push helper enforces. |
| D8 | Offline vs marketplace `SalesOrder` (EPIC-17/18/22) | **Open — first EPIC plan decides.** Two options: (a) single dual-channel `SalesOrder` with `channel = OFFLINE_PUTUS | OFFLINE_KONSI`, (b) separate `OfflineSalesOrder` model. Affects every downstream report; punted until EPIC-17 brainstorm. |
| D9 | Auto-journal trigger (EPIC-13) | **In-Prisma-TX helper, not outbox queue.** Financial debit=credit invariant cannot be eventually consistent. `withJournal()` helper in `@elorae/db` participates in source transaction. |
| D10 | External integrations beyond Jubelio | **Punted.** No automation today (e-Faktur, bank reconciliation are manual). First concrete automated integration EPIC reopens this decision. |
| D11 | Role/permission model | **Open.** Six new roles incoming (SALESMAN, SPG, CANVASSER, COLLECTOR, FINANCE, ADMIN_PAJAK). Migration path: keep `Role` enum for now; revisit when count exceeds ~10 or dynamic role grants become a requirement. |
| D12 | Bulk migration job control (EPIC-02-05) | **Outbox-as-job-state.** No separate job table. Progress = `groupBy(status) WHERE enqueuedById=… AND createdAt > windowStart`. Cancel = delete PENDING rows for that batch. (Shipped via PR #41.) |
| D13 | `JubelioOutbox.entityType` registry | **Single source: `packages/db/src/jubelio-outbox.ts`.** Web `satisfies` typed insert + api router `never`-exhaustive switch. Typos = compile error. (Shipped this PR.) |
| D14 | `StockAdjustment.source` registry | **Single source: `packages/db/src/stock-adjustment-source.ts`.** Same pattern as D13. (Shipped this PR.) |
| D15 | Putus order granularity (EPIC-17-03) | **Item-level, not per-variant.** The PWA catalog + putus order lines operate at the `Item` level (order lines carry `variantSku = ""`, resolved to the variantless `InventoryValue` row) — even though Jubelio-ingested Items declare variants (size/color in `Item.variants`, e.g. `FG-JEANS-001` → sizes 30/32/34/36). Rationale: `InventoryValue` is tracked **item-level** (one `variantSku: null` row per item; no per-variant stock split at ingest), so item-level reserve/consume matches the stock model. Convention: variantless `InventoryValue` rows use `variantSku: null` (NOT `""`) — the field-sales reservation helpers (`reserveFieldSalesOrder`/`consumeFieldSalesOrder`/`releaseFieldSalesOrder`) look up inventory tolerating null-or-empty. **Consequence:** a putus order captures product + qty but NOT which variant (e.g. total jeans qty, not per-size). Accepted for now — variant selection deferred to fulfillment/picking. If per-variant putus orders become required, it needs a variant-aware PWA catalog/order (expand item → pick variant) + order lines carrying the real `variantSku` (reservation already supports it) + likely per-variant `InventoryValue` — a separate slice. |
