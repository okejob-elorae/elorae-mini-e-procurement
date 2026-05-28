# Jubelio Outbound Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `JubelioOutbox` table + BullMQ-backed drain worker + first real producer (admin-triggered stock push) — the outbound counterpart to the inbound webhook pipeline shipped in `feat/jubelio-sync`.

**Architecture:** apps/web inserts `JubelioOutbox` rows via admin server actions (per-item + bulk buttons); apps/api `OutboxPoller` (@Interval 5s) scans PENDING + recovers stuck PROCESSING; BullMQ worker (shared Redis with the webhook queue, separate queue name `jubelio-outbox`, concurrency 1) drains; router dispatches by `entityType`; real `stock_push` handler re-resolves current `InventoryValue` and PUTs to Jubelio; status mirrored on the row with retry/DLQ/AdminNotification semantics identical to sub-1.

**Tech Stack:** NestJS 11, BullMQ + ioredis (already wired by sub-1), Prisma 7 + MariaDB adapter, Next.js 16 server actions for the producer surface, jest + ts-jest for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-28-jubelio-outbox-design.md`

---

## File Structure

**New files:**

```
packages/db/prisma/migrations/20260528200000_add_jubelio_outbox/migration.sql

apps/api/src/jubelio/outbox/jubelio-outbox.config.ts            # tuning constants
apps/api/src/jubelio/outbox/outbox-status.ts                    # status + skip reason constants
apps/api/src/jubelio/outbox/outbox-router.ts                    # pure dispatch by entityType
apps/api/src/jubelio/outbox/outbox-poller.service.ts            # @Interval drain
apps/api/src/jubelio/outbox/outbox-processor.service.ts         # BullMQ worker
apps/api/src/jubelio/outbox/jubelio-outbox.module.ts            # Nest module
apps/api/src/jubelio/outbox/handlers/handler.types.ts           # OutboxHandler interface
apps/api/src/jubelio/outbox/handlers/stock-push.handler.ts      # real handler

apps/api/src/jubelio/outbox/handlers/stock-push.handler.spec.ts
apps/api/src/jubelio/outbox/outbox-router.spec.ts
apps/api/src/jubelio/outbox/outbox-processor.service.spec.ts

apps/web/app/actions/jubelio-outbox.ts                          # admin-gated server actions
```

**Modified files:**

```
packages/db/prisma/schema.prisma                                # +JubelioOutbox model, +User.enqueuedOutbox relation
apps/api/src/app.module.ts                                      # register JubelioOutboxModule
apps/web/app/backoffice/jubelio/admin/page.tsx                  # +bulk button, +Outbox section
apps/web/app/backoffice/items/[id]/page.tsx                     # +per-item "Push stock" button
                                                                # (or wherever the item detail/edit view actually lives — implementer locates the existing component)
```

**Reused from sub-1 (read-only, do not modify):**

- `apps/api/src/jubelio/handlers/handler.types.ts` — provides `HandlerOutcome` type.
- `apps/api/src/jubelio/queue/errors.ts` — provides `NonRetryableError`.
- `apps/api/src/admin/notification.service.ts` — `AdminNotificationService.write(...)`.
- `apps/api/src/jubelio/http.service.ts` — `JubelioHttpService` (the existing PUT/POST/GET client).
- `apps/api/src/db/prisma.module.ts` — `PRISMA` injection token + `PrismaService` type.
- `app.module.ts` already registers `BullModule.forRootAsync` (Redis URL). Outbox module just adds another `BullModule.registerQueue({ name: ... })`.

---

## Task 1: Schema additions + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260528200000_add_jubelio_outbox/migration.sql`

- [ ] **Step 1: Add `JubelioOutbox` model to schema.prisma**

Add this block at the end of `packages/db/prisma/schema.prisma`, right after the existing `model JubelioApiCall` block (or wherever the file's other Jubelio* models sit — group them together):

```prisma
model JubelioOutbox {
  id              String    @id @default(cuid())
  entityType      String
  entityId        String
  payload         Json      @default("{}")
  status          String    @default("PENDING")
  attempts        Int       @default(0)
  lastError       String?   @db.Text
  skipReason      String?
  enqueuedById    String?
  enqueuedBy      User?     @relation("EnqueuedOutbox", fields: [enqueuedById], references: [id], onDelete: NoAction, onUpdate: NoAction)
  createdAt       DateTime  @default(now())
  lastEnqueuedAt  DateTime?
  processedAt     DateTime?
  deadAt          DateTime?

  @@index([status, createdAt])
  @@index([entityType, entityId])
  @@index([enqueuedById])
}
```

- [ ] **Step 2: Add the inverse relation on the User model**

Find `model User` in the same `schema.prisma`. It already has several `@relation` lists (for stock adjustments, vendor returns, etc.). Add this line alongside the existing relations, before `createdAt`:

```prisma
  enqueuedOutbox          JubelioOutbox[] @relation("EnqueuedOutbox")
```

Don't reorder existing lines. Just insert the one new line.

- [ ] **Step 3: Create the migration directory + SQL**

```bash
mkdir -p packages/db/prisma/migrations/20260528200000_add_jubelio_outbox
```

Create `packages/db/prisma/migrations/20260528200000_add_jubelio_outbox/migration.sql`:

```sql
-- CreateTable
CREATE TABLE `JubelioOutbox` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `skipReason` VARCHAR(191) NULL,
    `enqueuedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastEnqueuedAt` DATETIME(3) NULL,
    `processedAt` DATETIME(3) NULL,
    `deadAt` DATETIME(3) NULL,

    INDEX `JubelioOutbox_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `JubelioOutbox_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `JubelioOutbox_enqueuedById_idx`(`enqueuedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Note: `relationMode = "prisma"` in the schema means Prisma doesn't generate FK constraints — application enforces them. So no `FOREIGN KEY` clause needed. The `enqueuedBy` relation in the schema is purely a query convenience.

- [ ] **Step 4: Regenerate Prisma client**

```bash
pnpm -F @elorae/db generate 2>&1 | tail -3
```

Expected: `✔ Generated Prisma Client`.

- [ ] **Step 5: Apply migration to TiDB**

```bash
pnpm -F @elorae/db migrate:deploy 2>&1 | tail -10
```

Expected: `Applying migration 20260528200000_add_jubelio_outbox` then `All migrations have been successfully applied.`

- [ ] **Step 6: Rebuild @elorae/db dist**

```bash
pnpm -F @elorae/db build 2>&1 | tail -3
```

Expected: silent success.

- [ ] **Step 7: Manual verify column existence**

```bash
cd /home/rifkyltf/project/elorae/packages/db && set -a && source ../../apps/web/.env && set +a && pnpm exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const cols = await prisma.\$queryRawUnsafe('SHOW COLUMNS FROM JubelioOutbox');
  console.log('cols:', cols);
  const count = await prisma.jubelioOutbox.count();
  console.log('row count:', count);
  await prisma.\$disconnect();
})();
" 2>&1 | tail -20
```

Expected: 13 columns listed (`id`, `entityType`, `entityId`, `payload`, `status`, `attempts`, `lastError`, `skipReason`, `enqueuedById`, `createdAt`, `lastEnqueuedAt`, `processedAt`, `deadAt`); row count = 0.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260528200000_add_jubelio_outbox
git commit -m "feat(db): JubelioOutbox table for outbound push pipeline"
```

---

## Task 2: Status + skip reason constants

**Files:**
- Create: `apps/api/src/jubelio/outbox/outbox-status.ts`

- [ ] **Step 1: Write the constants file**

Create `apps/api/src/jubelio/outbox/outbox-status.ts`:

```ts
export const OUTBOX_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  DONE: "DONE",
  SKIPPED: "SKIPPED",
  DEAD: "DEAD",
} as const;

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

