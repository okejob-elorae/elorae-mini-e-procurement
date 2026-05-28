# Jubelio Webhook Processing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drain `JubelioWebhookEvent` rows that the api currently only persists — process them through a BullMQ queue with retry, DLQ via DB-mirrored status, and a first real handler that decrements ERP inventory on Jubelio stock-change webhooks.

**Architecture:** Webhook controller persists + enqueues; BullMQ worker (concurrency 1, in-process) drains the queue and routes by event type; `stock` handler resolves SKU via `JubelioProductMapping` and applies a dual-write `StockAdjustment` + `InventoryValue` update through a shared helper in `@elorae/db`. DB row carries authoritative status; periodic sweeper re-enqueues stuck `RECEIVED` rows.

**Tech Stack:** NestJS 11 (apps/api), BullMQ + ioredis, Redis 7 (Docker local), Prisma 7 + MariaDB adapter, Next.js 16 (apps/web admin dashboard), jest + ts-jest (unit tests).

**Spec:** `docs/superpowers/specs/2026-05-28-jubelio-webhook-pipeline-design.md`

---

## File Structure

**New files:**

```
packages/db/src/stock-writer.ts                                 # dual-write helper

apps/api/src/jubelio/queue/jubelio-queue.config.ts              # tuning constants
apps/api/src/jubelio/queue/webhook-status.ts                    # status + types
apps/api/src/jubelio/queue/event-router.ts                      # pure dispatch
apps/api/src/jubelio/queue/webhook-queue.service.ts             # enqueue + sweep
apps/api/src/jubelio/queue/webhook-processor.service.ts         # worker
apps/api/src/jubelio/queue/jubelio-queue.module.ts              # Nest module
apps/api/src/jubelio/queue/errors.ts                            # NonRetryableError

apps/api/src/jubelio/handlers/handler.types.ts                  # HandlerOutcome
apps/api/src/jubelio/handlers/stock.handler.ts                  # real
apps/api/src/jubelio/handlers/unhandled.handler.ts              # stub

apps/api/src/jubelio/handlers/stock.handler.spec.ts
apps/api/src/jubelio/queue/event-router.spec.ts
apps/api/src/jubelio/queue/webhook-processor.service.spec.ts
apps/api/src/jubelio/queue/stock-writer.spec.ts                 # tests the @elorae/db helper

apps/web/app/actions/jubelio-webhooks.ts                        # admin-gated server actions

docker-compose.dev.yml                                          # local Redis
packages/db/prisma/migrations/20260528100000_webhook_pipeline/migration.sql
```

**Modified files:**

```
packages/db/prisma/schema.prisma                                # JubelioWebhookEvent, StockAdjustment, JubelioProductMapping
packages/db/src/index.ts                                        # re-export stock-writer
apps/api/package.json                                           # jest config + bullmq deps
apps/api/src/jubelio/webhooks/webhooks.controller.ts            # enqueue after persist
apps/api/src/jubelio/jubelio.module.ts                          # register queue module
apps/api/src/app.module.ts                                      # BullMQ root + queue module
apps/api/.env.example                                           # REDIS_URL
apps/web/app/backoffice/jubelio/admin/page.tsx                  # webhook section
```

---

## Task 0: Jest configuration for apps/api

**Files:**
- Modify: `apps/api/package.json` (add `jest` config block)
- Create: `apps/api/src/sanity.spec.ts` (temporary — deleted at end of task)

- [ ] **Step 1: Add jest config to apps/api/package.json**

Insert the `jest` block at the top level of `apps/api/package.json` (alongside `scripts`, `dependencies`):

```json
"jest": {
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "src",
  "testRegex": ".*\\.spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "testEnvironment": "node",
  "moduleNameMapper": {
    "^@elorae/db$": "<rootDir>/../../../packages/db/dist/src/index.js",
    "^@elorae/db/color$": "<rootDir>/../../../packages/db/dist/src/color/lab.js",
    "^@elorae/db/pantone$": "<rootDir>/../../../packages/db/dist/src/pantone/classify.js"
  }
}
```

- [ ] **Step 2: Write sanity test**

Create `apps/api/src/sanity.spec.ts`:

```ts
describe("jest sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Run the sanity test, verify jest works**

```bash
pnpm -F @elorae/api test 2>&1 | tail -10
```

Expected: `Tests: 1 passed, 1 total`.

- [ ] **Step 4: Delete the sanity file**

```bash
rm apps/api/src/sanity.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json
git commit -m "build(api): add jest config for unit tests"
```

---

## Task 1: Schema additions + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260528100000_webhook_pipeline/migration.sql`

- [ ] **Step 1: Add three columns to `JubelioWebhookEvent` in schema.prisma**

Find the existing `model JubelioWebhookEvent` block. Inside it, add the three new fields after `processedAt`:

```prisma
model JubelioWebhookEvent {
  id          String    @id @default(cuid())
  event       String
  eventId     String?
  signature   String    @db.Text
  payloadHash String
  rawPayload  Json
  status      String    @default("RECEIVED")
  attempts    Int       @default(0)
  lastError   String?   @db.Text
  receivedAt  DateTime  @default(now())
  processedAt DateTime?
  skipReason     String?
  deadAt         DateTime?
  lastEnqueuedAt DateTime?

  @@unique([event, payloadHash])
  @@index([status, receivedAt])
  @@index([event, receivedAt])
}
```

- [ ] **Step 2: Modify `StockAdjustment` for webhook-sourced rows**

Find the existing `model StockAdjustment`. Make `approvedById` and `createdById` nullable, then add `source`, `idempotencyKey`, `externalRef`, and an index:

```prisma
model StockAdjustment {
  id            String   @id @default(cuid())
  docNumber     String   @unique
  itemId        String
  item          Item     @relation(fields: [itemId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  type          AdjustmentType
  qtyChange     Decimal  @db.Decimal(10,2)
  reason        String
  evidenceUrl   String?
  prevQty       Decimal  @db.Decimal(10,2)
  newQty        Decimal  @db.Decimal(10,2)
  prevAvgCost   Decimal  @db.Decimal(15,2)
  newAvgCost    Decimal  @db.Decimal(15,2)
  approvedById  String?
  approvedBy    User?    @relation("ApprovedAdjustments", fields: [approvedById], references: [id], onDelete: NoAction, onUpdate: NoAction)
  createdById   String?
  createdBy     User?    @relation("CreatedAdjustments", fields: [createdById], references: [id], onDelete: NoAction, onUpdate: NoAction)
  source           String   @default("ERP")
  idempotencyKey   String?  @unique
  externalRef      String?
  createdAt     DateTime @default(now())
  @@index([itemId])
  @@index([approvedById])
  @@index([createdById])
  @@index([source, createdAt])
}
```

- [ ] **Step 3: Add `@unique` to `JubelioProductMapping.jubelioItemCode`**

Find `model JubelioProductMapping` and change the `jubelioItemCode` line to mark it unique:

```prisma
  jubelioItemCode     String    @unique
```

- [ ] **Step 4: Create migration SQL**

```bash
mkdir -p packages/db/prisma/migrations/20260528100000_webhook_pipeline
```

Create `packages/db/prisma/migrations/20260528100000_webhook_pipeline/migration.sql`:

