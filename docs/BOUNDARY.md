# Service boundary — `apps/web` ↔ `apps/api`

Status: **draft** · Owner: backend integration · Last updated: 2026-05-21

This document defines the responsibility split between the Next.js app
(`apps/web`) and the NestJS Jubelio integration service (`apps/api`) in the
Elorae monorepo. It is the source of truth for *who writes what* and *how the
two services talk*. Any PR that violates the rules below must either update
this document or be rejected.

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
not call Jubelio directly.

---

## 2. Service responsibilities

| Concern                              | `apps/web` | `apps/api` |
| ------------------------------------ | :--------: | :--------: |
| UI rendering (App Router)            | ✅          |            |
| NextAuth session                     | ✅          |            |
| ERP CRUD (items, GRN, PO, vendors)   | ✅          |            |
| Production / costing / reports       | ✅          |            |
| RBAC checks (UI + ERP actions)       | ✅          |            |
| Audit log writer (ERP side)          | ✅          |            |
| Encryption / decryption (supplier PII) | ✅        |            |
| File upload (R2, GRN photos)         | ✅          |            |
| Firebase admin (push notifications)  | ✅          |            |
| Jubelio HTTP client + token cache    |            | ✅          |
| Jubelio webhook receivers            |            | ✅          |
| Catalog push (L2)                    |            | ✅          |
| Marketplace listing (L3)             |            | ✅          |
| Stock push (L4)                      |            | ✅          |
| Sales order ingest (L5)              |            | ✅          |
| WMS pick / pack / ship (L6)          |            | ✅          |
| Returns ingest (L7)                  |            | ✅          |
| Long-running jobs and queues         |            | ✅          |
| RBAC guard for Jubelio endpoints     |            | ✅          |
| Audit log writer (Jubelio side)      |            | ✅          |

---

## 3. Data ownership

**Write owner** is the service authorised to issue `INSERT`/`UPDATE`/`DELETE`
on the table. Reads are unrestricted via `@elorae/db`.

| Table                          | Owner                       | Reads from other         |
| ------------------------------ | --------------------------- | ------------------------ |
| `User`, `Role`, `Permission`   | web                         | api (read)               |
| `Item`, `ItemVariant`          | web                         | api (read for push)      |
| `Supplier`, `SupplierType`     | web                         | —                        |
| `GRN`, `GRNItem`               | web                         | api (read)               |
| `PurchaseOrder`, `POItem`      | web                         | api (read)               |
| `VendorReturn`                 | web                         | —                        |
| `Production*`                  | web                         | api (read FG receipts)   |
| `InventoryValue`               | **both** — see §3.1         |                          |
| `StockAdjustment`              | **both** — see §3.1         |                          |
| `SalesOrder`                   | **both** — see §3.2         |                          |
| `SalesOrderItem`               | api                         | web (read)               |
| `SalesReturn`                  | api                         | web (read)               |
| `JubelioProductMapping`        | api                         | web (read)               |
| `JubelioCategoryMapping`       | api                         | web (read)               |
| `JubelioOutbox`                | web insert, api consume/update | —                     |
| `SystemSetting` (Jubelio keys) | api                         | web (read for settings UI) |
| `SystemSetting` (other keys)   | web                         | —                        |
| `AuditLog`                     | both — shared writer        | —                        |
| `Notification`                 | both                        | —                        |

### 3.1 Stock writes — two writers

- **web** writes `InventoryValue` and `StockAdjustment` when an ERP action
  triggers (`receiveFG`, `createGRN`, `createStockAdjustment`,
  manual adjustment). Same transaction inserts `JubelioOutbox` row of type
  `stock-adjustment.push`.
- **api** writes `InventoryValue` and `StockAdjustment` when the Jubelio
  `stock` webhook arrives (external mutation in Jubelio).

Both writes go through a shared helper in `@elorae/db` to enforce the columns:
`source ('ERP' | 'JUBELIO_WEBHOOK')`, `externalRef`, `idempotencyKey`.

### 3.2 Sales writes — two writers

- **api** creates `SalesOrder` rows from Jubelio (ingest endpoint or webhook
  `salesorder`). It owns Jubelio-mirrored fields: marketplace metadata, AWB,
  Jubelio status.
- **web** updates `SalesOrder` only for fields it owns: internal status,
  picking notes, fulfillment user. When a web-owned change must mirror back to
  Jubelio (e.g. mark-as-complete), web inserts a `JubelioOutbox` row.

Field-level ownership is enforced by Prisma client middleware in
`@elorae/db/sales-order-guard.ts`.

---

## 4. Communication patterns

### 4.1 `web → api` (sync, low-volume)

User-facing flows where api must respond inline.

- Use cases: "Push catalog now" button, fetch WMS list for UI, fetch Jubelio
  token state, manual sync trigger.
- Auth: NextAuth JWT in cookie → forwarded by web server action as
  `Authorization: Bearer <jwt>` → Nest verifies with shared `NEXTAUTH_SECRET`.