export const TERMINAL_OUTBOX_STATUSES: ReadonlySet<OutboxStatus> = new Set([
  OUTBOX_STATUS.DONE,
  OUTBOX_STATUS.SKIPPED,
  OUTBOX_STATUS.DEAD,
]);

export const OUTBOX_SKIP_REASONS = {
  MISSING_MAPPING: "missing_mapping",
  NO_INVENTORY: "no_inventory",
  UNKNOWN_ENTITY_TYPE: "unknown_entity_type",
} as const;
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jubelio/outbox/outbox-status.ts
git commit -m "feat(api): outbox status + skip reason constants"
```

---

## Task 3: Outbox handler types

**Files:**
- Create: `apps/api/src/jubelio/outbox/handlers/handler.types.ts`

- [ ] **Step 1: Write the handler interface**

Create `apps/api/src/jubelio/outbox/handlers/handler.types.ts`:

```ts
import type { JubelioOutbox } from "@elorae/db";
import type { HandlerOutcome } from "../../handlers/handler.types";

export type { HandlerOutcome };

export interface OutboxHandler {
  handle(row: JubelioOutbox): Promise<HandlerOutcome>;
}
```

Note: re-exports `HandlerOutcome` from sub-1's shared location so outbox files import it from one place.

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jubelio/outbox/handlers/handler.types.ts
git commit -m "feat(api): OutboxHandler interface (reuses HandlerOutcome from sub-1)"
```

---

## Task 4: Queue config constants

**Files:**
- Create: `apps/api/src/jubelio/outbox/jubelio-outbox.config.ts`

- [ ] **Step 1: Write the config file**

Create `apps/api/src/jubelio/outbox/jubelio-outbox.config.ts`:

```ts
export const JUBELIO_OUTBOX_QUEUE = "jubelio-outbox";

export const OUTBOX_QUEUE_DEFAULTS = {
  JOB_ATTEMPTS: 5,
  BACKOFF_BASE_MS: 5_000,
  REMOVE_ON_COMPLETE_COUNT: 1_000,
  REMOVE_ON_FAIL_COUNT: 5_000,
  WORKER_CONCURRENCY: 1,
} as const;

export const OUTBOX_POLLER = {
  INTERVAL_MS: 5_000,
  STUCK_AFTER_MS: 5 * 60 * 1_000,
  BATCH: 100,
} as const;
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jubelio/outbox/jubelio-outbox.config.ts
git commit -m "feat(api): jubelio outbox queue + poller tuning constants"
```

---

## Task 5: Stock push handler + tests

**Files:**
- Create: `apps/api/src/jubelio/outbox/handlers/stock-push.handler.spec.ts`
- Create: `apps/api/src/jubelio/outbox/handlers/stock-push.handler.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/jubelio/outbox/handlers/stock-push.handler.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { StockPushHandler } from "./stock-push.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

function row(overrides: any = {}) {
  return {
    id: "out_1",
    entityType: "stock_push",
    entityId: "item_1",
    payload: {},
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    skipReason: null,
    enqueuedById: "user_1",
    createdAt: new Date(),
    lastEnqueuedAt: new Date(),
    processedAt: null,
    deadAt: null,
    ...overrides,
  };
}

describe("StockPushHandler", () => {
  let handler: StockPushHandler;
  let prisma: any;
  let http: { put: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioProductMapping: { findFirst: jest.fn() },
      inventoryValue: { findMany: jest.fn() },
    };
    http = { put: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        StockPushHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    handler = mod.get(StockPushHandler);
  });

  it("returns SKIPPED missing_mapping when item has no Jubelio mapping", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.MISSING_MAPPING });
    expect(http.put).not.toHaveBeenCalled();
  });

  it("returns SKIPPED no_inventory when item has no InventoryValue rows", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue({
      itemId: "item_1",
      jubelioItemGroupId: 42,
      jubelioItemCode: "SKU-PARENT",
    });
    prisma.inventoryValue.findMany.mockResolvedValue([]);

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.NO_INVENTORY });
    expect(http.put).not.toHaveBeenCalled();
  });

  it("PUTs current inventory to Jubelio and returns processed", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue({
      itemId: "item_1",
      jubelioItemGroupId: 42,
      jubelioItemCode: "SKU-PARENT",
    });
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "SKU-A", qtyOnHand: 5 },
      { variantSku: "SKU-B", qtyOnHand: 12 },
    ]);
    http.put.mockResolvedValue({});

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.put).toHaveBeenCalledTimes(1);
    const [path, body] = http.put.mock.calls[0];
    expect(path).toBe("/inventory/items/42/stock");
    expect(body).toEqual({
      items: [
        { item_code: "SKU-A", end_qty: 5 },
        { item_code: "SKU-B", end_qty: 12 },
      ],
    });
  });

  it("falls back to parent jubelioItemCode for variantless rows (empty variantSku)", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue({
      itemId: "item_1",
      jubelioItemGroupId: 42,
      jubelioItemCode: "SKU-PARENT",
    });
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "", qtyOnHand: 8 },
    ]);
    http.put.mockResolvedValue({});

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.put.mock.calls[0][1].items[0]).toEqual({ item_code: "SKU-PARENT", end_qty: 8 });
  });

  it("rethrows when Jubelio call fails", async () => {
    prisma.jubelioProductMapping.findFirst.mockResolvedValue({
      itemId: "item_1",
      jubelioItemGroupId: 42,
      jubelioItemCode: "SKU-PARENT",
    });
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "SKU-A", qtyOnHand: 1 },
    ]);
    http.put.mockRejectedValue(new Error("Jubelio 500"));

    await expect(handler.handle(row() as any)).rejects.toThrow(/Jubelio 500/);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm -F @elorae/api test --testPathPattern stock-push.handler 2>&1 | tail -10
```