```sql
-- AlterTable JubelioWebhookEvent
ALTER TABLE `JubelioWebhookEvent`
  ADD COLUMN `skipReason` VARCHAR(191) NULL,
  ADD COLUMN `deadAt` DATETIME(3) NULL,
  ADD COLUMN `lastEnqueuedAt` DATETIME(3) NULL;

-- AlterTable StockAdjustment — relax approver/creator + add webhook columns
ALTER TABLE `StockAdjustment` MODIFY `approvedById` VARCHAR(191) NULL;
ALTER TABLE `StockAdjustment` MODIFY `createdById` VARCHAR(191) NULL;
ALTER TABLE `StockAdjustment`
  ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'ERP',
  ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
  ADD COLUMN `externalRef` VARCHAR(191) NULL;

-- Sparse unique on idempotencyKey
CREATE UNIQUE INDEX `StockAdjustment_idempotencyKey_key` ON `StockAdjustment`(`idempotencyKey`);
-- Filter index for source queries
CREATE INDEX `StockAdjustment_source_createdAt_idx` ON `StockAdjustment`(`source`, `createdAt`);

-- AlterTable JubelioProductMapping — make jubelioItemCode unique
CREATE UNIQUE INDEX `JubelioProductMapping_jubelioItemCode_key` ON `JubelioProductMapping`(`jubelioItemCode`);
```

- [ ] **Step 5: Regenerate Prisma client**

```bash
pnpm -F @elorae/db generate 2>&1 | tail -3
```

Expected: `✔ Generated Prisma Client`.

- [ ] **Step 6: Apply migration to TiDB**

```bash
pnpm -F @elorae/db migrate:deploy 2>&1 | tail -10
```

Expected: `Applying migration 20260528100000_webhook_pipeline` and `All migrations have been successfully applied.`

- [ ] **Step 7: Rebuild @elorae/db dist**

```bash
pnpm -F @elorae/db build 2>&1 | tail -3
```

Expected: silent success (no errors).

- [ ] **Step 8: Manual verify columns**

```bash
cd /home/rifkyltf/project/elorae/packages/db && set -a && source ../../apps/web/.env && set +a && pnpm exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const event = await prisma.jubelioWebhookEvent.findFirst({ select: { id: true, skipReason: true, deadAt: true, lastEnqueuedAt: true } });
  const adj = await prisma.stockAdjustment.findFirst({ select: { id: true, source: true, idempotencyKey: true, externalRef: true, approvedById: true } });
  console.log('event sample:', event);
  console.log('adj sample:', adj);
  await prisma.\$disconnect();
})();
" 2>&1 | tail -5
```

Expected: prints sample row(s) with the new columns present (null is fine for existing rows; `source` should be `'ERP'`).

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260528100000_webhook_pipeline
git commit -m "feat(db): schema for webhook pipeline (status fields + stock adjustment source)"
```

---

## Task 2: Dual-write helper `applyJubelioStockAdjustment`

**Files:**
- Create: `packages/db/src/stock-writer.ts`
- Modify: `packages/db/src/index.ts`
- Create: `apps/api/src/jubelio/queue/stock-writer.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/jubelio/queue/stock-writer.spec.ts`:

```ts
import { applyJubelioStockAdjustment } from "@elorae/db";

type MockTx = {
  stockAdjustment: { create: jest.Mock };
  inventoryValue: { findUnique: jest.Mock; update: jest.Mock };
};

function buildPrismaMock() {
  const tx: MockTx = {
    stockAdjustment: { create: jest.fn() },
    inventoryValue: { findUnique: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (cb: (t: MockTx) => Promise<unknown>) => cb(tx)),
  };
  return { prisma, tx };
}

