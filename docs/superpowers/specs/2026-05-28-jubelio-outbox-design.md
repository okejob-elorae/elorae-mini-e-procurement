# Jubelio outbound outbox — design

Status: **draft** · Branch: `feat/jubelio-outbound` · Date: 2026-05-28

## 1. Goal

Ship the outbound counterpart to the inbound webhook pipeline that landed in `feat/jubelio-sync`: a `JubelioOutbox` table on the shared TiDB, a BullMQ-backed drain worker, and the first real producer (admin-triggered stock push to Jubelio). Closes the outbound half of the sync queue story and delivers the manual-trigger version of "stock Elorae → Jubelio" with full retry/DLQ/observability semantics.

Built as **sub-project 2** of the wider Jubelio sync work. Follows the existing decomposition; reuses the BullMQ + Redis infra established by sub-1.

## 2. Scope

In scope:
- New `JubelioOutbox` table on TiDB.
- BullMQ queue `jubelio-outbox` on the existing Redis instance.
- Poller (`@Interval` 5s) in apps/api that scans PENDING rows + recovers stuck PROCESSING rows.
- Worker (concurrency 1) with the same retry/backoff/DLQ semantics as the inbound pipeline; status mirrored on the row.
- Router dispatches by `entityType`. Real `stock_push` handler that re-resolves current ERP inventory and pushes to Jubelio.
- Two producer surfaces in apps/web: per-item admin button on the item detail page, and a bulk "Sync all stock to Jubelio" button on the existing admin dashboard.
- Outbox events section appended to `/backoffice/jubelio/admin` (counts cards, events table, row expand, retry button) mirroring the existing webhook section.

Out of scope (later slices):
- Auto-enqueue from ERP server actions (GRN receive, FG receipt, manual stock adjustment) — these land alongside their domain features in follow-up sub-projects.
- Cross-service auth bridge (web → api JWT). Sub-2.5 will introduce it and is the natural moment to optionally replace the poller with direct enqueue.
- Real handlers for other `entityType` values (product push, HPP push) — sub-3.
- Bulk initial migration tooling — sub-5.

## 3. Architecture

```
apps/web
  ├─ item detail page  ──admin click──▶ pushItemStockToJubelio(itemId)  ──INSERT──┐
  ├─ admin dashboard   ──admin click──▶ bulkPushAllStockToJubelio()    ──INSERT N─┤
  ├─ admin dashboard   ──read──────────▶ getJubelioOutboxRows / Stats             │
  └─ admin dashboard   ──click Retry───▶ retryJubelioOutboxRow(id)                │
                                                                                  ▼
                                                                       JubelioOutbox (TiDB)
                                                                                  │
apps/api                                                                          │
  ├─ OutboxPoller    @Interval(5_000)  ◀───── scans PENDING + stuck PROCESSING ──┘
  │                    └▶ enqueue BullMQ job, stamp lastEnqueuedAt
  ├─ BullMQ queue "jubelio-outbox"  (shared Redis with "jubelio-webhook")
  │                    ▶ 5 attempts, exponential 5s backoff, concurrency 1
  └─ OutboxProcessor  (worker)
        ├─ load row, mark PROCESSING + attempts++
        ├─ route by entityType:
        │     "stock_push" → StockPushHandler
        ├─ outcome:
        │     {kind:"processed"}        → DONE
        │     {kind:"skipped", reason}  → SKIPPED with reason
        │     NonRetryableError throw   → DEAD + AdminNotification
        │     other throw               → BullMQ retry; on attemptsMade ≥ 5 → DEAD + AdminNotification
        └─ status writes are this branch's responsibility; DB row is canonical
```

**Process model.** Worker runs in the apps/api Nest process alongside the inbound pipeline's `WebhookProcessor`. Two separate BullMQ queues, one shared `BullModule.forRootAsync` already wired by sub-1. Concurrency = 1 on the outbox worker (no per-Jubelio-item race; volume justifies nothing more).

**Single source of truth.** The `JubelioOutbox` row. BullMQ is transport + retry timing only. The worker writes back the terminal status. The dashboard queries Prisma, never Redis.

