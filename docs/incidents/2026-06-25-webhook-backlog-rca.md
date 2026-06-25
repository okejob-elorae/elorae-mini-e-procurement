# RCA — Webhook Backlog + Sales Order Stall

**Incident date:** 2026-06-19 to 2026-06-25
**Resolved:** 2026-06-25
**Severity:** High — silent data lag. No outage, no error pages, but new sales orders stopped appearing in the ERP for ~6 days.
**Author:** ops / on-call

## TL;DR

Two unrelated bugs in `@elorae/db` compounded to silently stall the Jubelio webhook pipeline. The Prisma client recreated itself on every database call in production, churning the connection pool. The stock-adjustment writer's P2002 collision-detection didn't recognize MariaDB's `meta.target` shape, so legitimate idempotent retries raised errors instead of being skipped. Together, salesorder webhooks landed in the queue but failed during processing on the stock-adjustment write, stuck in RECEIVED, and the 10-minute sweeper re-enqueued them on a loop. Backlog grew to ~8,200 events. New sales orders dated 2026-06-19 onward did not appear in the dashboard.

## Detection

User-reported: "the last sales order item date is on 19 june" — noticed via the sales orders list page. No alarms fired; the worker process was alive, webhook receipts were succeeding, and HTTP-level metrics looked healthy. The failure was silent at the queue layer.

## Impact

- **Data lag:** ~8,200 salesorder webhooks unprocessed across 6 days. ~3,200 already processed during the window (intermittent successes between pool churn cycles).
- **Visibility loss:** sales-order dashboard, KPIs, fulfillment queue, and returns dashboard all showed stale data. Orders placed by customers WERE captured in the queue table — no data loss — but were not visible to ops staff or downstream features.
- **Cascading symptom:** print views (pick list / packing slip) and other DB-backed pages intermittently threw `pool is closed` / `pool timeout` errors. Reported as a separate symptom before the root cause was understood.
- **No customer-facing impact:** Jubelio remained the source of truth for marketplace operations. Buyers, payment, and shipment flows were unaffected.

## Timeline (UTC)

| Date | Event |
|---|---|
| 2026-06-14 | Commit `11e6f6f` (`fix(db): lazy-init prisma client via Proxy so build-time imports don't require DATABASE_URL`) ships. Bug 1 latent from this point. |
| 2026-05-28 | Stock-writer P2002 detection code present since EPIC-01 sub-1. Bug 2 latent since then, masked by the absence of collisions until the dual-owner stock-adjustment workload landed. |
| 2026-06-19 | First salesorder webhooks fail to process. Sweeper begins re-enqueuing 100 rows per 10-minute tick. Backlog starts growing faster than drain. |
| 2026-06-25 ~10:00 | User flags missing orders. Investigation begins. |
| 2026-06-25 ~10:30 | Pool churn identified (Bug 1). PR #60 merged. Auto-deploy applies fix to web. Print views recover. |
| 2026-06-25 ~12:00 | StockAdjustment unique-constraint collision identified (Bug 2). PR #63 merged. Auto-deploy attempts but api job race-conditions on the parallel git pull. |
| 2026-06-25 ~13:00 | Manual replay script (`scripts/replay-stuck-webhooks.mjs`) re-enqueues all 8,200 stuck rows after Bug 2 fix is live. Worker draining at ~9/min, below the ingest rate of ~11/min; backlog grows. |
| 2026-06-25 ~14:00 | PR #66 bumps `JUBELIO_WORKER_CONCURRENCY` default 1 → 4 (env-overridable). Drain rate jumps to ~45/min. |
| 2026-06-25 ~16:00 | Backlog cleared. Worker processes new arrivals in real time. Verified via direct-DB age-bucket query. |

## Root causes

### Bug 1 — Prisma client recreated on every call in production