describe("applyJubelioStockAdjustment", () => {
  it("inserts StockAdjustment and updates InventoryValue on first apply", async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.inventoryValue.findUnique.mockResolvedValue({ qtyOnHand: 10, avgCost: 100 });
    tx.stockAdjustment.create.mockResolvedValue({ id: "adj_1" });
    tx.inventoryValue.update.mockResolvedValue({});

    const result = await applyJubelioStockAdjustment(prisma as any, {
      itemId: "item_1",
      variantSku: "SKU-A",
      newQty: 5,
      idempotencyKey: "evt_1",
      externalRef: "JBLITEM-1",
      reason: "test",
    });

    expect(result).toEqual({ adjustmentId: "adj_1", skipped: false });
    expect(tx.stockAdjustment.create).toHaveBeenCalledTimes(1);
    const createArg = tx.stockAdjustment.create.mock.calls[0][0].data;
    expect(createArg.source).toBe("JUBELIO_WEBHOOK");
    expect(createArg.idempotencyKey).toBe("evt_1");
    expect(createArg.externalRef).toBe("JBLITEM-1");
    expect(Number(createArg.prevQty)).toBe(10);
    expect(Number(createArg.newQty)).toBe(5);
    expect(Number(createArg.qtyChange)).toBe(-5);
    expect(tx.inventoryValue.update).toHaveBeenCalledWith({
      where: { itemId_variantSku: { itemId: "item_1", variantSku: "SKU-A" } },
      data: { qtyOnHand: 5 },
    });
  });

  it("returns skipped:true when idempotencyKey already used (P2002)", async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.inventoryValue.findUnique.mockResolvedValue({ qtyOnHand: 10, avgCost: 100 });
    const err: any = new Error("Unique constraint failed");
    err.code = "P2002";
    err.meta = { target: ["idempotencyKey"] };
    tx.stockAdjustment.create.mockRejectedValue(err);

    const result = await applyJubelioStockAdjustment(prisma as any, {
      itemId: "item_1",
      variantSku: "SKU-A",
      newQty: 5,
      idempotencyKey: "evt_1",
      externalRef: "JBLITEM-1",
      reason: "test",
    });

    expect(result).toEqual({ adjustmentId: null, skipped: true });
    expect(tx.inventoryValue.update).not.toHaveBeenCalled();
  });

  it("throws when InventoryValue is missing", async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.inventoryValue.findUnique.mockResolvedValue(null);

    await expect(
      applyJubelioStockAdjustment(prisma as any, {
        itemId: "item_1",
        variantSku: "SKU-A",
        newQty: 5,
        idempotencyKey: "evt_1",
        externalRef: "JBLITEM-1",
        reason: "test",
      }),
    ).rejects.toThrow(/InventoryValue not found/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm -F @elorae/api test 2>&1 | tail -10
```

Expected: failures referencing `applyJubelioStockAdjustment` not being exported / not a function.

- [ ] **Step 3: Implement the helper**

Create `packages/db/src/stock-writer.ts`:

```ts
import { Prisma, type PrismaClient } from "../generated/prisma/client";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export type ApplyJubelioStockAdjustmentInput = {
  itemId: string;
  variantSku: string;
  newQty: number;
  idempotencyKey: string;
  externalRef: string;
  reason: string;
};

export type ApplyJubelioStockAdjustmentResult = {
  adjustmentId: string | null;
  skipped: boolean;
};

export class InventoryValueMissingError extends Error {
  constructor(itemId: string, variantSku: string) {
    super(`InventoryValue not found for (itemId=${itemId}, variantSku="${variantSku}")`);
    this.name = "InventoryValueMissingError";
  }
}

export async function applyJubelioStockAdjustment(
  client: AnyClient,
  input: ApplyJubelioStockAdjustmentInput,
): Promise<ApplyJubelioStockAdjustmentResult> {
  const isTx = typeof (client as PrismaClient).$transaction !== "function";
  const run = async (tx: Prisma.TransactionClient): Promise<ApplyJubelioStockAdjustmentResult> => {
    const inv = await tx.inventoryValue.findUnique({
      where: { itemId_variantSku: { itemId: input.itemId, variantSku: input.variantSku } },
    });
    if (!inv) throw new InventoryValueMissingError(input.itemId, input.variantSku);

    const prevQty = Number(inv.qtyOnHand);
    const avgCost = Number(inv.avgCost);
    const delta = input.newQty - prevQty;

    try {
      const created = await tx.stockAdjustment.create({
        data: {
          docNumber: `JBL-${input.idempotencyKey}`,
          itemId: input.itemId,
          type: "MANUAL",
          qtyChange: delta,
          reason: input.reason,
          prevQty,
          newQty: input.newQty,
          prevAvgCost: avgCost,
          newAvgCost: avgCost,
          source: "JUBELIO_WEBHOOK",
          idempotencyKey: input.idempotencyKey,
          externalRef: input.externalRef,
        },
        select: { id: true },
      });

      await tx.inventoryValue.update({
        where: { itemId_variantSku: { itemId: input.itemId, variantSku: input.variantSku } },
        data: { qtyOnHand: input.newQty },
      });

      return { adjustmentId: created.id, skipped: false };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return { adjustmentId: null, skipped: true };
      }
      throw err;
    }
  };

  if (isTx) {
    return run(client as Prisma.TransactionClient);
  }
  return (client as PrismaClient).$transaction(run);
}
```

Note on `type: "MANUAL"` — this assumes `AdjustmentType` enum has a `MANUAL` value. Verify by reading `packages/db/prisma/schema.prisma` for the `AdjustmentType` enum. If `MANUAL` is not present, pick the closest neutral value (commonly `SYSTEM`, `OTHER`, `ADJUSTMENT`). Update the type literal accordingly before running tests.

- [ ] **Step 4: Re-export from package barrel**

Modify `packages/db/src/index.ts`. Find the existing `export { ... } from "./item-writer";` block and add the stock-writer exports immediately after it:

```ts
export {
  applyJubelioStockAdjustment,
  InventoryValueMissingError,
  type ApplyJubelioStockAdjustmentInput,
  type ApplyJubelioStockAdjustmentResult,
} from "./stock-writer";
```

- [ ] **Step 5: Rebuild @elorae/db**

```bash
pnpm -F @elorae/db build 2>&1 | tail -3
```

Expected: silent success.

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm -F @elorae/api test --testPathPattern stock-writer 2>&1 | tail -10
```

Expected: `Tests: 3 passed`.

If a test fails with `Prisma.PrismaClientKnownRequestError` not matching, adjust the mock error to construct via `new Prisma.PrismaClientKnownRequestError("...", { code: "P2002", clientVersion: "test" })` and import from `@elorae/db`. The current mock uses a duck-typed object — Prisma's `instanceof` check may need the real class. Switch the mock if needed.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/stock-writer.ts packages/db/src/index.ts apps/api/src/jubelio/queue/stock-writer.spec.ts
git commit -m "feat(db): applyJubelioStockAdjustment dual-write helper with idempotency"
```

---

## Task 3: Status constants + handler types + errors

**Files:**
- Create: `apps/api/src/jubelio/queue/webhook-status.ts`
- Create: `apps/api/src/jubelio/queue/errors.ts`
- Create: `apps/api/src/jubelio/handlers/handler.types.ts`

- [ ] **Step 1: Write status constants**

Create `apps/api/src/jubelio/queue/webhook-status.ts`:

```ts
export const WEBHOOK_STATUS = {
  RECEIVED: "RECEIVED",
  PROCESSING: "PROCESSING",
  PROCESSED: "PROCESSED",
  SKIPPED: "SKIPPED",
  DEAD: "DEAD",
} as const;

export type WebhookStatus = (typeof WEBHOOK_STATUS)[keyof typeof WEBHOOK_STATUS];

export const TERMINAL_STATUSES: ReadonlySet<WebhookStatus> = new Set([
  WEBHOOK_STATUS.PROCESSED,
  WEBHOOK_STATUS.SKIPPED,
  WEBHOOK_STATUS.DEAD,
]);

export const SKIP_REASONS = {
  UNHANDLED_EVENT_TYPE: "unhandled_event_type",
  UNKNOWN_EVENT: "unknown_event",
  ORPHAN_SKU: "orphan_sku",
} as const;
```

- [ ] **Step 2: Write error class**

Create `apps/api/src/jubelio/queue/errors.ts`:

```ts
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
```

- [ ] **Step 3: Write handler outcome types**

Create `apps/api/src/jubelio/handlers/handler.types.ts`:

```ts
import type { JubelioWebhookEvent } from "@elorae/db";

export type HandlerOutcome =
  | { kind: "processed" }
  | { kind: "skipped"; reason: string };

export interface WebhookEventHandler {
  handle(row: JubelioWebhookEvent): Promise<HandlerOutcome>;
}
```

- [ ] **Step 4: Type-check apps/api**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/queue/webhook-status.ts apps/api/src/jubelio/queue/errors.ts apps/api/src/jubelio/handlers/handler.types.ts
git commit -m "feat(api): webhook status + handler types + NonRetryableError"
```

---

## Task 4: Queue config constants

**Files:**
- Create: `apps/api/src/jubelio/queue/jubelio-queue.config.ts`

- [ ] **Step 1: Write config file**

Create `apps/api/src/jubelio/queue/jubelio-queue.config.ts`:

```ts
import { CronExpression } from "@nestjs/schedule";

export const JUBELIO_WEBHOOK_QUEUE = "jubelio-webhook";

export const QUEUE_DEFAULTS = {
  JOB_ATTEMPTS: 5,
  BACKOFF_BASE_MS: 5_000,
  REMOVE_ON_COMPLETE_COUNT: 1_000,
  REMOVE_ON_FAIL_COUNT: 5_000,
  WORKER_CONCURRENCY: 1,
} as const;

export const SWEEP = {
  STUCK_AFTER_MS: 5 * 60 * 1_000,
  BATCH: 100,
  CRON: CronExpression.EVERY_10_MINUTES,
} as const;
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jubelio/queue/jubelio-queue.config.ts
git commit -m "feat(api): jubelio webhook queue tuning constants"
```

---

## Task 5: Unhandled handler

**Files:**
- Create: `apps/api/src/jubelio/handlers/unhandled.handler.ts`

- [ ] **Step 1: Write the handler**

Create `apps/api/src/jubelio/handlers/unhandled.handler.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";

@Injectable()
export class UnhandledEventHandler implements WebhookEventHandler {
  async handle(): Promise<HandlerOutcome> {
    return { kind: "skipped", reason: SKIP_REASONS.UNHANDLED_EVENT_TYPE };
  }
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jubelio/handlers/unhandled.handler.ts
git commit -m "feat(api): unhandled webhook event handler"
```

---

## Task 6: Stock handler

**Files:**
- Create: `apps/api/src/jubelio/handlers/stock.handler.spec.ts`
- Create: `apps/api/src/jubelio/handlers/stock.handler.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/jubelio/handlers/stock.handler.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { StockWebhookHandler } from "./stock.handler";
import { PRISMA } from "../../db/prisma.module";
import { SKIP_REASONS } from "../queue/webhook-status";

jest.mock("@elorae/db", () => ({
  applyJubelioStockAdjustment: jest.fn(),
}));

import { applyJubelioStockAdjustment } from "@elorae/db";

function row(overrides: any = {}) {
  return {
    id: "evt_1",
    event: "stock",
    eventId: null,
    signature: "sig",
    payloadHash: "hash",
    rawPayload: { item_code: "SKU-A", end_qty: "5" },
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    processedAt: null,
    skipReason: null,
    deadAt: null,
    lastEnqueuedAt: null,
    ...overrides,
  };
}

describe("StockWebhookHandler", () => {
  let handler: StockWebhookHandler;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      jubelioProductMapping: { findUnique: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        StockWebhookHandler,
        { provide: PRISMA, useValue: prisma },
      ],
    }).compile();
    handler = mod.get(StockWebhookHandler);
    (applyJubelioStockAdjustment as jest.Mock).mockReset();
  });

  it("returns SKIPPED orphan_sku when mapping not found", async () => {
    prisma.jubelioProductMapping.findUnique.mockResolvedValue(null);

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "skipped", reason: `${SKIP_REASONS.ORPHAN_SKU}:SKU-A` });
    expect(applyJubelioStockAdjustment).not.toHaveBeenCalled();
  });

  it("calls applyJubelioStockAdjustment with mapped item + variant", async () => {
    prisma.jubelioProductMapping.findUnique.mockResolvedValue({
      itemId: "item_1",
      erpVariantSku: "VAR-A",
    });
    (applyJubelioStockAdjustment as jest.Mock).mockResolvedValue({ adjustmentId: "adj_1", skipped: false });

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(applyJubelioStockAdjustment).toHaveBeenCalledWith(prisma, {
      itemId: "item_1",
      variantSku: "VAR-A",
      newQty: 5,
      idempotencyKey: "evt_1",
      externalRef: "SKU-A",
      reason: "Jubelio stock webhook event evt_1",
    });
  });

  it("rethrows when applyJubelioStockAdjustment throws", async () => {
    prisma.jubelioProductMapping.findUnique.mockResolvedValue({
      itemId: "item_1",
      erpVariantSku: "VAR-A",
    });
    (applyJubelioStockAdjustment as jest.Mock).mockRejectedValue(new Error("InventoryValue not found"));

    await expect(handler.handle(row() as any)).rejects.toThrow(/InventoryValue not found/);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm -F @elorae/api test --testPathPattern stock.handler 2>&1 | tail -15
```

Expected: failures (module not found `./stock.handler` or `StockWebhookHandler` not exported).

- [ ] **Step 3: Write the handler**

Create `apps/api/src/jubelio/handlers/stock.handler.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { applyJubelioStockAdjustment } from "@elorae/db";
import type { JubelioWebhookEvent } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";

type StockWebhookPayload = {
  item_code: string;
  end_qty: number | string;
};

@Injectable()
export class StockWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(StockWebhookHandler.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaService) {}

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    const payload = row.rawPayload as unknown as StockWebhookPayload;
    if (!payload?.item_code) {
      return { kind: "skipped", reason: `${SKIP_REASONS.ORPHAN_SKU}:<missing>` };
    }

    const mapping = await this.prisma.jubelioProductMapping.findUnique({
      where: { jubelioItemCode: payload.item_code },
    });
    if (!mapping) {
      return { kind: "skipped", reason: `${SKIP_REASONS.ORPHAN_SKU}:${payload.item_code}` };
    }

    await applyJubelioStockAdjustment(this.prisma, {
      itemId: mapping.itemId,
      variantSku: mapping.erpVariantSku,
      newQty: Number(payload.end_qty),
      idempotencyKey: row.id,
      externalRef: payload.item_code,
      reason: `Jubelio stock webhook event ${row.id}`,
    });

    return { kind: "processed" };
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm -F @elorae/api test --testPathPattern stock.handler 2>&1 | tail -10
```

Expected: `Tests: 3 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/handlers/stock.handler.ts apps/api/src/jubelio/handlers/stock.handler.spec.ts
git commit -m "feat(api): stock webhook handler with orphan SKU skip"
```

---

## Task 7: Event router

**Files:**
- Create: `apps/api/src/jubelio/queue/event-router.spec.ts`
- Create: `apps/api/src/jubelio/queue/event-router.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/jubelio/queue/event-router.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { JubelioEventRouter } from "./event-router";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { UnhandledEventHandler } from "../handlers/unhandled.handler";
import { PRISMA } from "../../db/prisma.module";
import { SKIP_REASONS } from "./webhook-status";

function row(event: string) {
  return {
    id: "r1",
    event,
    rawPayload: {},
  } as any;
}

describe("JubelioEventRouter", () => {
  let router: JubelioEventRouter;
  let stockHandler: { handle: jest.Mock };
  let unhandled: UnhandledEventHandler;

  beforeEach(async () => {
    stockHandler = { handle: jest.fn().mockResolvedValue({ kind: "processed" }) };
    const mod = await Test.createTestingModule({
      providers: [
        JubelioEventRouter,
        { provide: StockWebhookHandler, useValue: stockHandler },
        UnhandledEventHandler,
        { provide: PRISMA, useValue: {} },
      ],
    }).compile();
    router = mod.get(JubelioEventRouter);
    unhandled = mod.get(UnhandledEventHandler);
  });

  it("routes `stock` to StockWebhookHandler", async () => {
    const result = await router.route(row("stock"));
    expect(stockHandler.handle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "processed" });
  });

  it.each(["salesorder", "salesreturn", "product"])(
    "routes `%s` to SKIPPED unhandled_event_type",
    async (event) => {
      const result = await router.route(row(event));
      expect(stockHandler.handle).not.toHaveBeenCalled();
      expect(result).toEqual({ kind: "skipped", reason: SKIP_REASONS.UNHANDLED_EVENT_TYPE });
    },
  );

  it("routes unknown event type to SKIPPED unknown_event:<x>", async () => {
    const result = await router.route(row("mystery"));
    expect(result).toEqual({ kind: "skipped", reason: `${SKIP_REASONS.UNKNOWN_EVENT}:mystery` });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm -F @elorae/api test --testPathPattern event-router 2>&1 | tail -10
```

Expected: module not found.

- [ ] **Step 3: Write the router**

Create `apps/api/src/jubelio/queue/event-router.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { UnhandledEventHandler } from "../handlers/unhandled.handler";
import type { HandlerOutcome } from "../handlers/handler.types";
import { SKIP_REASONS } from "./webhook-status";

const KNOWN_UNHANDLED = new Set(["salesorder", "salesreturn", "product"]);

@Injectable()
export class JubelioEventRouter {
  constructor(
    private readonly stockHandler: StockWebhookHandler,
    private readonly unhandled: UnhandledEventHandler,
  ) {}

  async route(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    switch (row.event) {
      case "stock":
        return this.stockHandler.handle(row);
      default:
        if (KNOWN_UNHANDLED.has(row.event)) {
          return this.unhandled.handle();
        }
        return { kind: "skipped", reason: `${SKIP_REASONS.UNKNOWN_EVENT}:${row.event}` };
    }
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm -F @elorae/api test --testPathPattern event-router 2>&1 | tail -10
```

Expected: `Tests: 5 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/queue/event-router.ts apps/api/src/jubelio/queue/event-router.spec.ts
git commit -m "feat(api): jubelio webhook event router"
```

---

## Task 8: Webhook queue service (enqueue + sweep)

**Files:**
- Create: `apps/api/src/jubelio/queue/webhook-queue.service.ts`

This service has side effects against BullMQ + Prisma + cron. Skipping unit tests (BullMQ mocking is high-overhead, library trust is acceptable). The behavior is exercised through manual smoke later.

- [ ] **Step 1: Write the service**

Create `apps/api/src/jubelio/queue/webhook-queue.service.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JUBELIO_WEBHOOK_QUEUE, QUEUE_DEFAULTS, SWEEP } from "./jubelio-queue.config";
import { WEBHOOK_STATUS } from "./webhook-status";

@Injectable()
export class WebhookQueueService {
  private readonly logger = new Logger(WebhookQueueService.name);

  constructor(
    @InjectQueue(JUBELIO_WEBHOOK_QUEUE) private readonly q: Queue,
    @Inject(PRISMA) private readonly prisma: PrismaService,
  ) {}

  async enqueue(rowId: string): Promise<void> {
    await this.q.add(
      "process",
      { rowId },
      {
        attempts: QUEUE_DEFAULTS.JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: QUEUE_DEFAULTS.BACKOFF_BASE_MS },
        removeOnComplete: { count: QUEUE_DEFAULTS.REMOVE_ON_COMPLETE_COUNT },
        removeOnFail: { count: QUEUE_DEFAULTS.REMOVE_ON_FAIL_COUNT },
        jobId: rowId,
      },
    );
    await this.prisma.jubelioWebhookEvent.update({
      where: { id: rowId },
      data: { lastEnqueuedAt: new Date() },
    });
  }

  @Cron(SWEEP.CRON, { name: "jubelio-webhook-sweep" })
  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - SWEEP.STUCK_AFTER_MS);
    const stuck = await this.prisma.jubelioWebhookEvent.findMany({
      where: {
        status: WEBHOOK_STATUS.RECEIVED,
        OR: [{ lastEnqueuedAt: null }, { lastEnqueuedAt: { lt: cutoff } }],
      },
      select: { id: true },
      take: SWEEP.BATCH,
    });
    for (const { id } of stuck) {
      try {
        await this.enqueue(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Sweep failed to re-enqueue ${id}: ${msg}`);
      }
    }
    if (stuck.length > 0) {
      this.logger.warn(`Sweeper re-enqueued ${stuck.length} stuck webhook rows`);
    }
  }
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -10
```

Expected: errors that `@nestjs/bullmq` and `bullmq` are not installed. That's fine — they're added in Task 10. Note the errors and proceed (they'll resolve once deps install).

Alternative: if the type-check noise bothers you, defer creating this file until Task 10 lands the deps. Either order works; this plan creates the file first and installs deps later for grouping.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jubelio/queue/webhook-queue.service.ts
git commit -m "feat(api): webhook queue service (enqueue + sweep cron)"
```