Expected: failures (module not found `./stock-push.handler`).

- [ ] **Step 3: Write the handler**

Create `apps/api/src/jubelio/outbox/handlers/stock-push.handler.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";

@Injectable()
export class StockPushHandler implements OutboxHandler {
  private readonly logger = new Logger(StockPushHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const itemId = row.entityId;

    const mapping = await this.prisma.jubelioProductMapping.findFirst({ where: { itemId } });
    if (!mapping) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.MISSING_MAPPING };
    }

    const inventory = await this.prisma.inventoryValue.findMany({ where: { itemId } });
    if (inventory.length === 0) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.NO_INVENTORY };
    }

    const items = inventory.map((iv) => ({
      item_code: iv.variantSku || mapping.jubelioItemCode,
      end_qty: Number(iv.qtyOnHand),
    }));

    await this.http.put(`/inventory/items/${mapping.jubelioItemGroupId}/stock`, { items });

    this.logger.log(`Pushed stock for itemId=${itemId} (${items.length} variant rows)`);
    return { kind: "processed" };
  }
}
```

Note on the Jubelio endpoint path: `PUT /inventory/items/{jubelioItemGroupId}/stock` is the assumed shape from §5.6 of the spec. Verify against Jubelio's API docs before final review and adjust the path + body if it differs. The unit tests use the same literal so adjustments propagate.

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm -F @elorae/api test --testPathPattern stock-push.handler 2>&1 | tail -10
```

Expected: `Tests: 5 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/outbox/handlers/stock-push.handler.ts apps/api/src/jubelio/outbox/handlers/stock-push.handler.spec.ts
git commit -m "feat(api): stock push outbox handler with mapping + inventory guards"
```

---

## Task 6: Outbox router + tests

**Files:**
- Create: `apps/api/src/jubelio/outbox/outbox-router.spec.ts`
- Create: `apps/api/src/jubelio/outbox/outbox-router.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/jubelio/outbox/outbox-router.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { OutboxRouter } from "./outbox-router";
import { StockPushHandler } from "./handlers/stock-push.handler";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { OUTBOX_SKIP_REASONS } from "./outbox-status";

function row(entityType: string) {
  return {
    id: "r1",
    entityType,
    entityId: "item_1",
    payload: {},
  } as any;
}