- Latency budget: 200 ms guard at gateway. Errors surfaced to user.

### 4.2 `web → api` (async, write-coupled via outbox)

ERP action commits local write **and** `JubelioOutbox` row in one Prisma
transaction. api outbox worker (BullMQ + Redis) drains:

```
loop every N seconds:
  rows = SELECT * FROM JubelioOutbox WHERE status='PENDING' ORDER BY id ASC LIMIT 50
  for each row:
    try: call Jubelio
    on success: row.status='DONE', row.completedAt=now
    on failure: row.attempts++, row.lastError=...,
                row.status='FAILED' (retried) or 'DEAD_LETTER' (if attempts >= max)
                next retry delayed by exponential backoff
```

- **Idempotency key:** `${entityType}:${entityId}:${version}` — Jubelio call
  must accept this key (or be naturally idempotent).
- **No sync HTTP call** from a Prisma transaction. Always outbox.

### 4.3 `api → web` (rare)

Only for cache invalidation:
- `POST /api/internal/revalidate` with `{ paths: string[] }`.
- Auth: shared `INTERNAL_API_KEY` header (env), **not** user JWT.

Avoid otherwise. Prefer api owning its own data and web fetching from api.

### 4.4 Jubelio → api (webhooks)

- Path: `POST /webhooks/jubelio/:event` (events: `salesorder`, `stock`,
  `salesreturn`, `product`).
- Verify Jubelio signature if HMAC available; otherwise IP allowlist.
- Persist raw payload to `JubelioWebhookEvent` table, ack 200 immediately,
  process asynchronously via BullMQ queue.
- Idempotency: dedupe by Jubelio's `event_id` (or hash of payload if missing).

---

## 5. Auth model

| Endpoint type           | Mechanism                                              |
| ----------------------- | ------------------------------------------------------ |
| api: user-facing        | NextAuth JWT (shared secret) + RBAC guard              |
| api: webhook receivers  | Jubelio signature (if HMAC) or IP allowlist            |
| api: internal (web→api) | Shared bearer JWT (same `NEXTAUTH_SECRET`)             |
| api → web revalidate    | Shared `INTERNAL_API_KEY` (env, rotated quarterly)     |

- Permission constants live in `@elorae/types/erp/permissions`. Both services
  import them. No duplication.
- RBAC matrix in `apps/web/lib/rbac.ts` is the single source. api imports it
  via `@elorae/types` re-export.

---

## 6. Failure modes

| Failure          | Behaviour                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| api down         | web ERP fully functional. `JubelioOutbox` accumulates. No data loss. Drains on api restart.        |
| Jubelio down     | api outbox retries with backoff. UI shows "N items pending Jubelio sync" indicator.                |
| web down         | api still ingests Jubelio webhooks and persists. Outbox idle (no producers).                       |
| DB down          | Both services 500. Standard.                                                                       |
| Outbox stuck     | Alert when `PENDING + FAILED > threshold` for `> X min`. Manual replay tool in api admin.          |
| Webhook replay   | Dedup by `event_id` in `JubelioWebhookEvent`. Safe to replay.                                      |
| Token expired    | api auto-refreshes 5 min before expiry. Single-flight refresh (one in-flight call per process).    |
| Schema drift     | Migrations run only via `@elorae/db`. CI blocks PRs that add migrations elsewhere.                 |

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
- ❌ api writing to `User`, `Role`, `Permission`, `Item`, `GRN`, `PO`, or any
  table marked web-owned.

---

## 8. Migration checklist (current repo → target layout)

1. `git mv frontend apps/web` (and drop `apps/web/prisma/` after step 2).
2. Create `packages/db`; move `frontend/prisma/*` to `packages/db/prisma/`.
3. Update `apps/web` imports of `@/lib/prisma` → `@elorae/db`.
4. Remove `backend/` Go scaffold (throwaway).
5. `nest new apps/api`; wire to workspace; import `@elorae/db` and
   `@elorae/types`.
6. `git mv jubelio reference/jubelio` (sample JSON + yaml + plans).
7. Add `pnpm-workspace.yaml`, `turbo.json`, root `package.json`.
8. CI: block migrations outside `@elorae/db`; lint forbidden imports
   (`apps/api` → `apps/web`).

---

## 9. Open questions

- Webhook signature: does Jubelio provide HMAC? Confirm against
  `reference/jubelio/jubelio-api-docs.yaml`.
- Redis: Upstash, self-host, or Vercel KV? (KV does not support BullMQ.)
- api deployment target: Fly.io, Render, Railway, or self-host container?
- Audit log writer: shared writer in `@elorae/db`, or each service writes
  directly? Recommended: shared helper, one Prisma call.
- `SystemSetting` namespace split: prefix keys with `JUBELIO_*` for api-owned;
  others web-owned. Enforce in helper.