---

## Task 9: Webhook processor (worker)

**Files:**
- Create: `apps/api/src/jubelio/queue/webhook-processor.service.spec.ts`
- Create: `apps/api/src/jubelio/queue/webhook-processor.service.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/jubelio/queue/webhook-processor.service.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { WebhookProcessor } from "./webhook-processor.service";
import { JubelioEventRouter } from "./event-router";
import { AdminNotificationService } from "../../admin/notification.service";
import { PRISMA } from "../../db/prisma.module";
import { WEBHOOK_STATUS } from "./webhook-status";
import { NonRetryableError } from "./errors";

function rowFixture(overrides: any = {}) {
  return {
    id: "r1",
    event: "stock",
    rawPayload: {},
    status: WEBHOOK_STATUS.RECEIVED,
    attempts: 0,
    ...overrides,
  };
}

describe("WebhookProcessor", () => {
  let processor: WebhookProcessor;
  let prisma: any;
  let router: { route: jest.Mock };
  let admin: { write: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioWebhookEvent: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    router = { route: jest.fn() };
    admin = { write: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        WebhookProcessor,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioEventRouter, useValue: router },
        { provide: AdminNotificationService, useValue: admin },
      ],
    }).compile();
    processor = mod.get(WebhookProcessor);
  });

  it("returns silently when row not found", async () => {
    prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(null);
    await processor.process({ data: { rowId: "missing" } } as any);
    expect(router.route).not.toHaveBeenCalled();
  });

  it.each([WEBHOOK_STATUS.PROCESSED, WEBHOOK_STATUS.DEAD, WEBHOOK_STATUS.SKIPPED])(
    "early-returns when row already %s",
    async (status) => {
      prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(rowFixture({ status }));
      await processor.process({ data: { rowId: "r1" } } as any);
      expect(router.route).not.toHaveBeenCalled();
    },
  );

  it("transitions RECEIVED → PROCESSING → PROCESSED on success", async () => {
    prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "processed" });

    await processor.process({ data: { rowId: "r1" } } as any);

    const updates = prisma.jubelioWebhookEvent.update.mock.calls;
    expect(updates[0][0].data).toMatchObject({ status: WEBHOOK_STATUS.PROCESSING });
    expect(updates[updates.length - 1][0].data).toMatchObject({
      status: WEBHOOK_STATUS.PROCESSED,
    });
    expect(updates[updates.length - 1][0].data.processedAt).toBeInstanceOf(Date);
  });

  it("transitions to SKIPPED with reason", async () => {
    prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(rowFixture());
    router.route.mockResolvedValue({ kind: "skipped", reason: "orphan_sku:X" });

    await processor.process({ data: { rowId: "r1" } } as any);

    const updates = prisma.jubelioWebhookEvent.update.mock.calls;
    expect(updates[updates.length - 1][0].data).toMatchObject({
      status: WEBHOOK_STATUS.SKIPPED,
      skipReason: "orphan_sku:X",
    });
  });

  it("transitions to DEAD on NonRetryableError without rethrowing", async () => {
    prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(rowFixture());
    router.route.mockRejectedValue(new NonRetryableError("bad payload"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).resolves.not.toThrow();

    const updates = prisma.jubelioWebhookEvent.update.mock.calls;
    expect(updates.some((c: any[]) => c[0].data.status === WEBHOOK_STATUS.DEAD)).toBe(true);
    expect(admin.write).toHaveBeenCalledWith(
      expect.objectContaining({ category: "jubelio-webhook", severity: "ERROR" }),
    );
  });

  it("rethrows generic errors for BullMQ retry", async () => {
    prisma.jubelioWebhookEvent.findUnique.mockResolvedValue(rowFixture());
    router.route.mockRejectedValue(new Error("transient"));

    await expect(processor.process({ data: { rowId: "r1" } } as any)).rejects.toThrow(/transient/);
    expect(admin.write).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm -F @elorae/api test --testPathPattern webhook-processor 2>&1 | tail -10
```