describe("OutboxRouter", () => {
  let router: OutboxRouter;
  let stockHandler: { handle: jest.Mock };

  beforeEach(async () => {
    stockHandler = { handle: jest.fn().mockResolvedValue({ kind: "processed" }) };
    const mod = await Test.createTestingModule({
      providers: [
        OutboxRouter,
        { provide: StockPushHandler, useValue: stockHandler },
        { provide: PRISMA, useValue: {} },
        { provide: JubelioHttpService, useValue: {} },
      ],
    }).compile();
    router = mod.get(OutboxRouter);
  });

  it("routes stock_push to StockPushHandler", async () => {
    const result = await router.route(row("stock_push"));
    expect(stockHandler.handle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "processed" });
  });

  it("returns SKIPPED unknown_entity_type for an unknown entityType", async () => {
    const result = await router.route(row("mystery_push"));
    expect(stockHandler.handle).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "skipped",
      reason: `${OUTBOX_SKIP_REASONS.UNKNOWN_ENTITY_TYPE}:mystery_push`,
    });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm -F @elorae/api test --testPathPattern outbox-router 2>&1 | tail -10
```

Expected: module not found.

- [ ] **Step 3: Write the router**

Create `apps/api/src/jubelio/outbox/outbox-router.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { StockPushHandler } from "./handlers/stock-push.handler";
import type { HandlerOutcome } from "./handlers/handler.types";
import { OUTBOX_SKIP_REASONS } from "./outbox-status";

@Injectable()
export class OutboxRouter {
  constructor(private readonly stockPush: StockPushHandler) {}

  async route(row: JubelioOutbox): Promise<HandlerOutcome> {
    switch (row.entityType) {
      case "stock_push":
        return this.stockPush.handle(row);
      default:
        return {
          kind: "skipped",
          reason: `${OUTBOX_SKIP_REASONS.UNKNOWN_ENTITY_TYPE}:${row.entityType}`,
        };
    }
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm -F @elorae/api test --testPathPattern outbox-router 2>&1 | tail -10
```

Expected: `Tests: 2 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/outbox/outbox-router.ts apps/api/src/jubelio/outbox/outbox-router.spec.ts
git commit -m "feat(api): outbox router (stock_push real, others SKIPPED)"
```

---

## Task 7: Outbox poller

**Files:**
- Create: `apps/api/src/jubelio/outbox/outbox-poller.service.ts`

No tests — same trust-the-library rationale as sub-1's sweeper. Exercised through manual smoke.

- [ ] **Step 1: Write the poller**

Create `apps/api/src/jubelio/outbox/outbox-poller.service.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import {
  JUBELIO_OUTBOX_QUEUE,
  OUTBOX_POLLER,
  OUTBOX_QUEUE_DEFAULTS,
} from "./jubelio-outbox.config";
import { OUTBOX_STATUS } from "./outbox-status";

@Injectable()
export class OutboxPoller {
  private readonly logger = new Logger(OutboxPoller.name);

  constructor(
    @InjectQueue(JUBELIO_OUTBOX_QUEUE) private readonly q: Queue,
    @Inject(PRISMA) private readonly prisma: PrismaService,
  ) {}

  @Interval("jubelio-outbox-poller", OUTBOX_POLLER.INTERVAL_MS)
  async poll(): Promise<void> {
    const cutoff = new Date(Date.now() - OUTBOX_POLLER.STUCK_AFTER_MS);
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
      take: OUTBOX_POLLER.BATCH,
    });

    for (const row of ready) {
      try {
        if (row.status === OUTBOX_STATUS.PROCESSING) {
          await this.prisma.jubelioOutbox.update({
            where: { id: row.id },
            data: { status: OUTBOX_STATUS.PENDING },
          });
        }
        await this.q.add(
          "process",
          { rowId: row.id },
          {
            attempts: OUTBOX_QUEUE_DEFAULTS.JOB_ATTEMPTS,
            backoff: { type: "exponential", delay: OUTBOX_QUEUE_DEFAULTS.BACKOFF_BASE_MS },
            removeOnComplete: { count: OUTBOX_QUEUE_DEFAULTS.REMOVE_ON_COMPLETE_COUNT },
            removeOnFail: { count: OUTBOX_QUEUE_DEFAULTS.REMOVE_ON_FAIL_COUNT },
            jobId: row.id,
          },
        );
        await this.prisma.jubelioOutbox.update({
          where: { id: row.id },
          data: { lastEnqueuedAt: new Date() },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Poller failed on ${row.id}: ${msg}`);
      }
    }
    if (ready.length > 0) {
      this.logger.log(`Outbox poller enqueued ${ready.length} rows`);
    }
  }
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
```

Expected: silent success (BullMQ + ioredis already installed by sub-1).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jubelio/outbox/outbox-poller.service.ts
git commit -m "feat(api): outbox poller (@Interval scan + stuck-row rescue)"
```

---

## Task 8: Outbox processor + tests

**Files:**
- Create: `apps/api/src/jubelio/outbox/outbox-processor.service.spec.ts`
- Create: `apps/api/src/jubelio/outbox/outbox-processor.service.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/jubelio/outbox/outbox-processor.service.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { OutboxProcessor } from "./outbox-processor.service";
import { OutboxRouter } from "./outbox-router";
import { AdminNotificationService } from "../../admin/notification.service";
import { PRISMA } from "../../db/prisma.module";
import { OUTBOX_STATUS } from "./outbox-status";
import { NonRetryableError } from "../queue/errors";

function rowFixture(overrides: any = {}) {
  return {
    id: "r1",
    entityType: "stock_push",
    entityId: "item_1",
    payload: {},
    status: OUTBOX_STATUS.PENDING,
    attempts: 0,
    ...overrides,
  };
}

describe("OutboxProcessor", () => {
  let processor: OutboxProcessor;
  let prisma: any;
  let router: { route: jest.Mock };
  let admin: { write: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioOutbox: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    router = { route: jest.fn() };
    admin = { write: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        OutboxProcessor,
        { provide: PRISMA, useValue: prisma },
        { provide: OutboxRouter, useValue: router },
        { provide: AdminNotificationService, useValue: admin },
      ],
    }).compile();
    processor = mod.get(OutboxProcessor);
  });

  it("returns silently when row not found", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(null);
    await processor.process({ data: { rowId: "missing" } } as any);
    expect(router.route).not.toHaveBeenCalled();
  });

  it.each([OUTBOX_STATUS.DONE, OUTBOX_STATUS.SKIPPED, OUTBOX_STATUS.DEAD])(
    "early-returns when row already %s",
    async (status) => {
      prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture({ status }));
      await processor.process({ data: { rowId: "r1" } } as any);
      expect(router.route).not.toHaveBeenCalled();
    },
  );

  it("transitions PENDING → PROCESSING → DONE on success", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "processed" });

    await processor.process({ data: { rowId: "r1" } } as any);

    const updates = prisma.jubelioOutbox.update.mock.calls;
    expect(updates[0][0].data).toMatchObject({ status: OUTBOX_STATUS.PROCESSING });
    expect(updates[updates.length - 1][0].data).toMatchObject({ status: OUTBOX_STATUS.DONE });
    expect(updates[updates.length - 1][0].data.processedAt).toBeInstanceOf(Date);
  });

  it("transitions to SKIPPED with reason", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "skipped", reason: "missing_mapping" });

    await processor.process({ data: { rowId: "r1" } } as any);

    const updates = prisma.jubelioOutbox.update.mock.calls;
    expect(updates[updates.length - 1][0].data).toMatchObject({
      status: OUTBOX_STATUS.SKIPPED,
      skipReason: "missing_mapping",
    });
  });

  it("transitions to DEAD on NonRetryableError without rethrowing", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockRejectedValue(new NonRetryableError("bad payload"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).resolves.not.toThrow();

    const updates = prisma.jubelioOutbox.update.mock.calls;
    expect(updates.some((c: any[]) => c[0].data.status === OUTBOX_STATUS.DEAD)).toBe(true);
    expect(admin.write).toHaveBeenCalledWith(
      expect.objectContaining({ category: "jubelio-outbox", severity: "ERROR" }),
    );
  });

  it("rethrows generic errors for BullMQ retry", async () => {
    prisma.jubelioOutbox.findUnique.mockResolvedValue(rowFixture());
    router.route.mockRejectedValue(new Error("transient Jubelio 503"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).rejects.toThrow(/transient/);
    expect(admin.write).not.toHaveBeenCalled();
  });

  it("marks DEAD via onJobFailed when attemptsMade reaches JOB_ATTEMPTS", async () => {
    await processor.onJobFailed(
      { data: { rowId: "r1" }, attemptsMade: 5 } as any,
      new Error("final fail"),
    );
    const updates = prisma.jubelioOutbox.update.mock.calls;
    expect(updates.some((c: any[]) => c[0].data.status === OUTBOX_STATUS.DEAD)).toBe(true);
    expect(admin.write).toHaveBeenCalled();
  });

  it("does not mark DEAD via onJobFailed when attemptsMade below JOB_ATTEMPTS", async () => {
    await processor.onJobFailed(
      { data: { rowId: "r1" }, attemptsMade: 2 } as any,
      new Error("transient"),
    );
    expect(prisma.jubelioOutbox.update).not.toHaveBeenCalled();
    expect(admin.write).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm -F @elorae/api test --testPathPattern outbox-processor 2>&1 | tail -10
```

Expected: module not found.

- [ ] **Step 3: Write the processor**

Create `apps/api/src/jubelio/outbox/outbox-processor.service.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Worker } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { AdminNotificationService } from "../../admin/notification.service";
import { OutboxRouter } from "./outbox-router";
import { NonRetryableError } from "../queue/errors";
import { OUTBOX_STATUS, TERMINAL_OUTBOX_STATUSES } from "./outbox-status";
import { JUBELIO_OUTBOX_QUEUE, OUTBOX_QUEUE_DEFAULTS } from "./jubelio-outbox.config";

type JobPayload = { rowId: string };

@Processor(JUBELIO_OUTBOX_QUEUE, { concurrency: OUTBOX_QUEUE_DEFAULTS.WORKER_CONCURRENCY })
@Injectable()
export class OutboxProcessor extends WorkerHost<Worker<JobPayload>> {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly router: OutboxRouter,
    private readonly admin: AdminNotificationService,
  ) {
    super();
  }

  async process(job: Job<JobPayload>): Promise<void> {
    const row = await this.prisma.jubelioOutbox.findUnique({
      where: { id: job.data.rowId },
    });
    if (!row) {
      this.logger.warn(`row ${job.data.rowId} not found; ignoring`);
      return;
    }
    if (TERMINAL_OUTBOX_STATUSES.has(row.status as never)) {
      return;
    }

    await this.prisma.jubelioOutbox.update({
      where: { id: row.id },
      data: { status: OUTBOX_STATUS.PROCESSING, attempts: { increment: 1 } },
    });

    try {
      const outcome = await this.router.route(row);
      if (outcome.kind === "skipped") {
        await this.markSkipped(row.id, outcome.reason);
      } else {
        await this.markDone(row.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.jubelioOutbox.update({
        where: { id: row.id },
        data: { lastError: msg },
      });
      if (err instanceof NonRetryableError) {
        await this.markDead(row.id, msg);
        return;
      }
      throw err;
    }
  }

  @OnWorkerEvent("failed")
  async onJobFailed(job: Job<JobPayload>, err: Error): Promise<void> {
    if (job.attemptsMade < OUTBOX_QUEUE_DEFAULTS.JOB_ATTEMPTS) return;
    await this.markDead(job.data.rowId, err.message);
  }

  private async markDone(id: string): Promise<void> {
    await this.prisma.jubelioOutbox.update({
      where: { id },
      data: { status: OUTBOX_STATUS.DONE, processedAt: new Date() },
    });
  }

  private async markSkipped(id: string, reason: string): Promise<void> {
    await this.prisma.jubelioOutbox.update({
      where: { id },
      data: { status: OUTBOX_STATUS.SKIPPED, skipReason: reason, processedAt: new Date() },
    });
  }

  private async markDead(id: string, message: string): Promise<void> {
    await this.prisma.jubelioOutbox.update({
      where: { id },
      data: { status: OUTBOX_STATUS.DEAD, deadAt: new Date(), lastError: message },
    });
    await this.admin.write({
      category: "jubelio-outbox",
      severity: "ERROR",
      title: `Outbox row ${id} marked DEAD`,
      message,
    });
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm -F @elorae/api test --testPathPattern outbox-processor 2>&1 | tail -10
```

Expected: `Tests: 9 passed` (1 not-found + 3 terminal-early-return via `it.each` + 1 success + 1 skipped + 1 NonRetryable→DEAD + 1 generic rethrow + 1 onJobFailed-at-max + 1 onJobFailed-below-max).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/outbox/outbox-processor.service.ts apps/api/src/jubelio/outbox/outbox-processor.service.spec.ts
git commit -m "feat(api): outbox processor (status mirror + retry + DEAD via AdminNotification)"
```

---

## Task 9: Outbox module wiring

**Files:**
- Create: `apps/api/src/jubelio/outbox/jubelio-outbox.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the outbox module**

Create `apps/api/src/jubelio/outbox/jubelio-outbox.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AdminModule } from "../../admin/admin.module";
import { PrismaModule } from "../../db/prisma.module";
import { JubelioModule } from "../jubelio.module";
import { JUBELIO_OUTBOX_QUEUE } from "./jubelio-outbox.config";
import { OutboxPoller } from "./outbox-poller.service";
import { OutboxProcessor } from "./outbox-processor.service";
import { OutboxRouter } from "./outbox-router";
import { StockPushHandler } from "./handlers/stock-push.handler";

@Module({
  imports: [
    PrismaModule,
    AdminModule,
    JubelioModule,
    BullModule.registerQueue({ name: JUBELIO_OUTBOX_QUEUE }),
  ],
  providers: [OutboxPoller, OutboxProcessor, OutboxRouter, StockPushHandler],
})
export class JubelioOutboxModule {}
```

`JubelioModule` is imported so `StockPushHandler` can inject `JubelioHttpService` (the existing PUT/POST client lives in that module).

- [ ] **Step 2: Register `JubelioOutboxModule` in app.module**

Read the current `apps/api/src/app.module.ts` first to see the imports list and where the existing `JubelioQueueModule` registration sits. Then add the new import at the top:

```ts
import { JubelioOutboxModule } from "./jubelio/outbox/jubelio-outbox.module";
```

And insert `JubelioOutboxModule` into the `imports: [...]` array, alongside `JubelioQueueModule`. Don't reorder existing entries.

- [ ] **Step 3: Type-check + build**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
pnpm -F @elorae/api build 2>&1 | tail -5
```

Expected: both silent success.

- [ ] **Step 4: Run all tests (regression check)**

```bash
pnpm -F @elorae/api test 2>&1 | tail -10
```

Expected: sub-1's 20 tests + sub-2's 16 tests = at least 36 tests passing across 7 suites.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/outbox/jubelio-outbox.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): register jubelio outbox module"
```

---

## Task 10: Web server actions for outbox

**Files:**
- Create: `apps/web/app/actions/jubelio-outbox.ts`

- [ ] **Step 1: Write the server actions**

Create `apps/web/app/actions/jubelio-outbox.ts`:

```ts
"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";

const STATUSES = ["PENDING", "PROCESSING", "DONE", "SKIPPED", "DEAD"] as const;
type Status = (typeof STATUSES)[number];

async function isAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.user?.permissions?.includes("*") ?? false;
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export type JubelioOutboxFilters = {
  limit?: number;
  offset?: number;
  status?: Status;
  entityType?: string;
};

export async function pushItemStockToJubelio(itemId: string): Promise<{ ok: boolean; outboxId?: string }> {
  if (!(await isAdmin())) return { ok: false };
  const enqueuedById = await currentUserId();
  const row = await prisma.jubelioOutbox.create({
    data: { entityType: "stock_push", entityId: itemId, payload: {}, enqueuedById },
    select: { id: true },
  });
  return { ok: true, outboxId: row.id };
}

export async function bulkPushAllStockToJubelio(): Promise<{ ok: boolean; count: number }> {
  if (!(await isAdmin())) return { ok: false, count: 0 };
  const enqueuedById = await currentUserId();
  const mappings = await prisma.jubelioProductMapping.findMany({
    select: { itemId: true },
    distinct: ["itemId"],
  });
  if (mappings.length === 0) return { ok: true, count: 0 };
  await prisma.jubelioOutbox.createMany({
    data: mappings.map((m) => ({
      entityType: "stock_push",
      entityId: m.itemId,
      payload: {},
      enqueuedById,
    })),
  });
  return { ok: true, count: mappings.length };
}

export async function getJubelioOutboxRows(filters: JubelioOutboxFilters = {}) {
  if (!(await isAdmin())) return { rows: [], total: 0 };

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const where: any = {};
  if (filters.status) where.status = filters.status;
  if (filters.entityType) where.entityType = filters.entityType;

  const [rows, total] = await Promise.all([
    prisma.jubelioOutbox.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { enqueuedBy: { select: { id: true, name: true, email: true } } },
    }),
    prisma.jubelioOutbox.count({ where }),
  ]);

  return { rows, total };
}

export async function getJubelioOutboxStats() {
  if (!(await isAdmin())) return null;

  const windowHours = 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const grouped = await prisma.jubelioOutbox.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });

  const byStatus = STATUSES.reduce<Record<Status, number>>(
    (acc, s) => ({ ...acc, [s]: 0 }),
    {} as Record<Status, number>,
  );
  for (const g of grouped) {
    if (STATUSES.includes(g.status as Status)) {
      byStatus[g.status as Status] = g._count._all;
    }
  }
  return { windowHours, byStatus };
}