**Poller vs direct-enqueue.** Because the producer is apps/web and the BullMQ client lives in apps/api, web can't enqueue directly without crossing the service boundary. Three options exist: (a) a poller in apps/api, (b) an internal HTTP enqueue endpoint web calls, (c) web touches Redis directly. Option (c) violates the boundary. Option (b) requires the still-pending auth bridge. Option (a) — the poller — is what `docs/BOUNDARY.md §4.2` specifies literally, costs ~5s extra latency to first job pickup (irrelevant for non-user-blocking stock push), and matches a pattern sub-1 already uses for stuck-row recovery. Going with (a). When the auth bridge lands in sub-2.5, swapping in direct enqueue is a localized refactor.

## 4. Data model

### 4.1 `JubelioOutbox` — new table

```prisma
model JubelioOutbox {
  id              String    @id @default(cuid())
  entityType      String                          // "stock_push" for this branch
  entityId        String                          // Item.id for stock_push
  payload         Json      @default("{}")        // free-form per entityType; empty for stock_push (re-resolved at worker)
  status          String    @default("PENDING")   // PENDING | PROCESSING | DONE | SKIPPED | DEAD
  attempts        Int       @default(0)
  lastError       String?   @db.Text
  skipReason      String?                          // "missing_mapping" | "no_inventory" | "unknown_entity_type:<x>"
  enqueuedById    String?
  enqueuedBy      User?     @relation("EnqueuedOutbox", fields: [enqueuedById], references: [id], onDelete: NoAction, onUpdate: NoAction)
  createdAt       DateTime  @default(now())
  lastEnqueuedAt  DateTime?
  processedAt     DateTime?
  deadAt          DateTime?

  @@index([status, createdAt])         // poller scan
  @@index([entityType, entityId])      // per-entity diagnostic
  @@index([enqueuedById])
}
```

`User` model gets the inverse relation:
```prisma
enqueuedOutbox JubelioOutbox[] @relation("EnqueuedOutbox")
```

### 4.2 Status state machine

```
PENDING ──poller picks──▶ (BullMQ job created)
         ──worker takes──▶ PROCESSING
                           ├─ success                    ──▶ DONE     (processedAt set)
                           ├─ retryable error            ──▶ stays PROCESSING; BullMQ schedules retry; attempts++
                           ├─ no mapping / no inventory  ──▶ SKIPPED  with skipReason
                           ├─ NonRetryableError thrown   ──▶ DEAD     immediately + AdminNotification
                           └─ max attempts exceeded      ──▶ DEAD     via onJobFailed + AdminNotification
```

Terminal: `DONE`, `SKIPPED`, `DEAD`. Worker early-return guard treats all three as settled.

### 4.3 Skip reason constants

```
missing_mapping            — Item has no JubelioProductMapping row (ERP-only item)
no_inventory               — Item exists but no InventoryValue rows
unknown_entity_type:<x>    — Router fallback for entity types we don't handle yet
```

### 4.4 Migration

`20260528200000_add_jubelio_outbox` — single CREATE TABLE + 3 indexes. Backfill not needed (no historical rows).

## 5. Queue mechanics

### 5.1 Module layout

```
apps/api/src/jubelio/outbox/
  jubelio-outbox.module.ts          # registers BullMQ queue + worker + handlers
  jubelio-outbox.config.ts          # tuning constants
  outbox-status.ts                  # status + skip reason constants
  outbox-poller.service.ts          # @Interval poller — primary drain
  outbox-processor.service.ts       # BullMQ worker callback
  outbox-router.ts                  # dispatch by entityType
  handlers/
    handler.types.ts                # OutboxHandler interface, reuses HandlerOutcome from sub-1
    stock-push.handler.ts           # real handler
```

Reuses from sub-1: `HandlerOutcome` type (`apps/api/src/jubelio/handlers/handler.types.ts`), `NonRetryableError` (`apps/api/src/jubelio/queue/errors.ts`), `AdminNotificationService`, and the shared `BullModule.forRootAsync` in `app.module.ts`.

No new deps.

### 5.2 Tuning constants

