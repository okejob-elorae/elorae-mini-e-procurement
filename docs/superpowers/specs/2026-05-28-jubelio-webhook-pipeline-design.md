# Jubelio webhook processing pipeline — design

Status: **draft** · Branch: `feat/jubelio-sync` · Date: 2026-05-28

## 1. Goal

Drain Jubelio webhook events that the api currently only persists. Today the `JubelioWebhooksController` verifies the signature, dedups by payload hash, and writes a `JubelioWebhookEvent` row with `status:"RECEIVED"` — nothing reads it. This spec covers the queue, worker, retry/DLQ, and dashboard that consume those rows; plus the first real handler (`stock`) which decrements ERP inventory when Jubelio reports a marketplace sale.

Built as **sub-project 1** of the wider Jubelio sync work on this branch. Subsequent slices (outbound outbox, other inbound handlers, bulk migration) reuse the BullMQ + Redis infra landed here.

## 2. Scope

In scope:
- BullMQ + Redis (local Docker for dev; Upstash later).
- Webhook processing queue: enqueue from controller + periodic sweeper safety net.
- Worker with retry, exponential backoff, DLQ via DB-mirrored status.
- Event router. Real handler for `stock`. Typed `SKIPPED` for `salesorder` / `salesreturn` / `product`.
- Dual-write helper in `@elorae/db` to apply Jubelio-sourced stock adjustments per `docs/BOUNDARY.md` §3.1.
- Admin dashboard extension (counts by status, recent events table, raw payload view, manual retry).

Out of scope (own slices later):
- Outbound `JubelioOutbox` and ERP→Jubelio pushes.
- Real handlers for `salesorder` / `salesreturn` / `product` (need new tables and domain mapping).
- Initial bulk migration tool.
- Cross-service auth bridge (internal-key endpoint for instant retry).

## 3. Architecture

```
Jubelio ──POST──▶ apps/api  POST /webhooks/jubelio/:event
                    │
                    ▼
         JubelioWebhooksController
           (existing: signature verify, dedup, persist RECEIVED)
                    │  persist returns row.id
                    ▼
         WebhookQueueService.enqueue(rowId)
                    │  add BullMQ job to "jubelio-webhook"
                    ▼
         Redis (BullMQ) ──pulls──▶ WebhookProcessor (worker)
                                      │ load row, status=PROCESSING, attempts++
                                      ▼
                                   EventRouter
                                   ├─ stock      ──▶ StockHandler  (real)
                                   ├─ salesorder ──▶ SKIPPED (unhandled_event_type)
                                   ├─ salesreturn──▶ SKIPPED
                                   └─ product    ──▶ SKIPPED
                                      │ processed     │ skipped       │ throw
                                      ▼               ▼               ▼
                                   PROCESSED       SKIPPED        retry…→ DEAD
                                                                  + AdminNotification

         apps/api: @Cron every 10min ──▶ WebhookQueueService.sweep()
                                          re-enqueues RECEIVED rows lastEnqueuedAt > 5min old

         apps/web /backoffice/jubelio/admin (existing, admin-gated)
                  extended with webhook section + retry button
```

**Process model.** Worker runs in the same NestJS process as the api. Concurrency = 1 (serial); the volume does not justify per-SKU locking and avoids `InventoryValue` write races.

**Single source of truth.** The `JubelioWebhookEvent` row. BullMQ is transport + retry timing only. The worker writes back the terminal status. The dashboard queries Prisma, never Redis.

## 4. Data model

### 4.1 `JubelioWebhookEvent` — additions

```
skipReason       String?      // set when status=SKIPPED (e.g. "unhandled_event_type", "orphan_sku:<sku>")
deadAt           DateTime?    // set when status=DEAD
lastEnqueuedAt   DateTime?    // sweeper compares to detect stuck rows
```

`status` stays a `String` (not an enum migration). Valid values live in `apps/api/src/jubelio/queue/webhook-status.ts`: `RECEIVED`, `PROCESSING`, `PROCESSED`, `SKIPPED`, `DEAD`.

### 4.2 `StockAdjustment` — additions

Per `docs/BOUNDARY.md` §3.1, the api writes `StockAdjustment` (and updates `InventoryValue`) when a Jubelio stock webhook arrives. The current table is ERP-centric (human approver/creator required); this spec relaxes it to accept webhook-sourced rows:

```
source           String   @default("ERP")        // "ERP" | "JUBELIO_WEBHOOK"
idempotencyKey   String?  @unique                // sparse unique; webhook adjustments set it, ERP rows null
externalRef      String?                          // Jubelio item_code / event_id for traceability
approvedById     String?                          // was required; null for webhook-sourced
createdById      String?                          // was required; null for webhook-sourced
docNumber        String   @unique                 // KEEP unique; webhook rows get auto-generated e.g. "JBL-<eventId>"
@@index([source, createdAt])
```

Migration backfills existing rows to `source='ERP'`. Existing ERP code paths continue to populate `approvedById` / `createdById` — no change to their behavior. Nullability is the smallest change that admits webhook-sourced inserts without seeding a synthetic system user.

### 4.3 `JubelioProductMapping.jubelioItemCode`

Add `@unique`. The stock handler resolves Jubelio payload `item_code` → ERP `itemId` + `variantSku` via `findUnique` on this column. One Jubelio item code corresponds to one ERP variant by definition; the constraint is correct.

### 4.4 Dual-write helper — `packages/db/src/stock-writer.ts`

Exported from the `@elorae/db` main barrel (server-only; Prisma already there).

```
applyJubelioStockAdjustment({
  itemId, variantSku, newQty, idempotencyKey, externalRef, reason
}): Promise<{ adjustmentId: string; skipped: boolean }>
```

Inside one `prisma.$transaction`:

1. Insert `StockAdjustment` with `source:"JUBELIO_WEBHOOK"`, `idempotencyKey`, `prevQty`, `newQty`, etc. On `P2002` for `idempotencyKey` → return `{skipped:true}` (this webhook has already been applied; safe replay).
2. Read `InventoryValue` for `(itemId, variantSku)`; throw `NonRetryableError("InventoryValue not found")` if missing (item exists in mapping but no inventory row — schema-shaped problem, not transient).
3. Update `InventoryValue.qtyOnHand = newQty`. Stamp `prevQty` / `newQty` on the adjustment row.

## 5. Queue mechanics

### 5.1 Module layout (apps/api)

```
apps/api/src/jubelio/queue/
  jubelio-queue.module.ts          # registers BullMQ queue + worker via @nestjs/bullmq
  jubelio-queue.config.ts          # tuning constants
  webhook-queue.service.ts         # enqueue(rowId) + @Cron sweep()
  webhook-processor.service.ts     # BullMQ worker callback
  event-router.ts                  # pure dispatch by event type
  webhook-status.ts                # status + skipReason constants
apps/api/src/jubelio/handlers/
  stock.handler.ts                 # real
  unhandled.handler.ts             # returns SKIPPED unhandled_event_type
```

Dependencies: `bullmq`, `@nestjs/bullmq`, `ioredis`.

### 5.2 Local Redis

`docker-compose.dev.yml` at repo root (`docs/BOUNDARY.md` §9 D4):

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: [redis-data:/data]
volumes:
  redis-data:
```

`REDIS_URL` env (defaults to `redis://localhost:6379` if unset). Upstash for staging/prod later — same env var.

### 5.3 Tuning constants

```
QUEUE_NAME              = "jubelio-webhook"
JOB_ATTEMPTS            = 5                              // final failure → DEAD
BACKOFF                 = { type: "exponential", delay: 5000 }   // 5s, 10s, 20s, 40s, 80s
WORKER_CONCURRENCY      = 1
REMOVE_ON_COMPLETE      = { count: 1000 }
REMOVE_ON_FAIL          = { count: 5000 }
SWEEP_STUCK_AFTER_MS    = 5 * 60 * 1000                  // 5 min
SWEEP_BATCH             = 100
SWEEP_INTERVAL          = CronExpression.EVERY_10_MINUTES
```

### 5.4 Enqueue path

`JubelioWebhooksController` already returns `{id, duplicate}` from persist. Add one line:

```ts
const { id, duplicate } = await this.service.persist({ event, rawBody, signature, eventId });
if (!duplicate) await this.queue.enqueue(id);
return { ok: true, id, duplicate };
```

The controller still ACKs 200 to Jubelio immediately; enqueue is fire-and-forget from the response perspective (it awaits BullMQ but BullMQ insert is sub-millisecond against local/Upstash Redis).

`WebhookQueueService.enqueue`:

```ts
await this.q.add("process", { rowId }, {
  attempts: JOB_ATTEMPTS,
  backoff: BACKOFF,
  removeOnComplete: REMOVE_ON_COMPLETE,
  removeOnFail: REMOVE_ON_FAIL,
  jobId: rowId,          // BullMQ-level dedup on row id
});
await this.prisma.jubelioWebhookEvent.update({
  where: { id: rowId },
  data: { lastEnqueuedAt: new Date() },
});
```