export async function retryJubelioOutboxRow(id: string): Promise<{ ok: boolean }> {
  if (!(await isAdmin())) return { ok: false };

  const row = await prisma.jubelioOutbox.findUnique({ where: { id }, select: { status: true } });
  if (!row) return { ok: false };
  if (row.status !== "DEAD" && row.status !== "SKIPPED") return { ok: false };

  await prisma.jubelioOutbox.update({
    where: { id },
    data: {
      status: "PENDING",
      attempts: 0,
      lastError: null,
      deadAt: null,
      lastEnqueuedAt: null,
      skipReason: null,
    },
  });
  return { ok: true };
}
```

- [ ] **Step 2: Type-check apps/web**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent success. If `.next/dev/types/validator.ts` reports a stale TS1128 error, `rm -rf apps/web/.next/dev` and retry.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/actions/jubelio-outbox.ts
git commit -m "feat(web): admin server actions for jubelio outbox"
```

---

## Task 11: Per-item "Push stock" button

**Files:**
- Modify: the existing item detail page (likely `apps/web/app/backoffice/items/[id]/page.tsx` or `.../items/[id]/edit/page.tsx` — implementer locates the actual file by searching for the existing item view component)

- [ ] **Step 1: Locate the item detail page**

```bash
find apps/web/app/backoffice/items -name "page.tsx" | head -5
grep -lrE "useParams|params: \{ id" apps/web/app/backoffice/items 2>/dev/null | head -3
```