Expected: module not found.

- [ ] **Step 3: Write the processor**

Create `apps/api/src/jubelio/queue/webhook-processor.service.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { AdminNotificationService } from "../../admin/notification.service";
import { JubelioEventRouter } from "./event-router";
import { NonRetryableError } from "./errors";
import { TERMINAL_STATUSES, WEBHOOK_STATUS } from "./webhook-status";
import { JUBELIO_WEBHOOK_QUEUE, QUEUE_DEFAULTS } from "./jubelio-queue.config";

type JobPayload = { rowId: string };

@Processor(JUBELIO_WEBHOOK_QUEUE, { concurrency: QUEUE_DEFAULTS.WORKER_CONCURRENCY })
@Injectable()
export class WebhookProcessor extends WorkerHost<Job<JobPayload>> {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly router: JubelioEventRouter,
    private readonly admin: AdminNotificationService,
  ) {
    super();
  }

  async process(job: Job<JobPayload>): Promise<void> {
    const row = await this.prisma.jubelioWebhookEvent.findUnique({
      where: { id: job.data.rowId },
    });
    if (!row) {
      this.logger.warn(`row ${job.data.rowId} not found; ignoring`);
      return;
    }
    if (TERMINAL_STATUSES.has(row.status as never)) {
      return;
    }

    await this.prisma.jubelioWebhookEvent.update({
      where: { id: row.id },
      data: { status: WEBHOOK_STATUS.PROCESSING, attempts: { increment: 1 } },
    });

    try {
      const outcome = await this.router.route(row);
      if (outcome.kind === "skipped") {
        await this.markSkipped(row.id, outcome.reason);
      } else {
        await this.markProcessed(row.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.jubelioWebhookEvent.update({
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
    if (job.attemptsMade < QUEUE_DEFAULTS.JOB_ATTEMPTS) return;
    await this.markDead(job.data.rowId, err.message);
  }

  private async markProcessed(id: string): Promise<void> {
    await this.prisma.jubelioWebhookEvent.update({
      where: { id },
      data: { status: WEBHOOK_STATUS.PROCESSED, processedAt: new Date() },
    });
  }

  private async markSkipped(id: string, reason: string): Promise<void> {
    await this.prisma.jubelioWebhookEvent.update({
      where: { id },
      data: { status: WEBHOOK_STATUS.SKIPPED, skipReason: reason, processedAt: new Date() },
    });
  }

  private async markDead(id: string, message: string): Promise<void> {
    await this.prisma.jubelioWebhookEvent.update({
      where: { id },
      data: { status: WEBHOOK_STATUS.DEAD, deadAt: new Date(), lastError: message },
    });
    await this.admin.write({
      category: "jubelio-webhook",
      severity: "ERROR",
      title: `Webhook event ${id} marked DEAD`,
      message,
    });
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm -F @elorae/api test --testPathPattern webhook-processor 2>&1 | tail -10
```