```ts
QUEUE_NAME              = "jubelio-outbox"
JOB_ATTEMPTS            = 5
BACKOFF                 = { type: "exponential", delay: 5_000 }   // 5s, 10s, 20s, 40s, 80s
WORKER_CONCURRENCY      = 1
REMOVE_ON_COMPLETE      = { count: 1_000 }
REMOVE_ON_FAIL          = { count: 5_000 }
POLL_INTERVAL_MS        = 5_000                                    // primary drain
POLL_STUCK_AFTER_MS     = 5 * 60 * 1_000                           // 5 min fallback
POLL_BATCH              = 100
```

### 5.3 Poller

```ts
@Interval("jubelio-outbox-poller", POLL_INTERVAL_MS)
async poll(): Promise<void> {
  const cutoff = new Date(Date.now() - POLL_STUCK_AFTER_MS);
  const ready = await this.prisma.jubelioOutbox.findMany({
    where: {
      OR: [
        { status: OUTBOX_STATUS.PENDING, lastEnqueuedAt: null },
        { status: OUTBOX_STATUS.PENDING, lastEnqueuedAt: { lt: cutoff } },
        { status: OUTBOX_STATUS.PROCESSING, lastEnqueuedAt: { lt: cutoff } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true },
    take: POLL_BATCH,
  });
  for (const row of ready) {
    try {
      if (row.status === OUTBOX_STATUS.PROCESSING) {
        await this.prisma.jubelioOutbox.update({
          where: { id: row.id },
          data: { status: OUTBOX_STATUS.PENDING },
        });
      }
      await this.q.add("process", { rowId: row.id }, {
        attempts: JOB_ATTEMPTS,
        backoff: BACKOFF,
        removeOnComplete: REMOVE_ON_COMPLETE,
        removeOnFail: REMOVE_ON_FAIL,
        jobId: row.id,
      });
      await this.prisma.jubelioOutbox.update({
        where: { id: row.id },
        data: { lastEnqueuedAt: new Date() },
      });
    } catch (err) {
      this.logger.error(`Poller failed on ${row.id}: ${(err as Error).message}`);
    }
  }
  if (ready.length > 0) this.logger.log(`Outbox poller enqueued ${ready.length} rows`);
}
```

### 5.4 Worker

```ts
@Processor(JUBELIO_OUTBOX_QUEUE, { concurrency: WORKER_CONCURRENCY })
@Injectable()
export class OutboxProcessor extends WorkerHost<Worker<JobPayload>> {
  async process(job: Job<JobPayload>): Promise<void> {
    const row = await this.prisma.jubelioOutbox.findUnique({ where: { id: job.data.rowId } });
    if (!row) return;
    if (TERMINAL_OUTBOX_STATUSES.has(row.status as never)) return;

    await this.prisma.jubelioOutbox.update({
      where: { id: row.id },
      data: { status: OUTBOX_STATUS.PROCESSING, attempts: { increment: 1 } },
    });

    try {
      const outcome = await this.router.route(row);
      if (outcome.kind === "skipped") return this.markSkipped(row.id, outcome.reason);
      return this.markDone(row.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.jubelioOutbox.update({ where: { id: row.id }, data: { lastError: msg } });
      if (err instanceof NonRetryableError) {
        await this.markDead(row.id, msg);
        return;
      }
      throw err;
    }
  }

  @OnWorkerEvent("failed")
  async onJobFailed(job: Job<JobPayload>, err: Error) {
    if (job.attemptsMade < JOB_ATTEMPTS) return;
    await this.markDead(job.data.rowId, err.message);
  }
}
```

`markDone` / `markSkipped` / `markDead` mirror sub-1; `markDead` also fires `AdminNotificationService.write({ category: "jubelio-outbox", severity: "ERROR", title, message })`.

### 5.5 Router

```ts
@Injectable()
export class OutboxRouter {
  constructor(private readonly stockPush: StockPushHandler) {}

  async route(row: JubelioOutbox): Promise<HandlerOutcome> {
    switch (row.entityType) {
      case "stock_push":
        return this.stockPush.handle(row);
      default:
        return { kind: "skipped", reason: `unknown_entity_type:${row.entityType}` };
    }
  }
}
```