### 5.5 Worker control flow

```ts
@Processor(QUEUE_NAME, { concurrency: WORKER_CONCURRENCY })
async process(job: Job<{ rowId: string }>) {
  const row = await this.prisma.jubelioWebhookEvent.findUnique({ where: { id: job.data.rowId } });
  if (!row) return;
  if (row.status === "PROCESSED" || row.status === "DEAD" || row.status === "SKIPPED") return;

  await this.prisma.jubelioWebhookEvent.update({
    where: { id: row.id },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });

  try {
    const outcome = await this.router.route(row);
    if (outcome.kind === "skipped") return this.markSkipped(row.id, outcome.reason);
    return this.markProcessed(row.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await this.prisma.jubelioWebhookEvent.update({ where: { id: row.id }, data: { lastError: msg } });
    if (err instanceof NonRetryableError) {
      await this.markDead(row.id, msg);
      return;
    }
    throw err;
  }
}

@OnWorkerEvent("failed")
async onJobFailed(job: Job<{ rowId: string }>, err: Error) {
  if (job.attemptsMade < JOB_ATTEMPTS) return;
  await this.markDead(job.data.rowId, err.message);
}
```

`markProcessed` / `markSkipped` / `markDead` are simple Prisma updates. `markDead` also calls `AdminNotificationService.write({ category: "jubelio-webhook", severity: "ERROR", title, message })`.

### 5.6 Stock handler

```ts
async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
  const payload = row.rawPayload as StockWebhookPayload;
  const mapping = await this.prisma.jubelioProductMapping.findUnique({
    where: { jubelioItemCode: payload.item_code },
  });
  if (!mapping) return { kind: "skipped", reason: `orphan_sku:${payload.item_code}` };

  await applyJubelioStockAdjustment({
    itemId: mapping.itemId,
    variantSku: mapping.erpVariantSku,
    newQty: Number(payload.end_qty),
    idempotencyKey: row.id,
    externalRef: payload.item_code,
    reason: `Jubelio stock webhook event ${row.id}`,
  });
  return { kind: "processed" };
}
```

The `StockWebhookPayload` type assumes Jubelio sends `{ item_code, end_qty, ... }` (sibling shape to `reference/jubelio/items-to-stock.json`). The exact payload structure is verified against a real webhook capture during implementation; if it differs, the type and the field reads in this handler are the only places that need updating.

### 5.7 Sweeper

```ts
@Cron(SWEEP_INTERVAL)
async sweep() {
  const cutoff = new Date(Date.now() - SWEEP_STUCK_AFTER_MS);
  const stuck = await this.prisma.jubelioWebhookEvent.findMany({
    where: {
      status: "RECEIVED",
      OR: [{ lastEnqueuedAt: null }, { lastEnqueuedAt: { lt: cutoff } }],
    },
    select: { id: true },
    take: SWEEP_BATCH,
  });
  for (const { id } of stuck) await this.enqueue(id);
  if (stuck.length > 0) this.logger.warn(`Sweeper re-enqueued ${stuck.length} stuck rows`);
}
```

### 5.8 Error classification

| Outcome | How it surfaces | Result |
|---|---|---|
| Handler returns `{kind:"processed"}` | normal return | row → `PROCESSED` |
| Handler returns `{kind:"skipped", reason}` | normal return | row → `SKIPPED` with reason |
| Handler throws `NonRetryableError` | caught in worker | row → `DEAD` immediately, AdminNotification |
| Handler throws any other error | rethrown to BullMQ | retry per backoff; after attemptsMade ≥ 5 → `DEAD` via `onJobFailed`, AdminNotification |
| Orphan SKU (no `JubelioProductMapping`) | handler returns `SKIPPED orphan_sku:<sku>` | no retry; surfaces in dashboard; admin re-queues after catalog ingest catches up |

## 6. Dashboard

Extend `apps/web/app/backoffice/jubelio/admin/page.tsx` (already admin-gated; the gate is `permissions.includes("*")` on the `jubelio_admin:view` route mapping).

Layout addition below the existing API-calls cards:

```
─ Webhook events (24h) ───────────────────────────────────
  RECEIVED  PROCESSING  PROCESSED  SKIPPED  DEAD
─ Recent webhook events ──────────────────────────────────
  time  event  status  attempts  flags/reason  [Retry]
─ filters ────────────────────────────────────────────────
  [all │ errors │ DEAD only]  [event type ▾]
```