Expected: `Tests: 7 passed`. Type-check may still error on `@nestjs/bullmq`/`bullmq` until Task 10 — jest will still run because ts-jest is lenient on unresolved types at runtime (the imports are mocked anyway in the test).

If jest fails to resolve `@nestjs/bullmq` at runtime, defer running these specific tests until after Task 10 (`pnpm -F @elorae/api test` once deps are in). Mark this step as "deferred-verify" and continue.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/queue/webhook-processor.service.ts apps/api/src/jubelio/queue/webhook-processor.service.spec.ts
git commit -m "feat(api): webhook processor with status mirroring + DEAD on terminal failure"
```

---

## Task 10: Install BullMQ deps + Nest queue module

**Files:**
- Modify: `apps/api/package.json` (add deps)
- Create: `apps/api/src/jubelio/queue/jubelio-queue.module.ts`
- Modify: `apps/api/src/jubelio/jubelio.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Install runtime deps**

```bash
pnpm -F @elorae/api add bullmq @nestjs/bullmq ioredis 2>&1 | tail -5
```

Expected: success message; lockfile updated.

- [ ] **Step 2: Write the queue module**

Create `apps/api/src/jubelio/queue/jubelio-queue.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AdminModule } from "../../admin/admin.module";
import { PrismaModule } from "../../db/prisma.module";
import { JUBELIO_WEBHOOK_QUEUE } from "./jubelio-queue.config";
import { WebhookQueueService } from "./webhook-queue.service";
import { WebhookProcessor } from "./webhook-processor.service";
import { JubelioEventRouter } from "./event-router";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { UnhandledEventHandler } from "../handlers/unhandled.handler";

@Module({
  imports: [
    PrismaModule,
    AdminModule,
    BullModule.registerQueue({ name: JUBELIO_WEBHOOK_QUEUE }),
  ],
  providers: [
    WebhookQueueService,
    WebhookProcessor,
    JubelioEventRouter,
    StockWebhookHandler,
    UnhandledEventHandler,
  ],
  exports: [WebhookQueueService],
})
export class JubelioQueueModule {}
```

- [ ] **Step 3: Wire root BullModule in app.module.ts**

Modify `apps/api/src/app.module.ts`. Add the `BullModule.forRootAsync` import and the `JubelioQueueModule` to the imports array. The exact edit depends on current file shape — read it first; the addition pattern is:

```ts
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JubelioQueueModule } from "./jubelio/queue/jubelio-queue.module";

@Module({
  imports: [
    // ...existing imports...
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>("REDIS_URL") ?? "redis://localhost:6379" },
      }),
    }),
    JubelioQueueModule,
  ],
})
export class AppModule {}
```

Concretely: open `apps/api/src/app.module.ts`, add the two imports at the top, insert `BullModule.forRootAsync({...})` and `JubelioQueueModule` into the existing `imports: [...]` array. Leave other entries unchanged.

- [ ] **Step 4: Wire JubelioQueueModule into JubelioModule (so the controller can inject WebhookQueueService)**

Modify `apps/api/src/jubelio/jubelio.module.ts`. Add `JubelioQueueModule` to the imports and re-export it if needed by webhooks. Read current shape; insert as below (adjust the imports array to match existing format):

```ts
import { JubelioQueueModule } from "./queue/jubelio-queue.module";
// existing imports retained

@Module({
  imports: [JubelioQueueModule],
  // providers / controllers / exports retained
})
export class JubelioModule {}
```

If `JubelioModule` currently has no `imports`, add it. If `WebhookQueueService` needs to be injected into `JubelioWebhooksController`, ensure the webhooks module (which holds that controller) imports `JubelioQueueModule` too — see Task 11's controller modification.

- [ ] **Step 5: Type-check + build**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
pnpm -F @elorae/api build 2>&1 | tail -5
```

Expected: both silent success.

- [ ] **Step 6: Run all tests (deferred-verify cleanup)**

```bash
pnpm -F @elorae/api test 2>&1 | tail -15
```

Expected: all green (helper + handler + router + processor specs).

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/src/jubelio/queue/jubelio-queue.module.ts apps/api/src/jubelio/jubelio.module.ts apps/api/src/app.module.ts ../../pnpm-lock.yaml
# pnpm-lock.yaml lives at repo root; adjust path:
git add pnpm-lock.yaml 2>/dev/null
git commit -m "feat(api): wire BullMQ root + jubelio queue module"
```

---

## Task 11: Controller enqueues after persist

