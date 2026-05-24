# Service boundary — `apps/web` ↔ `apps/api`

Status: **active** · Owner: backend integration · Last updated: 2026-05-24

This document defines the responsibility split between the Next.js app
(`apps/web`) and the NestJS Jubelio integration service (`apps/api`) in the
Elorae monorepo. It is the source of truth for *who writes what* and *how the
two services talk*. Any PR that violates the rules below must either update
this document or be rejected.

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
| Jubelio token | Proactive scheduled refresh (cron) + exponential backoff on `refresh()` failure + admin alert on persistent failure | ⏳ |
| Webhooks | Receivers (`salesorder`, `stock`, `salesreturn`, `product`) + signature verify | ⏳ |
| Outbox queue | `JubelioOutbox` table + BullMQ producer/consumer + DLQ + retry policy | ⏳ |
| API audit | `JubelioApiCall` audit log + HTTP interceptor + 429 rate-limit handling | ⏳ |
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
| Jubelio webhook receivers              |            | ⏳          | planned |
| Long-running jobs and queues           |            | ⏳          | planned |
| Audit log writer (Jubelio side)        |            | ⏳          | planned |
| RBAC guard for Jubelio endpoints       |            | ⏳          | planned (auth bridge) |
| Catalog push                           |            | ⏳          | planned |
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
| `Item`, `ItemVariant`          | web                         | api (read for push)         | ✅ |
| `Supplier`, `SupplierType`     | web                         | —                           | ✅ |
| `GRN`, `GRNItem`               | web                         | api (read)                  | ✅ |
| `PurchaseOrder`, `POItem`      | web                         | api (read)                  | ✅ |
| `VendorReturn`                 | web                         | —                           | ✅ |
| `Production*`                  | web                         | api (read FG receipts)      | ✅ |
| `InventoryValue`               | **both** — see §3.1         |                             | ✅ schema; 🟡 dual-write helper ⏳ |
| `StockAdjustment`              | **both** — see §3.1         |                             | ✅ schema; 🟡 dual-write helper ⏳ |
| `SalesOrder`                   | **both** — see §3.2         |                             | ✅ schema; 🟡 ownership guard ⏳ |
| `SalesOrderItem`               | api                         | web (read)                  | ✅ schema; api writer ⏳ |
| `SalesReturn`                  | api                         | web (read)                  | ⏳ |
| `JubelioProductMapping`        | api                         | web (read)                  | ⏳ |
| `JubelioCategoryMapping`       | api                         | web (read)                  | ⏳ |
| `JubelioOutbox`                | web insert, api consume/update | —                        | ⏳ |
| `JubelioWebhookEvent`          | api                         | —                           | ⏳ |
| `JubelioApiCall`               | api                         | web (read for admin UI)     | ⏳ |
| `SystemSetting` (Jubelio keys) | api                         | web (read for settings UI)  | ✅ (`JUBELIO_SESSION_TOKEN`) |
| `SystemSetting` (other keys)   | web                         | —                           | ✅ |
| `AuditLog`                     | both — shared writer        | —                           | ✅ schema; 🟡 shared writer ⏳ |
| `Notification`                 | both                        | —                           | ✅ |

### 3.1 Stock writes — two writers (⏳ planned)

- **web** writes `InventoryValue` and `StockAdjustment` when an ERP action
  triggers (`receiveFG`, `createGRN`, `createStockAdjustment`,
  manual adjustment). Same transaction inserts `JubelioOutbox` row of type
  `stock-adjustment.push`.
- **api** writes `InventoryValue` and `StockAdjustment` when the Jubelio
  `stock` webhook arrives (external mutation in Jubelio).

Both writes go through a shared helper in `@elorae/db` to enforce the columns:
`source ('ERP' | 'JUBELIO_WEBHOOK')`, `externalRef`, `idempotencyKey`.

### 3.2 Sales writes — two writers (⏳ planned)

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

### 4.2 `web → api` (async, write-coupled via outbox) — ⏳ planned

ERP action commits local write **and** `JubelioOutbox` row in one Prisma
transaction. api outbox worker (BullMQ + Upstash Redis) drains:

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

### 4.3 `api → web` (rare) — ⏳ planned

Only for cache invalidation:
- `POST /api/internal/revalidate` with `{ paths: string[] }`.
- Auth: shared `INTERNAL_API_KEY` header (env), **not** user JWT.

Avoid otherwise. Prefer api owning its own data and web fetching from api.

### 4.4 Jubelio → api (webhooks) — ⏳ planned

- Path: `POST /webhooks/jubelio/:event` (events: `salesorder`, `stock`,
  `salesreturn`, `product`).
- Verify Jubelio signature header `webhook-signature`:
  `sha256(JSON.stringify(rawBody) + WEBHOOK_SECRET)` (per Jubelio docs — not
  strict HMAC).
- Persist raw payload to `JubelioWebhookEvent` table, ack 200 immediately,
  process asynchronously via BullMQ queue.
- Idempotency: dedupe by Jubelio's `event_id` (or hash of payload if missing).
- Jubelio retries non-200 responses up to 3 times — return 200 quickly even
  when payload processing is deferred to the queue.

---

## 5. Auth model

| Endpoint type           | Mechanism                                              | State |
| ----------------------- | ------------------------------------------------------ | :---: |
| api: user-facing        | NextAuth JWT (shared secret) + RBAC guard              | ⏳ |
| api: webhook receivers  | Jubelio `webhook-signature` header (sha256 scheme)     | ⏳ |
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
| Token expired    | api auto-refreshes within 5 min of expiry (on demand). Single-flight refresh per process.          | ✅ on-demand; ⏳ proactive cron + alert on persistent failure |
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
- ❌ api writing to `User`, `Role`, `Permission`, `Item`, `GRN`, `PO`, or any
  table marked web-owned.

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
| Q1 | Webhook signature | Jubelio uses `sha256(JSON.stringify(payload) + SECRET_KEY)` — NOT strict HMAC. Header: `webhook-signature`. Secret configured in Jubelio dashboard (Pengaturan → Developer → Webhook). Rate limit: 600 req/min, 429 on exceed. Jubelio retries non-200 callbacks up to 3 times. |
| Q2 | Redis | **Upstash Redis** (managed). Free tier covers MVP. Used by BullMQ. |
| Q3 | api deployment | **Render** (persistent web service, Docker). |
| Q4 | Audit log writer | Shared helper in `@elorae/db` (e.g. `writeAuditLog()`). Single Prisma call site. Both services call it. |
| Q5 | `SystemSetting` namespace | api-owned keys prefixed `JUBELIO_*` (e.g. `JUBELIO_SESSION_TOKEN`). All other keys web-owned. Enforce in a small helper that rejects writes from the wrong owner. |
| D1 | Outbound queue | **BullMQ + Upstash Redis** (per Q2). All `apps/web` → `apps/api` async writes enqueued; `apps/api` workers drain. |
| D2 | Admin alert channel | **In-DB `AdminNotification` table.** Written by api on token-refresh failure, outbox-stuck, rate-limit hit, etc. Consumed by apps/web admin UI. |
| D3 | Admin dashboard | **Full UI in apps/web** at `/backoffice/jubelio/admin` — queue depth, failed items, audit log, outbox status, retry buttons. api exposes JSON endpoints; apps/web renders. |
| D4 | Local Redis | **Docker compose** (`redis:7-alpine`) declared in repo-root `docker-compose.dev.yml`. apps/api reads `REDIS_URL` env. Upstash used for staging/prod. |