Pick the page that renders an individual item (the dynamic `[id]` route). Read it to find a sensible insertion point — typically near other action buttons (edit, delete) at the top or in a header band.

- [ ] **Step 2: Add the button**

Add these imports alongside existing ones at the top of the file (don't duplicate existing imports):

```ts
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { pushItemStockToJubelio } from "@/app/actions/jubelio-outbox";
```

Inside the component body, alongside other handlers, add:

```ts
const { data: session } = useSession();
const isAdmin = session?.user?.permissions?.includes("*") ?? false;

const handlePushStock = async () => {
  if (!item?.id) return;
  const r = await pushItemStockToJubelio(item.id);
  if (r.ok) {
    toast.success(`Queued. Pushes within ~5 seconds.`);
  } else {
    toast.error("Push failed (admin only).");
  }
};
```

(If the existing page is a Server Component using `await` for `params`, you may need to extract the action into a Client Component — see the existing "Push catalog sync" or other admin action buttons on the same page for the pattern. If no such pattern exists, wrap just the button in `'use client'` via a new sibling component file.)

Place the button in the JSX, ideally near other admin actions:

```tsx
{isAdmin && (
  <Button variant="outline" size="sm" onClick={() => void handlePushStock()}>
    Push stock to Jubelio
  </Button>
)}
```

The exact JSX placement depends on the existing layout. If the file is a Server Component with no client interactivity, create a small Client Component file at `apps/web/app/backoffice/items/[id]/_push-stock-button.tsx`:

```tsx
"use client";

import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { pushItemStockToJubelio } from "@/app/actions/jubelio-outbox";

export function PushStockButton({ itemId }: { itemId: string }) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.permissions?.includes("*") ?? false;
  if (!isAdmin) return null;

  const handle = async () => {
    const r = await pushItemStockToJubelio(itemId);
    if (r.ok) toast.success("Queued. Pushes within ~5 seconds.");
    else toast.error("Push failed (admin only).");
  };

  return (
    <Button variant="outline" size="sm" onClick={() => void handle()}>
      Push stock to Jubelio
    </Button>
  );
}
```

Then in the server-component page:

```tsx
import { PushStockButton } from "./_push-stock-button";
// ...
<PushStockButton itemId={item.id} />
```

- [ ] **Step 3: Type-check apps/web**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/backoffice/items
git commit -m "feat(web): per-item 'Push stock to Jubelio' admin button"
```

---

## Task 12: Bulk button + Outbox section on admin dashboard

**Files:**
- Modify: `apps/web/app/backoffice/jubelio/admin/page.tsx`

- [ ] **Step 1: Read the current admin page**

```bash
cat apps/web/app/backoffice/jubelio/admin/page.tsx
```

The page already has: API-calls section + Webhook events section (from sub-1). Add the bulk action band near the top and the Outbox events section at the bottom.

- [ ] **Step 2: Add imports**

Alongside existing imports (don't duplicate; merge into the existing destructured imports of the same source):

```ts
import {
  bulkPushAllStockToJubelio,
  getJubelioOutboxRows,
  getJubelioOutboxStats,
  retryJubelioOutboxRow,
} from "@/app/actions/jubelio-outbox";
```

(`toast` and lucide chevrons are already imported by sub-1's section.)

- [ ] **Step 3: Add outbox state + loader inside the component body**

Alongside the existing webhook state declarations:

```ts
type OutboxRows = Awaited<ReturnType<typeof getJubelioOutboxRows>>;
type OutboxRow = OutboxRows["rows"][number];
type OutboxStats = Awaited<ReturnType<typeof getJubelioOutboxStats>>;

const [outboxRows, setOutboxRows] = useState<OutboxRow[]>([]);
const [outboxTotal, setOutboxTotal] = useState(0);
const [outboxStats, setOutboxStats] = useState<OutboxStats>(null);
const [outboxFilter, setOutboxFilter] = useState<"all" | "errors" | "DEAD">("all");
const [expandedOutboxId, setExpandedOutboxId] = useState<string | null>(null);
const [bulkPushing, setBulkPushing] = useState(false);

const loadOutbox = useCallback(async () => {
  const statusFilter = outboxFilter === "DEAD" ? "DEAD" : undefined;
  const [rowsRes, statsRes] = await Promise.all([
    getJubelioOutboxRows({ limit: 50, offset: 0, status: statusFilter as any }),
    getJubelioOutboxStats(),
  ]);
  let rows = rowsRes.rows;
  if (outboxFilter === "errors") {
    rows = rows.filter((r) => r.status === "DEAD" || r.status === "SKIPPED");
  }
  setOutboxRows(rows);
  setOutboxTotal(rowsRes.total);
  setOutboxStats(statsRes);
}, [outboxFilter]);

useEffect(() => {
  if (status === "authenticated") void loadOutbox();
}, [status, outboxFilter, loadOutbox]);

const handleBulkPush = async () => {
  if (!confirm("Push stock for all mapped items to Jubelio?")) return;
  setBulkPushing(true);
  try {
    const r = await bulkPushAllStockToJubelio();
    if (r.ok) toast.success(`Queued ${r.count} items. Pushes drain over the next few minutes.`);
    else toast.error("Bulk push failed (admin only).");
    void loadOutbox();
  } finally {
    setBulkPushing(false);
  }
};

const handleOutboxRetry = async (id: string) => {
  const r = await retryJubelioOutboxRow(id);
  if (r.ok) {
    toast.success("Re-queued. Poller picks up within ~5 seconds.");
    void loadOutbox();
  } else {
    toast.error("Retry not allowed (status must be DEAD or SKIPPED).");
  }
};
```

- [ ] **Step 4: Add the bulk-push action band near the top of the page**

Insert this near the top of the page JSX, ABOVE the existing API-calls section header (or right at the very top of the returned `<div>`):

```tsx
<Card>
  <CardContent className="flex items-center justify-between gap-4 pt-6">
    <div>
      <p className="font-medium">Bulk push stock to Jubelio</p>
      <p className="text-sm text-muted-foreground">
        Creates one outbox row per mapped item. Worker drains within minutes.
      </p>
    </div>
    <Button onClick={() => void handleBulkPush()} disabled={bulkPushing}>
      {bulkPushing ? "Queuing…" : "Sync all stock"}
    </Button>
  </CardContent>
</Card>
```

- [ ] **Step 5: Add the Outbox events section below the existing Webhook events section**

Append this JSX block after the existing Webhook events `<Card>`:

```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
  {(["PENDING", "PROCESSING", "DONE", "SKIPPED", "DEAD"] as const).map((s) => (
    <Card key={s}>
      <CardHeader className="pb-2">
        <CardDescription>{s}</CardDescription>
        <CardTitle className="text-2xl">{outboxStats?.byStatus?.[s] ?? 0}</CardTitle>
      </CardHeader>
    </Card>
  ))}
</div>

<Card>
  <CardHeader>
    <div className="flex items-center justify-between">
      <div>
        <CardTitle>Outbox events</CardTitle>
        <CardDescription>{outboxTotal} total entries</CardDescription>
      </div>
      <div className="flex gap-2">
        {(["all", "errors", "DEAD"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={outboxFilter === f ? "default" : "outline"}
            onClick={() => setOutboxFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>
    </div>
  </CardHeader>
  <CardContent>
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Time</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Attempts</TableHead>
            <TableHead>Flags / reason</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {outboxRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                No outbox events.
              </TableCell>
            </TableRow>
          ) : (
            outboxRows.map((r) => {
              const expanded = expandedOutboxId === r.id;
              const enqueuedByLabel = r.enqueuedBy?.name ?? r.enqueuedBy?.email ?? "—";
              return (
                <React.Fragment key={r.id}>
                  <TableRow>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setExpandedOutboxId(expanded ? null : r.id)}
                      >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.entityType}:{r.entityId.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "DEAD"
                            ? "destructive"
                            : r.status === "SKIPPED"
                              ? "secondary"
                              : "default"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{r.attempts}</TableCell>
                    <TableCell className="text-xs">
                      {r.skipReason ?? r.lastError?.slice(0, 60) ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {(r.status === "DEAD" || r.status === "SKIPPED") && (
                        <Button size="sm" variant="outline" onClick={() => void handleOutboxRetry(r.id)}>
                          Retry
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow key={`${r.id}-detail`}>
                      <TableCell colSpan={7} className="bg-muted/50">
                        <div className="space-y-2 p-4 text-sm">
                          <p>
                            <span className="font-medium">Enqueued by:</span> {enqueuedByLabel}
                          </p>
                          <p>
                            <span className="font-medium">createdAt:</span>{" "}
                            {new Date(r.createdAt).toLocaleString()}
                          </p>
                          <p>
                            <span className="font-medium">lastEnqueuedAt:</span>{" "}
                            {r.lastEnqueuedAt ? new Date(r.lastEnqueuedAt).toLocaleString() : "—"}
                          </p>
                          <p>
                            <span className="font-medium">processedAt:</span>{" "}
                            {r.processedAt ? new Date(r.processedAt).toLocaleString() : "—"}
                          </p>
                          <p>
                            <span className="font-medium">deadAt:</span>{" "}
                            {r.deadAt ? new Date(r.deadAt).toLocaleString() : "—"}
                          </p>
                          {r.lastError && (
                            <pre className="bg-background max-h-32 overflow-auto rounded p-3 text-xs">
                              {r.lastError}
                            </pre>
                          )}
                          <pre className="bg-background max-h-64 overflow-auto rounded p-3 text-xs">
                            {JSON.stringify(r.payload, null, 2)}
                          </pre>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 6: Type-check apps/web**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent success. If `.next/dev/types/validator.ts` reports a stale TS1128 error, `rm -rf apps/web/.next/dev` and retry.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/backoffice/jubelio/admin/page.tsx
git commit -m "feat(web): bulk push button + outbox section on admin dashboard"
```

---

## Task 13: End-to-end manual smoke

No file changes — verification only.

- [ ] **Step 1: Start support services**

```bash
docker start elorae-dev-redis
```

If ngrok is needed (only for testing real Jubelio receipt of the push):

```bash
ngrok http --url unclean-noncalumniating-cory.ngrok-free.dev 3001 &
```

- [ ] **Step 2: Build + start api in prod mode**

```bash
cd /home/rifkyltf/project/elorae
pnpm prod:api 2>&1 | tail -10
```

Wait for `@elorae/api listening on http://localhost:3001`. Confirm log shows both `JubelioQueueModule dependencies initialized` (sub-1) and `JubelioOutboxModule dependencies initialized` (this branch).

- [ ] **Step 3: Start apps/web dev**

In a second terminal:

```bash
pnpm -F @elorae/web dev
```

Wait for ready on `:3000`.

- [ ] **Step 4: Empty-state check**

Log in as admin (e.g. `admin@elorae.com` / `admin123`). Open `http://localhost:3000/backoffice/jubelio/admin`. Confirm the new **Outbox events** section renders with `0` in every status card and "No outbox events." in the table. Bulk action band visible at top.

- [ ] **Step 5: Single-item push happy path**

Pick a known-mapped item from TiDB (e.g. `itemId` you saw earlier with a `JubelioProductMapping` row). Navigate to that item's detail page. Click **Push stock to Jubelio**. Toast: "Queued. Pushes within ~5 seconds."

Within ~5–10s the row appears in the Outbox section, transitions PENDING → PROCESSING → DONE. Verify via:

```bash
cd packages/db && set -a && source ../../apps/web/.env && set +a && pnpm exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const r = await prisma.jubelioOutbox.findFirst({ orderBy: { createdAt: 'desc' }, select: { status: true, attempts: true, processedAt: true } });
  console.log(r);
  await prisma.\$disconnect();
})();
" 2>&1 | tail -3
```

Expected: `{ status: 'DONE', attempts: 1, processedAt: <Date> }`.

If real Jubelio sees the new stock value depends on whether the `PUT /inventory/items/{group}/stock` path is correct. If Jubelio returns 4xx, the row will go DEAD after retries — that signals you need to adjust the endpoint in `stock-push.handler.ts` per Jubelio's actual docs.

- [ ] **Step 6: Orphan / no-mapping path**

Pick an Item that has NO `JubelioProductMapping` (an ERP-only item). Click the per-item button. Expect Outbox row → `SKIPPED missing_mapping`.

- [ ] **Step 7: Bulk push**

Click **Sync all stock** on the admin dashboard. Confirm dialog. Toast: "Queued N items."

Outbox section fills with N rows in PENDING. Watch them drain over the next minute or two. Expect mostly DONE; any items missing inventory will SKIP `no_inventory`.

- [ ] **Step 8: DEAD path + retry**

Temporarily set wrong Jubelio credentials in `apps/api/.env` (e.g. corrupt `JUBELIO_PASS` by appending a char). Restart api:

```bash
pkill -9 -f "node dist/main"
cd apps/api && NODE_ENV=production node dist/main.js > /tmp/api.log 2>&1 &
```

Click a per-item push. Worker retries 5 times (~80s total) then marks DEAD. AdminNotification appears in the notification bell. Restore the credentials, restart api again, click **Retry** on the DEAD row, confirm it cycles to PENDING → DONE within ~5s.

- [ ] **Step 9: Stop local services**

```bash
pkill -f "node dist/main" 2>/dev/null
pkill -f "next dev" 2>/dev/null
pkill -f "ngrok http" 2>/dev/null
docker stop elorae-dev-redis
```

- [ ] **Step 10: No commit — verification-only task**

If the smoke pass is clean, push the branch:

```bash
git push -u origin feat/jubelio-outbound
```

---

## After all tasks

- Branch `feat/jubelio-outbound` carries the outbound outbox pipeline.
- Run `pnpm -F @elorae/api test` once more: all suites green (sub-1's 20 + this branch's 16 = 36+).
- Open PR `feat/jubelio-outbound → master` once smoke is clean.
- Next slice: **sub-2.5** (auth bridge) — its own design doc and plan. After auth bridge: sub-3 (product push + HPP sync), sub-4 (remaining inbound handlers), sub-5 (bulk migration).

## Self-Review checklist (already run; documenting for the implementer)

- **Spec coverage:**
  - §4.1 schema → Task 1
  - §4.2 status machine → Tasks 2, 8
  - §4.3 skip reasons → Task 2
  - §4.4 migration → Task 1
  - §5.1 module layout → Tasks 2–9
  - §5.2 tuning → Task 4
  - §5.3 poller → Task 7
  - §5.4 worker → Task 8
  - §5.5 router → Task 6
  - §5.6 stock handler → Task 5
  - §5.7 error classification → Task 8 (processor handles all paths)
  - §6.1 server actions → Task 10
  - §6.2 buttons → Tasks 11, 12
  - §7 dashboard extension → Task 12
  - §8 tests → Tasks 5, 6, 8 (handler + router + processor)
  - §8.1 manual smoke → Task 13
- **No placeholders, no "see Task N" cross-refs that omit code, no "add appropriate error handling".**
- **Type consistency:** `OutboxStatus`, `OUTBOX_STATUS`, `TERMINAL_OUTBOX_STATUSES`, `OUTBOX_SKIP_REASONS`, `OutboxHandler`, `HandlerOutcome`, `JubelioOutbox`, `JUBELIO_OUTBOX_QUEUE`, `OUTBOX_QUEUE_DEFAULTS`, `OUTBOX_POLLER` all referenced consistently across tasks.