**Files:**
- Modify: `apps/api/src/jubelio/webhooks/webhooks.controller.ts`
- Modify: `apps/api/src/jubelio/webhooks/webhooks.module.ts`

- [ ] **Step 1: Read the current controller**

```bash
cat apps/api/src/jubelio/webhooks/webhooks.controller.ts
```

Note the existing handler method name (likely `handleEvent` or similar) and the line where `persist` is awaited.

- [ ] **Step 2: Add `WebhookQueueService` injection + enqueue call**

Modify `apps/api/src/jubelio/webhooks/webhooks.controller.ts`. Add the import:

```ts
import { WebhookQueueService } from "../queue/webhook-queue.service";
```

Add the constructor param (alongside the existing service injection) — example shape, adjust to match the file's current constructor:

```ts
constructor(
  private readonly service: JubelioWebhooksService,
  private readonly queue: WebhookQueueService,
) {}
```

Inside the handler method, immediately after the existing `await this.service.persist(...)` line, add the enqueue call:

```ts
const outcome = await this.service.persist({ event, rawBody, signature, eventId });
if (!outcome.duplicate) {
  await this.queue.enqueue(outcome.id);
}
return { ok: true, id: outcome.id, duplicate: outcome.duplicate };
```

If the persist result is destructured differently, adjust the variable names accordingly. The principle: enqueue when and only when `duplicate === false`.

- [ ] **Step 3: Update webhooks module to import the queue module**

Modify `apps/api/src/jubelio/webhooks/webhooks.module.ts`. Read current shape, add `JubelioQueueModule` to `imports`:

```ts
import { JubelioQueueModule } from "../queue/jubelio-queue.module";

@Module({
  imports: [JubelioQueueModule],
  // controllers / providers retained
})
export class JubelioWebhooksModule {}
```

- [ ] **Step 4: Type-check + build**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
pnpm -F @elorae/api build 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/webhooks/webhooks.controller.ts apps/api/src/jubelio/webhooks/webhooks.module.ts
git commit -m "feat(api): controller enqueues webhook events for processing"
```

---

## Task 12: Local Redis via docker-compose + env doc

**Files:**
- Create: `docker-compose.dev.yml`
- Modify: `apps/api/.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write docker-compose**

Create `docker-compose.dev.yml` at repo root:

```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: elorae-dev-redis
    restart: unless-stopped
    ports: ["6379:6379"]
    volumes: [redis-data:/data]

volumes:
  redis-data:
```

- [ ] **Step 2: Document `REDIS_URL` in apps/api/.env.example**

Modify `apps/api/.env.example`. Add a new env block after the existing `CORS_ORIGINS=` section (or near the bottom of the file):

```bash

# ────────────────────────────────────────────────
# Redis (BullMQ transport for the Jubelio webhook queue)
# ────────────────────────────────────────────────
# Defaults to redis://localhost:6379 if unset.
# Local dev: docker compose -f docker-compose.dev.yml up -d redis
REDIS_URL=redis://localhost:6379
```

- [ ] **Step 3: Add a Redis section to the root README**

Modify `README.md`. After the existing "Prereqs" or "First-time setup" section, add a new short block:

```markdown
## Redis (BullMQ queue for Jubelio webhook processing)

The api needs Redis for the Jubelio webhook queue.

```bash
docker compose -f docker-compose.dev.yml up -d redis
```

`REDIS_URL` defaults to `redis://localhost:6379`. Set it in `apps/api/.env` if you run Redis elsewhere.
```

Insert this between two existing sections — not after the troubleshooting section. Read the README before editing to pick a natural anchor.

- [ ] **Step 4: Smoke-start Redis**

```bash
docker compose -f docker-compose.dev.yml up -d redis
docker ps --filter name=elorae-dev-redis --format "{{.Status}}"
```

Expected: `Up <seconds> seconds`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.dev.yml apps/api/.env.example README.md
git commit -m "build: docker-compose for local Redis + README + env example"
```

---

## Task 13: Apps/web server actions for webhook admin

**Files:**
- Create: `apps/web/app/actions/jubelio-webhooks.ts`

- [ ] **Step 1: Write the server actions**

Create `apps/web/app/actions/jubelio-webhooks.ts`:

```ts
"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";

const STATUSES = ["RECEIVED", "PROCESSING", "PROCESSED", "SKIPPED", "DEAD"] as const;
type Status = (typeof STATUSES)[number];

async function isAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.user?.permissions?.includes("*") ?? false;
}

export type JubelioWebhookFilters = {
  limit?: number;
  offset?: number;
  status?: Status;
  event?: string;
};

export async function getJubelioWebhookEvents(filters: JubelioWebhookFilters = {}) {
  if (!(await isAdmin())) return { events: [], total: 0 };

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const where: any = {};
  if (filters.status) where.status = filters.status;
  if (filters.event) where.event = filters.event;

  const [events, total] = await Promise.all([
    prisma.jubelioWebhookEvent.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.jubelioWebhookEvent.count({ where }),
  ]);

  return { events, total };
}

export async function getJubelioWebhookStats() {
  if (!(await isAdmin())) return null;

  const windowHours = 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const grouped = await prisma.jubelioWebhookEvent.groupBy({
    by: ["status"],
    where: { receivedAt: { gte: since } },
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

export async function retryJubelioWebhookEvent(id: string): Promise<{ ok: boolean }> {
  if (!(await isAdmin())) return { ok: false };

  const row = await prisma.jubelioWebhookEvent.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!row) return { ok: false };
  if (row.status !== "DEAD" && row.status !== "SKIPPED") return { ok: false };

  await prisma.jubelioWebhookEvent.update({
    where: { id },
    data: {
      status: "RECEIVED",
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

Expected: silent success. If `.next/dev/types/validator.ts` reports a stale error, `rm -rf apps/web/.next/dev` and retry — that artifact has bitten before.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/actions/jubelio-webhooks.ts
git commit -m "feat(web): admin server actions for jubelio webhook events"
```

---

## Task 14: Dashboard extension on existing admin page

**Files:**
- Modify: `apps/web/app/backoffice/jubelio/admin/page.tsx`

- [ ] **Step 1: Read the current admin page**

```bash
cat apps/web/app/backoffice/jubelio/admin/page.tsx
```