### 5.6 Stock push handler

```ts
async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
  const itemId = row.entityId;
  const mapping = await this.prisma.jubelioProductMapping.findFirst({ where: { itemId } });
  if (!mapping) return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.MISSING_MAPPING };

  const inventory = await this.prisma.inventoryValue.findMany({ where: { itemId } });
  if (inventory.length === 0) return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.NO_INVENTORY };

  const payload = inventory.map((iv) => ({
    item_code: iv.variantSku || mapping.jubelioItemCode,
    end_qty: Number(iv.qtyOnHand),
  }));

  await this.http.put(`/inventory/items/${mapping.jubelioItemGroupId}/stock`, { items: payload });
  // ⚠️ Exact Jubelio endpoint TBD: verify at implementation. Catalog ingest currently
  // only reads — there is no existing reference call for stock writes in the repo.
  // The handler structure stays the same regardless of the exact URL/payload.

  return { kind: "processed" };
}
```

Push is naturally idempotent (absolute qty), so no Jubelio-side idempotency key is required. `JubelioHttpService` already converts non-2xx to `JubelioError` with `status` — the processor's catch + retry logic handles this consistently with sub-1's behavior. `NonRetryableError` is thrown only for clear schema-shaped problems (e.g., missing mapping row at the moment of the call, despite the early guard — race protection).

### 5.7 Error classification

| Outcome | How it surfaces | Result |
|---|---|---|
| Handler returns `{kind:"processed"}` | normal return | row → `DONE` |
| Handler returns `{kind:"skipped", reason}` | normal return | row → `SKIPPED` with reason |
| Handler throws `NonRetryableError` | caught in worker | row → `DEAD` immediately, AdminNotification |
| Handler throws any other error | rethrown to BullMQ | retry per backoff; on attemptsMade ≥ 5 → `DEAD` via `onJobFailed`, AdminNotification |
| Missing mapping | handler returns `SKIPPED missing_mapping` | dashboard Retry button can re-run after operator wires the mapping |
| No inventory | handler returns `SKIPPED no_inventory` | same |

## 6. Producer surface

### 6.1 Server actions — `apps/web/app/actions/jubelio-outbox.ts`

Admin-gated via the existing `isAdmin()` helper used by `jubelio-api-calls.ts` and `jubelio-webhooks.ts`.

```ts
pushItemStockToJubelio(itemId: string)
  → { ok: boolean; outboxId?: string };

bulkPushAllStockToJubelio()
  → { ok: boolean; count: number };

getJubelioOutboxRows(filters: { limit?: number; offset?: number; status?: string; entityType?: string })
  → { rows: JubelioOutbox[]; total: number };

getJubelioOutboxStats()
  → { windowHours: number; byStatus: Record<Status, number> };

retryJubelioOutboxRow(id: string)
  → { ok: boolean };
```

`pushItemStockToJubelio` and `bulkPushAllStockToJubelio` insert directly via the shared `prisma` client. `enqueuedById` populated from the current session. `payload` left empty (`{}`) for `stock_push` since the worker re-resolves at process time.

`retryJubelioOutboxRow`:
- Allowed when status ∈ `{DEAD, SKIPPED}`. No-op otherwise.
- Sets `status='PENDING', attempts=0, lastError=null, deadAt=null, lastEnqueuedAt=null, skipReason=null`.
- Poller picks the row up within ~5s.

### 6.2 UI buttons

**Per-item button.** Item detail page (`apps/web/app/backoffice/items/[id]/page.tsx` or wherever the existing item view component lives). A small action button visible only to admins (`useSession().data.user.permissions.includes("*")` + the server action enforces). Click handler shows a `sonner` toast on success/failure.

**Bulk button.** Top of `/backoffice/jubelio/admin`, above existing sections. Confirms before firing (bulk inserts N rows in one transaction — non-destructive, but worth a click-through).

## 7. Dashboard

Extend the existing `/backoffice/jubelio/admin/page.tsx`. Add a third section below the existing webhook events section, mirroring its visual structure exactly:

```
─ Outbox events (24h) ────────────────────────────
  PENDING  PROCESSING  DONE  SKIPPED  DEAD

─ Outbox events ──────────────────────────────────
  time  entity  status  attempts  flags/reason  [Retry]

─ filters ────────────────────────────────────────
  [all │ errors │ DEAD only]  [entity type ▾]
```

Row expand → payload JSON (`<pre>` with `max-h-64 overflow-auto`), full `lastError`, all timestamps, `enqueuedBy` user (name/email).

## 8. Testing

| Layer | Tests | Approach |
|---|---|---|
| `stock-push.handler.ts` | happy path: calls Jubelio PUT with re-resolved inventory; `missing_mapping` → SKIPPED with reason; `no_inventory` → SKIPPED with reason; Jubelio non-2xx → rethrows | jest + mock prisma + mock `JubelioHttpService` |
| `outbox-router.ts` | `stock_push` → handler; unknown entity → SKIPPED `unknown_entity_type:<x>` | pure unit |
| `outbox-processor.service.ts` | PENDING→PROCESSING→DONE on success; SKIPPED transition; `NonRetryableError` → DEAD without rethrow; generic throw rethrows; settled rows early-return; row-not-found returns silently; `onJobFailed` at max attempts → DEAD with AdminNotification | jest, mock router + prisma + admin |
| `outbox-poller.service.ts` | skipped — same trust-the-library rationale as sub-1's sweeper | n/a |
| Server actions | skipped — pure prisma plumbing | n/a |
| BullMQ retry timing | skipped — library behavior | n/a |
| Live Redis end-to-end | skipped in CI — manual smoke covers | n/a |

Target ~12 tests across 3 suites.

### 8.1 Manual smoke

1. `docker start elorae-dev-redis`, `pnpm prod:api`, `pnpm -F @elorae/web dev`.
2. Log in as admin. Open `/backoffice/jubelio/admin`. Confirm new Outbox section renders with 0 in every status card.
3. Open an item detail page for an item that has a `JubelioProductMapping`. Click "Push stock to Jubelio". Within ~5–10s the row appears as `DONE` in the Outbox section. Verify the new stock level on Jubelio's side (their dashboard or via `GET /inventory/items/`).
4. Click the per-item button on an Item with NO mapping. Row → `SKIPPED missing_mapping`.
5. Click "Sync all stock to Jubelio" on the admin dashboard. Confirm. Watch the Outbox section drain from PENDING to DONE over a few minutes.
6. Force a DEAD: temporarily corrupt `JUBELIO_PASS` in `apps/api/.env`, restart api, push one item, watch retries → DEAD + the AdminNotification icon shows the alert. Restore credentials, click Retry on the dashboard row, confirm it processes within ~5s.

## 9. Open items

- **Exact Jubelio stock-update endpoint + payload shape.** Catalog ingest only READS; there is no existing reference write call in the repo. Verify against Jubelio's API docs at implementation time. Only the handler's outbound HTTP call needs the correction; everything else is endpoint-agnostic.
- **Idempotency key.** Not added now (manual clicks are naturally unique; pushing absolute qty is naturally idempotent at Jubelio). When sub-3 introduces auto-triggered pushes, an `idempotencyKey` column keyed on `${entityType}:${entityId}:${version}` per `docs/BOUNDARY.md §4.2` becomes necessary to dedup. Schema-additive change at that point.
- **Auth bridge.** Sub-2.5 work. Until then, the poller is the contract. When the auth bridge lands, the producer's server action can additionally call apps/api's internal-key-gated `POST /outbox/enqueue/:id` for instant pickup, dropping average latency from ~5s to sub-second.

## 10. References

- `docs/BOUNDARY.md §3` (data ownership), §4.2 (outbox communication pattern), §9 D1/D2 (BullMQ + Redis decisions).
- Sub-1 spec: `docs/superpowers/specs/2026-05-28-jubelio-webhook-pipeline-design.md` — many infrastructure choices mirror it intentionally.
- `apps/api/src/jubelio/queue/` — existing inbound pipeline that this branch parallels.
- `apps/web/app/backoffice/jubelio/admin/page.tsx` — existing dashboard to extend.