**File:** `packages/db/src/index.ts`
**Introduced:** 2026-06-14 (`11e6f6f`)
**Fixed:** 2026-06-25 (`4a2b31d`, PR #60)

The Prisma client was wrapped in a lazy-init `Proxy` to make `@elorae/db` import-safe at build time when `DATABASE_URL` is not set. The getter routes every property access through `getPrismaClient()`, which performs a schema-fingerprint check and recreates the cached client on a mismatch:

```ts
function getPrismaClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached && globalForPrisma.prismaSchemaStamp !== SCHEMA_STAMP) {
    void cached.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}
```

The stamp was set ONLY when `NODE_ENV !== "production"`:

```ts
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaSchemaStamp = SCHEMA_STAMP;
}
```

In production, `prismaSchemaStamp` stayed `undefined` forever. Every call after the first hit the cache-invalidation branch, disconnected the client, and recreated it. The mariadb connection pool churned continuously: open, do one query, disconnect, open again. Under load, two operations could race on the pool teardown, surface as `pool is closed`, and propagate to the caller.

**Fix:** stamp the global INSIDE `getPrismaClient` when the client is created, regardless of `NODE_ENV`. Remove the conditional bottom-of-module stamp.

### Bug 2 — Narrow P2002 collision detection

**File:** `packages/db/src/stock-writer.ts`
**Introduced:** EPIC-01 sub-1 (2026-05-28)
**Fixed:** 2026-06-25 (`2df7f18`, PR #63)

`applyJubelioStockAdjustment` catches Prisma's `P2002` unique-violation error to swallow idempotent retries — a re-delivered Jubelio webhook with the same `idempotencyKey` should be a no-op, not a failure. The check inspected `err.meta.target` and matched against literal column names:

```ts
const isIdempotencyCollision =
  targets.includes("idempotencyKey") || targets.includes("docNumber");
```

On Postgres, `meta.target` is an array of column names. On MySQL / MariaDB (the adapter we use), `meta.target` is a STRING containing the INDEX NAME — e.g. `"StockAdjustment_docNumber_key"`. The check matched neither, so the P2002 error was rethrown. The salesorder webhook handler caught it, logged `Stock adjustment failed for salesorder N line M: Unique constraint failed`, and added the line to `unmappedLines`. The webhook row stayed `RECEIVED` (status only flips to `PROCESSED` on success). The 10-minute sweeper picked it up and re-enqueued. Same code path, same failure, infinite loop.

**Fix:** broaden the substring test to recognize the index-name format used by MariaDB:

```ts
const isIdempotencyCollision = targets.some((t) => {
  const s = String(t);
  return /(^|_)(idempotencyKey|docNumber)(_|$)/.test(s)
    || s === "idempotencyKey" || s === "docNumber";
});
```

Both Postgres array-of-column and MariaDB index-name shapes are now caught.

## Why neither bug was caught earlier

- **Bug 1** survived because dev environments have `NODE_ENV !== "production"`, where the stamp was set correctly at module load. The fix file (`fix(db): lazy-init prisma client via Proxy`) passed type-check, passed local smoke tests, and the integration test suite (jest, apps/api) uses a mocked Prisma client — never exercised the global-singleton path under prod-shaped NODE_ENV.
- **Bug 2** survived because existing tests covered the Postgres-style target shape only (`meta.target: ["idempotencyKey"]`). The mariadb-adapter shape (`meta.target: "StockAdjustment_docNumber_key"`) was never exercised in tests. Local dev uses the same mariadb adapter, but unique-constraint collisions are rare in single-user dev workflows.

Both bugs were silent in pre-prod conditions and only manifested under sustained production load.

## Contributing factors

- **No alerting on queue depth.** `JubelioWebhookEvent` row counts by status are queryable, but no monitor exists to fire when `RECEIVED` count exceeds a threshold over time.
- **Sweeper masks failures.** The 10-minute re-enqueue loop hides processing errors behind apparent activity. A row that fails every retry looks indistinguishable from a row that's about to succeed.
- **Worker concurrency = 1.** Even after the bugs were fixed, the single-worker drain rate (~9/min) was below the ingest rate (~11/min). The backlog kept growing until concurrency was bumped to 4. Default concurrency was set conservatively without measurement.
- **No queue dashboard.** Operators couldn't see queue health at a glance. Each diagnostic required running a Prisma client outside the running api container.

## Action items

### Done in this incident

- [x] PR #60 — Fix Prisma client churn (`4a2b31d`)
- [x] PR #63 — Broaden P2002 collision detection for MariaDB (`2df7f18`)
- [x] PR #63 ships `scripts/replay-stuck-webhooks.mjs` — one-off recovery tool (also useful for future backlog events)
- [x] PR #66 — Bump default `JUBELIO_WORKER_CONCURRENCY` to 4, env-overridable
- [x] Backlog drained, real-time visibility restored

### Open follow-ups

- [ ] **Queue-depth alert.** Add an admin alert (using `AdminNotificationService`) that fires when `RECEIVED` count for the last 7 days exceeds a threshold (e.g. 500) AND the oldest `RECEIVED` row is older than 30 minutes. Catches both "processor dead" and "processor slower than ingest" cases.
- [ ] **Queue-depth dashboard panel.** Add status breakdown (`RECEIVED / PROCESSING / PROCESSED / DEAD`) to the existing Jubelio admin page. Show oldest-RECEIVED age. Operators see backlog without writing SQL.
- [ ] **Sweeper retry cap.** Currently sweeper re-enqueues indefinitely. Add a per-row attempt counter; after N failures, move to a DEAD-letter status so the row stops appearing in `RECEIVED` and surfaces as a real failure for ops review.
- [ ] **Test coverage for mariadb-shape Prisma errors.** Bug 2's test suite missed the index-name target shape. Audit other writer helpers (`item-writer`, `sales-return-writer`, `sales-order-fulfillment-writer`) for similar P2002 catches and add mariadb-shape test cases where they exist.
- [ ] **Production-mode test.** Add a smoke test that imports `@elorae/db` with `NODE_ENV=production` set, exercises the global-singleton path with two sequential calls, and asserts no `$disconnect` is called between them. Would have caught Bug 1.
- [ ] **Worker-concurrency sizing.** Default 4 was a guess. Measure steady-state ingest rate over a normal week and set the default to ~3× that rate for headroom during catch-up.

## Related artifacts

- Recovery script: `scripts/replay-stuck-webhooks.mjs`
- Diagnostic query (still in scratchpad): age-bucket histogram by webhook status
- Memory: `feedback_bullmq_retry_reset` (Redis ZREM + DEL after manual status reset; relevant for outbox retries, not webhooks, but related ops shape)