Expand row → raw payload (formatted JSON), signature, full `lastError`, all timestamps.

### 6.1 Server actions — `apps/web/app/actions/jubelio-webhooks.ts`

Admin-gated via the existing `isAdmin()` helper used by `jubelio-api-calls.ts`.

```ts
getJubelioWebhookEvents(filters: { limit?: number; offset?: number; status?: string; event?: string })
  → { events: JubelioWebhookEvent[]; total: number };

getJubelioWebhookStats()
  → { windowHours: number; byStatus: Record<Status, number> };

retryJubelioWebhookEvent(id: string)
  → { ok: boolean };
```

### 6.2 Retry semantics

`retryJubelioWebhookEvent`:
- Allowed when status ∈ `{DEAD, SKIPPED}`. No-op otherwise.
- Sets `status='RECEIVED', attempts=0, lastError=null, deadAt=null, lastEnqueuedAt=null`.
- Does **not** call apps/api directly. The sweeper picks the row up within ~10 min.

Tradeoff: avoids a cross-service call and the still-pending internal-auth bridge. Cost: up to 10 min latency on manual retry. Acceptable for human-initiated retry of failed events; if instant retry becomes valuable, add an internal-key-gated `POST /webhooks/jubelio/retry/:id` endpoint as a follow-up.

## 7. Testing

| Layer | Tests | Approach |
|---|---|---|
| `applyJubelioStockAdjustment` helper | first apply; idempotent re-apply (P2002 → skipped); missing `InventoryValue` throws `NonRetryableError` | jest + Prisma testdb (or mocked Prisma if no testdb yet) |
| `stock.handler.ts` | payload → adjustment via helper; orphan SKU → SKIPPED reason; missing inventory throws | jest, mock prisma + helper |
| `event-router.ts` | `stock` → handler; `salesorder`/`salesreturn`/`product` → SKIPPED `unhandled_event_type`; unknown → SKIPPED `unknown_event:<x>` | pure unit, no mocks |
| `webhook-processor.service.ts` | RECEIVED → PROCESSING → PROCESSED on success; `NonRetryableError` → DEAD; other throw rethrows; settled rows return early | jest, mock router + prisma |
| Controller → enqueue integration | controller persist returns id; `queue.enqueue` called with that id; duplicate path skips enqueue | jest, mock BullMQ queue |
| BullMQ retry/backoff timing | skipped — trust the library |
| Live Redis end-to-end | skipped in CI — covered by manual smoke |

### 7.1 Manual smoke checklist

1. `docker compose -f docker-compose.dev.yml up -d redis`.
2. `pnpm -F @elorae/api prod` (build + migrate + start).
3. `curl -X POST` a valid-signature stock webhook to `/webhooks/jubelio/stock` with a known mapped SKU. Confirm row → `PROCESSED` and `InventoryValue.qtyOnHand` updated.
4. Re-POST the same payload → dedup at controller (no new row); if row id manually re-enqueued → `skipped:true` via helper idempotency. No double-decrement.
5. POST with an unmapped `item_code` → row → `SKIPPED orphan_sku:<sku>`.
6. POST with a payload that throws (force `InventoryValue` missing) → 5 retries, then `DEAD` + `AdminNotification`.
7. Click Retry on the DEAD row in the dashboard → row → `RECEIVED`; sweeper re-enqueues within 10 min.

## 8. Open items

- **Real stock-webhook payload shape.** Verify against a live capture before merging the stock handler. If `end_qty` is named differently or the value is a string, adjust the type in `stock.handler.ts`.
- **Variantless items.** `JubelioProductMapping.erpVariantSku` is `""` for variantless items per the catalog-sync convention. The helper accepts this; tests must cover it.
- **System user vs nullable approver.** This spec picks nullable. If audit policy later requires every `StockAdjustment` to carry attribution, seed a `JubelioWebhook` system user and switch the columns back to required — schema migration only.
- **Instant retry endpoint.** Sweeper-driven retry has up to 10 min latency. Internal-key-gated direct endpoint is a follow-up when the auth bridge lands.

## 9. References

- `docs/BOUNDARY.md` §3.1 (stock dual-write), §4.4 (webhook receiver behavior), §9 D1/D2/D4 (BullMQ + Redis + Docker).
- `reference/jubelio/items-to-stock.json` (REST shape; webhook payload assumed sibling).
- `apps/api/src/jubelio/webhooks/` (controller + service + signature already implemented).
- `apps/web/app/backoffice/jubelio/admin/page.tsx` (existing admin dashboard to extend).