Note the existing imports, the existing API-calls stats cards section, and where new sections can be appended (typically at the bottom of the page component's JSX, below the existing `<Card>` block).

- [ ] **Step 2: Extend the page**

Modify `apps/web/app/backoffice/jubelio/admin/page.tsx`. Add the following imports alongside the existing ones (don't duplicate the lucide-react block — extend it):

```ts
import {
  getJubelioWebhookEvents,
  getJubelioWebhookStats,
  retryJubelioWebhookEvent,
} from "@/app/actions/jubelio-webhooks";
import { toast } from "sonner";
```

Inside the component (alongside the existing `useState` declarations), add state for webhook data:

```ts
type WebhookCalls = Awaited<ReturnType<typeof getJubelioWebhookEvents>>;
type WebhookRow = WebhookCalls["events"][number];
type WebhookStats = Awaited<ReturnType<typeof getJubelioWebhookStats>>;

const [whEvents, setWhEvents] = useState<WebhookRow[]>([]);
const [whTotal, setWhTotal] = useState(0);
const [whStats, setWhStats] = useState<WebhookStats>(null);
const [whFilter, setWhFilter] = useState<"all" | "errors" | "DEAD">("all");
```

Add a loader callback near the existing `load` (rename existing to `loadApiCalls` if needed, OR add a sibling `loadWebhooks`). For minimal disruption, add a sibling — example:

```ts
const loadWebhooks = useCallback(async () => {
  const statusFilter = whFilter === "DEAD" ? "DEAD" : undefined;
  const [eventsRes, statsRes] = await Promise.all([
    getJubelioWebhookEvents({ limit: 50, offset: 0, status: statusFilter as any }),
    getJubelioWebhookStats(),
  ]);
  let events = eventsRes.events;
  if (whFilter === "errors") {
    events = events.filter((e) => e.status === "DEAD" || e.status === "SKIPPED");
  }
  setWhEvents(events);
  setWhTotal(eventsRes.total);
  setWhStats(statsRes);
}, [whFilter]);
```

Add an effect that calls `loadWebhooks` when authenticated or filter changes:

```ts
useEffect(() => {
  if (status === "authenticated") void loadWebhooks();
}, [status, whFilter, loadWebhooks]);
```

Add a retry handler:

```ts
const handleRetry = async (id: string) => {
  const result = await retryJubelioWebhookEvent(id);
  if (result.ok) {
    toast.success("Re-queued. Sweeper picks up within 10 min.");
    void loadWebhooks();
  } else {
    toast.error("Retry not allowed (status must be DEAD or SKIPPED).");
  }
};
```

Below the existing `<Card>` block for API calls (the one with "Recent calls"), append the webhook UI block:

```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
  {(["RECEIVED", "PROCESSING", "PROCESSED", "SKIPPED", "DEAD"] as const).map((s) => (
    <Card key={s}>
      <CardHeader className="pb-2">
        <CardDescription>{s}</CardDescription>
        <CardTitle className="text-2xl">{whStats?.byStatus?.[s] ?? 0}</CardTitle>
      </CardHeader>
    </Card>
  ))}
</div>

<Card>
  <CardHeader>
    <div className="flex items-center justify-between">
      <div>
        <CardTitle>Webhook events</CardTitle>
        <CardDescription>{whTotal} total entries</CardDescription>
      </div>
      <div className="flex gap-2">
        {(["all", "errors", "DEAD"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={whFilter === f ? "default" : "outline"}
            onClick={() => setWhFilter(f)}
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
            <TableHead>Time</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Attempts</TableHead>
            <TableHead>Flags / reason</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {whEvents.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                No webhook events.
              </TableCell>
            </TableRow>
          ) : (
            whEvents.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {new Date(e.receivedAt).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-xs">{e.event}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      e.status === "DEAD"
                        ? "destructive"
                        : e.status === "SKIPPED"
                          ? "secondary"
                          : "default"
                    }
                  >
                    {e.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">{e.attempts}</TableCell>
                <TableCell className="text-xs">
                  {e.skipReason ?? e.lastError?.slice(0, 60) ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {(e.status === "DEAD" || e.status === "SKIPPED") && (
                    <Button size="sm" variant="outline" onClick={() => void handleRetry(e.id)}>
                      Retry
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 3: Type-check apps/web**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent success. Resolve any unused-var warnings by removing imports you didn't end up using.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/backoffice/jubelio/admin/page.tsx
git commit -m "feat(web): jubelio webhook section on admin dashboard (counts, table, retry)"
```

---

## Task 15: End-to-end manual smoke

No file changes — verification only. Documents the post-merge sanity check.

- [ ] **Step 1: Start Redis**

```bash
docker compose -f docker-compose.dev.yml up -d redis
```

Expected: container `elorae-dev-redis` reports `Up`.

- [ ] **Step 2: Build + start api in prod mode**

```bash
pnpm -F @elorae/api prod 2>&1 | tail -10
```

Expected: api listens on port 3001; log shows `JubelioQueueModule dependencies initialized` and BullMQ connecting to Redis.

- [ ] **Step 3: Start apps/web dev**

In a second terminal:

```bash
pnpm -F @elorae/web dev
```

Expected: serves on port 3000.

- [ ] **Step 4: POST a known-mapped stock webhook**

Pick an existing `jubelioItemCode` from the DB (e.g. `pnpm -F @elorae/db studio` to browse). With the webhook secret in `apps/api/.env`, compute the signature header and POST:

```bash
SECRET="<JUBELIO_WEBHOOK_SECRET>"
BODY='{"item_code":"<KNOWN_SKU>","end_qty":7}'
SIG=$(printf '%s' "$BODY$SECRET" | sha256sum | awk '{print $1}')
curl -s -X POST http://localhost:3001/webhooks/jubelio/stock \
  -H "Content-Type: application/json" \
  -H "webhook-signature: $SIG" \
  -d "$BODY"
```

Expected response: `{"ok":true,"id":"<rowId>","duplicate":false}`.

- [ ] **Step 5: Verify status transitions to PROCESSED**

Open `http://localhost:3000/backoffice/jubelio/admin` (login as admin). Webhook section shows the row first `PROCESSING`, then `PROCESSED` within seconds. `InventoryValue.qtyOnHand` for that SKU now equals 7.

- [ ] **Step 6: Test orphan SKU path**

POST with a SKU not in `JubelioProductMapping`:

```bash
BODY='{"item_code":"DOES-NOT-EXIST","end_qty":1}'
SIG=$(printf '%s' "$BODY$SECRET" | sha256sum | awk '{print $1}')
curl -s -X POST http://localhost:3001/webhooks/jubelio/stock \
  -H "Content-Type: application/json" -H "webhook-signature: $SIG" -d "$BODY"
```

Expected: dashboard row → `SKIPPED` with `orphan_sku:DOES-NOT-EXIST`.

- [ ] **Step 7: Test DEAD path**

POST with a mapped SKU but force `InventoryValue` absence — easiest: pick an `Item` row where no `InventoryValue` exists. The handler throws `InventoryValueMissingError`; that's NOT classed `NonRetryableError` in this plan, so BullMQ retries 5 times before `DEAD` (~80s total). If you want immediate DEAD, change the throw in `applyJubelioStockAdjustment` to use `NonRetryableError` (out of scope of this verification — but a known optional refinement listed in §8 of the spec).

Expected after retries: dashboard row → `DEAD`, AdminNotification row appears in the AdminNotification table.

- [ ] **Step 8: Test retry button**

In the dashboard, click "Retry" on the DEAD row. Status flips to `RECEIVED`. Within 10 minutes the sweeper re-enqueues it (or restart api to trigger an immediate sweep tick).

- [ ] **Step 9: Stop local services**

```bash
# stop api: Ctrl-C in api terminal
# stop web: Ctrl-C in web terminal
docker compose -f docker-compose.dev.yml stop redis
```

- [ ] **Step 10: No commit — verification-only task**

If you want a record of the smoke pass, push the branch:

```bash
git push -u origin feat/jubelio-sync
```

---

## After all tasks

- Branch `feat/jubelio-sync` carries the inbound webhook pipeline.
- Run `pnpm -F @elorae/api test` once more: all suites green.
- Open PR `feat/jubelio-sync → master` when ready for review.
- Next slice: outbound `JubelioOutbox` + push primitives — its own design doc and plan.
