# Jubelio Inbound Webhook Handlers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real handlers for the three currently-SKIPPED Jubelio webhook event types: `salesorder` (decrement stock + cancellation reversal), `salesreturn` (stub until samples land), `product` (re-ingest via catalog sync).

**Architecture:** Three new `apps/api/src/jubelio/handlers/*.handler.ts` files. `salesorder` adds a new `JubelioSalesOrderState` table for "did we decrement?" tracking. Router updated to dispatch the three new event types. All writes through existing `@elorae/db` helpers (no boundary work).

**Tech Stack:** NestJS 11 (handlers, providers), Prisma 7 (state table + idempotency via existing `StockAdjustment.idempotencyKey` unique), jest + ts-jest for unit tests, BullMQ-backed queue from sub-1 (no infra change).

**Spec:** `docs/superpowers/specs/2026-06-10-jubelio-inbound-handlers-design.md`

---

## File Structure

**New files:**

```
packages/db/prisma/migrations/20260610120000_jubelio_salesorder_state/migration.sql

apps/api/src/jubelio/handlers/salesorder.handler.ts
apps/api/src/jubelio/handlers/salesorder.handler.spec.ts
apps/api/src/jubelio/handlers/salesorder.payload.ts             # type defs

apps/api/src/jubelio/handlers/salesreturn.handler.ts            # stub
apps/api/src/jubelio/handlers/salesreturn.handler.spec.ts

apps/api/src/jubelio/handlers/product.handler.ts
apps/api/src/jubelio/handlers/product.handler.spec.ts
apps/api/src/jubelio/handlers/product.payload.ts                # type defs
```

**Modified files:**

```
packages/db/prisma/schema.prisma                                # + JubelioSalesOrderState model

apps/api/src/jubelio/queue/webhook-status.ts                    # + 3 new skip reasons
apps/api/src/jubelio/queue/event-router.ts                      # + 3 new cases
apps/api/src/jubelio/queue/event-router.spec.ts                 # + 3 new routing tests
apps/api/src/jubelio/queue/jubelio-queue.module.ts              # register 3 new providers + JubelioCatalogModule import
```

**Reused (no modification):**

- `@elorae/db` `applyJubelioStockAdjustment` (sub-1) — writes `StockAdjustment` with `source=JUBELIO_WEBHOOK` + idempotencyKey-driven dedupe.
- `JubelioCatalogSyncService.syncCatalog({ itemGroupIds })` (sub-1, sped up by PR #39).
- `AdminNotificationService.write(...)` (sub-1).
- `JubelioEventRouter` switch.
- `JubelioWebhookEvent` (sub-1).
- `JubelioProductMapping` (sub-1, used for lookup by `jubelioItemId`).

---

## Task 1: Schema + migration — `JubelioSalesOrderState`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260610120000_jubelio_salesorder_state/migration.sql`

- [ ] **Step 1: Append model to schema.prisma**

Locate `model JubelioCategoryMapping` block (around line 1178). Append this model right after `JubelioCategoryMapping` (or anywhere in the Jubelio-related block):

```prisma
model JubelioSalesOrderState {
  id                  String    @id @default(cuid())
  salesorderId        Int       @unique
  stockApplied        Boolean   @default(false)
  lastStatus          String?
  lastIsCanceled      Boolean   @default(false)
  appliedAt           DateTime?
  reversedAt          DateTime?
  lastWebhookEventId  String
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@index([lastWebhookEventId])
}
```

- [ ] **Step 2: Author migration SQL manually**

`pnpm prisma migrate dev` is forbidden against TiDB (CLAUDE.md). Create the file by hand:

`packages/db/prisma/migrations/20260610120000_jubelio_salesorder_state/migration.sql`:

```sql
-- CreateTable
CREATE TABLE `JubelioSalesOrderState` (
    `id` VARCHAR(191) NOT NULL,
    `salesorderId` INTEGER NOT NULL,
    `stockApplied` BOOLEAN NOT NULL DEFAULT false,
    `lastStatus` VARCHAR(191) NULL,
    `lastIsCanceled` BOOLEAN NOT NULL DEFAULT false,
    `appliedAt` DATETIME(3) NULL,
    `reversedAt` DATETIME(3) NULL,
    `lastWebhookEventId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `JubelioSalesOrderState_salesorderId_key`(`salesorderId`),
    INDEX `JubelioSalesOrderState_lastWebhookEventId_idx`(`lastWebhookEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- [ ] **Step 3: Regenerate Prisma client + build the package + type-check both apps**

```bash
pnpm -F @elorae/db generate 2>&1 | tail -3
pnpm -F @elorae/db build 2>&1 | tail -3
pnpm -F @elorae/api type-check 2>&1 | tail -3
pnpm -F @elorae/web type-check 2>&1 | tail -3
```

Expected: all silent (per `feedback_db_build` memory, both `generate` AND `build` needed).

- [ ] **Step 4: DO NOT run migrate:deploy yourself**

User runs (per `feedback_service_control`):

```bash
pnpm -F @elorae/db migrate:deploy
```

State the command in your final report.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260610120000_jubelio_salesorder_state/
git commit -m "feat(db): JubelioSalesOrderState table for salesorder webhook idempotency"
```

---

## Task 2: Skip reasons + payload types

**Files:**
- Modify: `apps/api/src/jubelio/queue/webhook-status.ts`
- Create: `apps/api/src/jubelio/handlers/salesorder.payload.ts`
- Create: `apps/api/src/jubelio/handlers/product.payload.ts`

- [ ] **Step 1: Extend `SKIP_REASONS`**

Read the current file. Add three new keys to the existing object literal:

```ts
export const SKIP_REASONS = {
  UNHANDLED_EVENT_TYPE: "unhandled_event_type",
  UNKNOWN_EVENT: "unknown_event",
  ORPHAN_SKU: "orphan_sku",
  AWAITING_SAMPLES: "awaiting_samples",
  MISSING_ITEM_GROUP_ID: "missing_item_group_id",
  MISSING_SALESORDER_ID: "missing_salesorder_id",
} as const;
```

- [ ] **Step 2: Create `salesorder.payload.ts`**

`apps/api/src/jubelio/handlers/salesorder.payload.ts`:

```ts
export type SalesOrderLine = {
  item_id: number;
  item_code: string;
  item_group_id: number;
  item_name?: string;
  qty: string | number;
  is_canceled_item?: boolean | null;
  salesorder_detail_id: number;
};

export type SalesOrderPayload = {
  action?: string;
  salesorder_id: number;
  salesorder_no?: string;
  channel_status?: string;
  internal_status?: string;
  is_canceled?: boolean | null;
  items?: SalesOrderLine[];
};
```

- [ ] **Step 3: Create `product.payload.ts`**

`apps/api/src/jubelio/handlers/product.payload.ts`:

```ts
export type ProductWebhookPayload = {
  action?: string;
  item_group_id: number;
  item_group_name?: string;
};
```

- [ ] **Step 4: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -3
```

Expected: silent.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/queue/webhook-status.ts apps/api/src/jubelio/handlers/salesorder.payload.ts apps/api/src/jubelio/handlers/product.payload.ts
git commit -m "feat(api): skip reasons + payload types for sub-4 inbound handlers"
```

---

## Task 3: `SalesOrderWebhookHandler` + 9 TDD tests

**Files:**
- Create: `apps/api/src/jubelio/handlers/salesorder.handler.spec.ts`
- Create: `apps/api/src/jubelio/handlers/salesorder.handler.ts`

- [ ] **Step 1: Write the failing spec**

`apps/api/src/jubelio/handlers/salesorder.handler.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { SalesOrderWebhookHandler } from "./salesorder.handler";
import { PRISMA } from "../../db/prisma.module";
import { AdminNotificationService } from "../../admin/notification.service";
import * as db from "@elorae/db";

jest.mock("@elorae/db", () => ({
  ...jest.requireActual("@elorae/db"),
  applyJubelioStockAdjustment: jest.fn(),
}));

const applyMock = (db as any).applyJubelioStockAdjustment as jest.Mock;

function row(payload: any, overrides: any = {}) {
  return {
    id: "wh_1",
    event: "salesorder",
    eventId: null,
    signature: "sig",
    payloadHash: "hash",
    rawPayload: payload,
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    processedAt: null,
    ...overrides,
  };
}

function makePayload(overrides: any = {}) {
  return {
    action: "update-salesorder",
    salesorder_id: 23043,
    salesorder_no: "SO-23043",
    channel_status: "READY_TO_SHIP",
    internal_status: "PROCESSING",
    is_canceled: false,
    items: [
      { item_id: 1721, item_code: "SKU-A", item_group_id: 96, qty: "1.0000", salesorder_detail_id: 25193, is_canceled_item: null },
      { item_id: 1688, item_code: "SKU-B", item_group_id: 96, qty: "2.0000", salesorder_detail_id: 25194, is_canceled_item: null },
    ],
    ...overrides,
  };
}

describe("SalesOrderWebhookHandler", () => {
  let handler: SalesOrderWebhookHandler;
  let prisma: any;
  let admin: { write: jest.Mock };

  beforeEach(async () => {
    applyMock.mockReset();
    prisma = {
      jubelioSalesOrderState: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      jubelioProductMapping: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    admin = { write: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        SalesOrderWebhookHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: AdminNotificationService, useValue: admin },
      ],
    }).compile();
    handler = mod.get(SalesOrderWebhookHandler);
  });

  it("SKIPs missing_salesorder_id when payload lacks salesorder_id", async () => {
    const r = await handler.handle(row({ items: [] }) as any);
    expect(r).toEqual({ kind: "skipped", reason: "missing_salesorder_id" });
  });

  it("first webhook active state, all lines mapped -> decrements + state created", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: false, lastStatus: null, lastIsCanceled: false,
      appliedAt: null, reversedAt: null, lastWebhookEventId: "wh_1",
    });
    prisma.jubelioProductMapping.findFirst
      .mockResolvedValueOnce({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 })
      .mockResolvedValueOnce({ itemId: "i_b", erpVariantSku: "SKU-B", jubelioItemId: 1688 });
    applyMock.mockResolvedValue({});

    const r = await handler.handle(row(makePayload()) as any);

    expect(applyMock).toHaveBeenCalledTimes(2);
    expect(applyMock).toHaveBeenNthCalledWith(1, prisma, expect.objectContaining({
      itemId: "i_a",
      variantSku: "SKU-A",
      idempotencyKey: "salesorder-23043-decrement-line-25193",
    }));
    expect(prisma.jubelioSalesOrderState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stockApplied: true, lastIsCanceled: false }),
    }));
    expect(admin.write).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "processed" });
  });

  it("first webhook with is_canceled=true -> no decrement, state created with stockApplied=false", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: false,
    });

    const r = await handler.handle(row(makePayload({ is_canceled: true })) as any);

    expect(applyMock).not.toHaveBeenCalled();
    expect(prisma.jubelioSalesOrderState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastIsCanceled: true }),
    }));
    expect(r).toEqual({ kind: "processed" });
  });

  it("second webhook still active -> no transition (state.stockApplied already true)", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: true,
    });

    const r = await handler.handle(row(makePayload()) as any);

    expect(applyMock).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "processed" });
  });

  it("cancellation after decrement -> reversal applied, state.stockApplied=false", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: true,
    });
    prisma.jubelioProductMapping.findFirst
      .mockResolvedValueOnce({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 })
      .mockResolvedValueOnce({ itemId: "i_b", erpVariantSku: "SKU-B", jubelioItemId: 1688 });
    applyMock.mockResolvedValue({});

    const r = await handler.handle(row(makePayload({ is_canceled: true })) as any);

    expect(applyMock).toHaveBeenCalledTimes(2);
    expect(applyMock).toHaveBeenNthCalledWith(1, prisma, expect.objectContaining({
      idempotencyKey: "salesorder-23043-reversal-line-25193",
    }));
    expect(prisma.jubelioSalesOrderState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stockApplied: false, reversedAt: expect.any(Date) }),
    }));
    expect(r).toEqual({ kind: "processed" });
  });

  it("un-cancel after reversal -> re-decrement, state.stockApplied=true again", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue({
      id: "st1", salesorderId: 23043, stockApplied: false,
    });
    prisma.jubelioProductMapping.findFirst
      .mockResolvedValueOnce({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 })
      .mockResolvedValueOnce({ itemId: "i_b", erpVariantSku: "SKU-B", jubelioItemId: 1688 });
    applyMock.mockResolvedValue({});

    const r = await handler.handle(row(makePayload()) as any);

    expect(applyMock).toHaveBeenCalledTimes(2);
    expect(applyMock).toHaveBeenNthCalledWith(1, prisma, expect.objectContaining({
      idempotencyKey: "salesorder-23043-decrement-line-25193",
    }));
    expect(prisma.jubelioSalesOrderState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stockApplied: true }),
    }));
    expect(r).toEqual({ kind: "processed" });
  });

  it("unmapped item_id -> AdminNotification fired, mapped lines still processed", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: false });
    prisma.jubelioProductMapping.findFirst
      .mockResolvedValueOnce({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 })
      .mockResolvedValueOnce(null);  // SKU-B unmapped
    applyMock.mockResolvedValue({});

    await handler.handle(row(makePayload()) as any);

    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(admin.write).toHaveBeenCalledTimes(1);
    expect(admin.write).toHaveBeenCalledWith(expect.objectContaining({
      category: "JUBELIO_UNMAPPED_LINES",
      metadata: expect.objectContaining({
        salesorderId: 23043,
        lines: expect.arrayContaining([expect.objectContaining({ item_code: "SKU-B", item_id: 1688 })]),
      }),
    }));
  });

  it("line with is_canceled_item=true is skipped, other lines processed", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: false });
    prisma.jubelioProductMapping.findFirst.mockResolvedValueOnce({ itemId: "i_a", erpVariantSku: "SKU-A", jubelioItemId: 1721 });
    applyMock.mockResolvedValue({});
    const payload = makePayload();
    payload.items[1].is_canceled_item = true;

    await handler.handle(row(payload) as any);

    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(prisma.jubelioProductMapping.findFirst).toHaveBeenCalledTimes(1);
  });

  it("all lines unmapped -> one AdminNotification, no stock writes, state still updates", async () => {
    prisma.jubelioSalesOrderState.findUnique.mockResolvedValue(null);
    prisma.jubelioSalesOrderState.create.mockResolvedValue({ id: "st1", salesorderId: 23043, stockApplied: false });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);

    await handler.handle(row(makePayload()) as any);

    expect(applyMock).not.toHaveBeenCalled();
    expect(admin.write).toHaveBeenCalledTimes(1);
    expect(prisma.jubelioSalesOrderState.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @elorae/api test -- salesorder.handler.spec.ts --runInBand 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './salesorder.handler'".

- [ ] **Step 3: Implement the handler**

`apps/api/src/jubelio/handlers/salesorder.handler.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { applyJubelioStockAdjustment } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { AdminNotificationService } from "../../admin/notification.service";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";
import type { SalesOrderLine, SalesOrderPayload } from "./salesorder.payload";

type UnmappedLine = { item_code: string; item_id: number; qty: string | number };

@Injectable()
export class SalesOrderWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(SalesOrderWebhookHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly admin: AdminNotificationService,
  ) {}

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    const p = row.rawPayload as unknown as SalesOrderPayload;
    if (!p?.salesorder_id) {
      return { kind: "skipped", reason: SKIP_REASONS.MISSING_SALESORDER_ID };
    }

    const state = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.jubelioSalesOrderState.findUnique({
        where: { salesorderId: p.salesorder_id },
      });
      if (existing) return existing;
      return tx.jubelioSalesOrderState.create({
        data: {
          salesorderId: p.salesorder_id,
          stockApplied: false,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: !!p.is_canceled,
          lastWebhookEventId: row.id,
        },
      });
    });

    const shouldApply = !p.is_canceled;
    const items = Array.isArray(p.items) ? p.items : [];

    if (shouldApply && !state.stockApplied) {
      const unmapped = await this.applyAdjustments(items, p.salesorder_id, p.salesorder_no ?? "", -1);
      if (unmapped.length > 0) {
        await this.notifyUnmappedLines(p.salesorder_id, p.salesorder_no ?? "", unmapped);
      }
      await this.prisma.jubelioSalesOrderState.update({
        where: { id: state.id },
        data: {
          stockApplied: true,
          appliedAt: new Date(),
          lastWebhookEventId: row.id,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: false,
        },
      });
    } else if (!shouldApply && state.stockApplied) {
      await this.applyAdjustments(items, p.salesorder_id, p.salesorder_no ?? "", +1);
      await this.prisma.jubelioSalesOrderState.update({
        where: { id: state.id },
        data: {
          stockApplied: false,
          reversedAt: new Date(),
          lastWebhookEventId: row.id,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: true,
        },
      });
    } else {
      await this.prisma.jubelioSalesOrderState.update({
        where: { id: state.id },
        data: {
          lastWebhookEventId: row.id,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: !!p.is_canceled,
        },
      });
    }

    return { kind: "processed" };
  }

  private async applyAdjustments(
    items: SalesOrderLine[],
    salesorderId: number,
    salesorderNo: string,
    sign: 1 | -1,
  ): Promise<UnmappedLine[]> {
    const unmapped: UnmappedLine[] = [];
    const direction = sign === -1 ? "decrement" : "reversal";

    for (const line of items) {
      if (line.is_canceled_item) continue;

      const mapping = await this.prisma.jubelioProductMapping.findFirst({
        where: { jubelioItemId: line.item_id },
      });
      if (!mapping) {
        unmapped.push({ item_code: line.item_code, item_id: line.item_id, qty: line.qty });
        continue;
      }

      const inv = await this.prisma.inventoryValue.findUnique({
        where: { itemId_variantSku: { itemId: mapping.itemId, variantSku: mapping.erpVariantSku } },
      });
      const currentQty = inv ? Number(inv.qtyOnHand) : 0;
      const newQty = currentQty + sign * Number(line.qty);

      try {
        await applyJubelioStockAdjustment(this.prisma, {
          itemId: mapping.itemId,
          variantSku: mapping.erpVariantSku,
          newQty,
          idempotencyKey: `salesorder-${salesorderId}-${direction}-line-${line.salesorder_detail_id}`,
          externalRef: `salesorder:${salesorderId}`,
          reason: `Jubelio salesorder ${salesorderNo} ${direction}`,
        });
      } catch (err) {
        this.logger.warn(
          `Stock adjustment failed for salesorder ${salesorderId} line ${line.salesorder_detail_id}: ${(err as Error).message}`,
        );
        unmapped.push({ item_code: line.item_code, item_id: line.item_id, qty: line.qty });
      }
    }
    return unmapped;
  }

  private async notifyUnmappedLines(
    salesorderId: number,
    salesorderNo: string,
    lines: UnmappedLine[],
  ): Promise<void> {
    await this.admin.write({
      category: "JUBELIO_UNMAPPED_LINES",
      severity: "WARN",
      title: `Salesorder ${salesorderNo || salesorderId}: ${lines.length} unmapped line(s)`,
      message: `Lines without JubelioProductMapping. Stock NOT decremented for these.`,
      metadata: { salesorderId, lines },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -F @elorae/api test -- salesorder.handler.spec.ts --runInBand 2>&1 | tail -10
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/handlers/salesorder.handler.ts apps/api/src/jubelio/handlers/salesorder.handler.spec.ts
git commit -m "feat(api): salesorder webhook handler with cancel-reversal + unmapped-line warnings"
```

---

## Task 4: `SalesReturnWebhookHandler` (stub) + test

**Files:**
- Create: `apps/api/src/jubelio/handlers/salesreturn.handler.spec.ts`
- Create: `apps/api/src/jubelio/handlers/salesreturn.handler.ts`

- [ ] **Step 1: Write the failing spec**

`apps/api/src/jubelio/handlers/salesreturn.handler.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { SalesReturnWebhookHandler } from "./salesreturn.handler";

describe("SalesReturnWebhookHandler", () => {
  let handler: SalesReturnWebhookHandler;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [SalesReturnWebhookHandler],
    }).compile();
    handler = mod.get(SalesReturnWebhookHandler);
  });

  it("returns SKIPPED with awaiting_samples reason", async () => {
    const r = await handler.handle({
      id: "wh_1",
      event: "salesreturn",
      eventId: null,
      signature: "",
      payloadHash: "",
      rawPayload: {},
      status: "PROCESSING",
      attempts: 1,
      lastError: null,
      receivedAt: new Date(),
      processedAt: null,
    } as any);
    expect(r).toEqual({ kind: "skipped", reason: "awaiting_samples" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @elorae/api test -- salesreturn.handler.spec.ts --runInBand 2>&1 | tail -10
```

Expected: FAIL "Cannot find module './salesreturn.handler'".

- [ ] **Step 3: Implement the stub**

`apps/api/src/jubelio/handlers/salesreturn.handler.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";

@Injectable()
export class SalesReturnWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(SalesReturnWebhookHandler.name);

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    // Stub: Jubelio has not sent a real return webhook yet. Real logic lands in a
    // follow-up commit once a sample payload is captured. See sub-4 spec §5.2.
    this.logger.log(`Salesreturn received (id=${row.id}) — awaiting payload sample`);
    return { kind: "skipped", reason: SKIP_REASONS.AWAITING_SAMPLES };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @elorae/api test -- salesreturn.handler.spec.ts --runInBand 2>&1 | tail -10
```

Expected: 1 test pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/handlers/salesreturn.handler.ts apps/api/src/jubelio/handlers/salesreturn.handler.spec.ts
git commit -m "feat(api): salesreturn webhook handler stub (awaiting samples)"
```

---

## Task 5: `ProductWebhookHandler` + tests

**Files:**
- Create: `apps/api/src/jubelio/handlers/product.handler.spec.ts`
- Create: `apps/api/src/jubelio/handlers/product.handler.ts`

- [ ] **Step 1: Write the failing spec**

`apps/api/src/jubelio/handlers/product.handler.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { ProductWebhookHandler } from "./product.handler";
import { JubelioCatalogSyncService } from "../catalog/catalog-sync.service";

function row(payload: any) {
  return {
    id: "wh_1",
    event: "product",
    eventId: null,
    signature: "",
    payloadHash: "",
    rawPayload: payload,
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    processedAt: null,
  };
}

describe("ProductWebhookHandler", () => {
  let handler: ProductWebhookHandler;
  let sync: { syncCatalog: jest.Mock };

  beforeEach(async () => {
    sync = { syncCatalog: jest.fn().mockResolvedValue({ dryRun: false, summary: { created: 0, updated: 1, skipped: 0, errors: 0, warnings: [] }, items: [], errors: [] }) };
    const mod = await Test.createTestingModule({
      providers: [
        ProductWebhookHandler,
        { provide: JubelioCatalogSyncService, useValue: sync },
      ],
    }).compile();
    handler = mod.get(ProductWebhookHandler);
  });

  it("calls syncCatalog with the payload's item_group_id", async () => {
    const r = await handler.handle(row({ action: "update-product", item_group_id: 116, item_group_name: "X" }) as any);
    expect(sync.syncCatalog).toHaveBeenCalledWith({ itemGroupIds: [116] });
    expect(r).toEqual({ kind: "processed" });
  });

  it("SKIPs missing_item_group_id when payload lacks item_group_id", async () => {
    const r = await handler.handle(row({ action: "update-product" }) as any);
    expect(sync.syncCatalog).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "skipped", reason: "missing_item_group_id" });
  });

  it("propagates syncCatalog errors (BullMQ retry handles it)", async () => {
    sync.syncCatalog.mockRejectedValueOnce(new Error("Jubelio 503"));
    await expect(handler.handle(row({ item_group_id: 99 }) as any)).rejects.toThrow("Jubelio 503");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @elorae/api test -- product.handler.spec.ts --runInBand 2>&1 | tail -10
```

Expected: FAIL "Cannot find module './product.handler'".

- [ ] **Step 3: Implement the handler**

`apps/api/src/jubelio/handlers/product.handler.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { JubelioCatalogSyncService } from "../catalog/catalog-sync.service";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";
import type { ProductWebhookPayload } from "./product.payload";

@Injectable()
export class ProductWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(ProductWebhookHandler.name);

  constructor(private readonly catalogSync: JubelioCatalogSyncService) {}

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    const p = row.rawPayload as unknown as ProductWebhookPayload;
    if (!p?.item_group_id) {
      return { kind: "skipped", reason: SKIP_REASONS.MISSING_ITEM_GROUP_ID };
    }
    await this.catalogSync.syncCatalog({ itemGroupIds: [p.item_group_id] });
    this.logger.log(`Re-ingested item_group_id=${p.item_group_id}`);
    return { kind: "processed" };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm -F @elorae/api test -- product.handler.spec.ts --runInBand 2>&1 | tail -10
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/handlers/product.handler.ts apps/api/src/jubelio/handlers/product.handler.spec.ts
git commit -m "feat(api): product webhook handler triggers single-group catalog re-ingest"
```

---

## Task 6: Wire router + module + update router spec

**Files:**
- Modify: `apps/api/src/jubelio/queue/event-router.ts`
- Modify: `apps/api/src/jubelio/queue/event-router.spec.ts`
- Modify: `apps/api/src/jubelio/queue/jubelio-queue.module.ts`

- [ ] **Step 1: Update the router**

Replace `apps/api/src/jubelio/queue/event-router.ts` contents:

```ts
import { Injectable } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { SalesOrderWebhookHandler } from "../handlers/salesorder.handler";
import { SalesReturnWebhookHandler } from "../handlers/salesreturn.handler";
import { ProductWebhookHandler } from "../handlers/product.handler";
import { UnhandledEventHandler } from "../handlers/unhandled.handler";
import type { HandlerOutcome } from "../handlers/handler.types";
import { SKIP_REASONS } from "./webhook-status";

@Injectable()
export class JubelioEventRouter {
  constructor(
    private readonly stockHandler: StockWebhookHandler,
    private readonly salesOrderHandler: SalesOrderWebhookHandler,
    private readonly salesReturnHandler: SalesReturnWebhookHandler,
    private readonly productHandler: ProductWebhookHandler,
    private readonly unhandled: UnhandledEventHandler,
  ) {}

  async route(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    switch (row.event) {
      case "stock":
        return this.stockHandler.handle(row);
      case "salesorder":
        return this.salesOrderHandler.handle(row);
      case "salesreturn":
        return this.salesReturnHandler.handle(row);
      case "product":
        return this.productHandler.handle(row);
      default:
        return { kind: "skipped", reason: `${SKIP_REASONS.UNKNOWN_EVENT}:${row.event}` };
    }
  }
}
```

(The previous `KNOWN_UNHANDLED` set + `UnhandledEventHandler` call is dropped — all three former-unhandled events now have real handlers.)

- [ ] **Step 2: Update the router spec**

Read the existing `apps/api/src/jubelio/queue/event-router.spec.ts`. Add the three new handler mocks to `providers: []` in the `Test.createTestingModule(...)` setup and add three new routing test cases:

```ts
it("routes salesorder to SalesOrderWebhookHandler", async () => {
  salesOrderHandler.handle.mockResolvedValue({ kind: "processed" });
  const result = await router.route({ event: "salesorder" } as any);
  expect(salesOrderHandler.handle).toHaveBeenCalled();
  expect(result).toEqual({ kind: "processed" });
});

it("routes salesreturn to SalesReturnWebhookHandler", async () => {
  salesReturnHandler.handle.mockResolvedValue({ kind: "skipped", reason: "awaiting_samples" });
  const result = await router.route({ event: "salesreturn" } as any);
  expect(salesReturnHandler.handle).toHaveBeenCalled();
  expect(result.kind).toBe("skipped");
});

it("routes product to ProductWebhookHandler", async () => {
  productHandler.handle.mockResolvedValue({ kind: "processed" });
  const result = await router.route({ event: "product" } as any);
  expect(productHandler.handle).toHaveBeenCalled();
  expect(result).toEqual({ kind: "processed" });
});
```

Setup needs the three new mocks alongside `stockHandler` and `unhandled` — match the file's existing pattern. Likely structure:

```ts
let salesOrderHandler: { handle: jest.Mock };
let salesReturnHandler: { handle: jest.Mock };
let productHandler: { handle: jest.Mock };

beforeEach(async () => {
  stockHandler = { handle: jest.fn() };
  salesOrderHandler = { handle: jest.fn() };
  salesReturnHandler = { handle: jest.fn() };
  productHandler = { handle: jest.fn() };
  unhandled = { handle: jest.fn() };
  const mod = await Test.createTestingModule({
    providers: [
      JubelioEventRouter,
      { provide: StockWebhookHandler, useValue: stockHandler },
      { provide: SalesOrderWebhookHandler, useValue: salesOrderHandler },
      { provide: SalesReturnWebhookHandler, useValue: salesReturnHandler },
      { provide: ProductWebhookHandler, useValue: productHandler },
      { provide: UnhandledEventHandler, useValue: unhandled },
    ],
  }).compile();
  router = mod.get(JubelioEventRouter);
});
```

Drop any test that asserts the old `KNOWN_UNHANDLED` skip path for salesorder/salesreturn/product (those events now route to real handlers).

- [ ] **Step 3: Update the queue module**

Edit `apps/api/src/jubelio/queue/jubelio-queue.module.ts`. Add three imports + three providers + import `JubelioCatalogModule` (product handler depends on `JubelioCatalogSyncService`):

```ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AdminModule } from "../../admin/admin.module";
import { PrismaModule } from "../../db/prisma.module";
import { JubelioCatalogModule } from "../catalog/catalog.module";
import { JUBELIO_WEBHOOK_QUEUE } from "./jubelio-queue.config";
import { WebhookQueueService } from "./webhook-queue.service";
import { WebhookProcessor } from "./webhook-processor.service";
import { JubelioEventRouter } from "./event-router";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { SalesOrderWebhookHandler } from "../handlers/salesorder.handler";
import { SalesReturnWebhookHandler } from "../handlers/salesreturn.handler";
import { ProductWebhookHandler } from "../handlers/product.handler";
import { UnhandledEventHandler } from "../handlers/unhandled.handler";

@Module({
  imports: [
    PrismaModule,
    AdminModule,
    JubelioCatalogModule,
    BullModule.registerQueue({ name: JUBELIO_WEBHOOK_QUEUE }),
  ],
  providers: [
    WebhookQueueService,
    WebhookProcessor,
    JubelioEventRouter,
    StockWebhookHandler,
    SalesOrderWebhookHandler,
    SalesReturnWebhookHandler,
    ProductWebhookHandler,
    UnhandledEventHandler,
  ],
  exports: [WebhookQueueService],
})
export class JubelioQueueModule {}
```

- [ ] **Step 4: Type-check + targeted tests**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -3
pnpm -F @elorae/api test -- event-router.spec.ts --runInBand 2>&1 | tail -10
```

Expected: type-check silent. Router spec ≥4 tests passing (1 existing for stock + 3 new).

- [ ] **Step 5: Run the full handler suite (lightweight)**

```bash
pnpm -F @elorae/api test -- handlers --runInBand 2>&1 | tail -15
```

Expected: salesorder (9) + salesreturn (1) + product (3) + stock (existing, unchanged) all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/jubelio/queue/event-router.ts apps/api/src/jubelio/queue/event-router.spec.ts apps/api/src/jubelio/queue/jubelio-queue.module.ts
git commit -m "feat(api): route salesorder + salesreturn + product webhook events"
```

---

## Task 7: Manual smoke (user-driven, deferred until client greenlight)

No file changes. Per spec §8 and `feedback_prod_test_rollback`, smoke against the production Jubelio account requires admin acknowledgement that test orders can be cleaned up.

- [ ] **Step 1: Wait for client greenlight**

User confirms they are OK with placing real test orders + cleaning them up on the Jubelio admin UI.

- [ ] **Step 2: Start services**

User runs (per `feedback_service_control`):

```bash
docker start elorae-dev-redis
pnpm prod:api
# new terminal:
pnpm -F @elorae/web dev
# new terminal (for ngrok):
ngrok http --url unclean-noncalumniating-cory.ngrok-free.dev 3001
```

Boot log should show `SalesOrderWebhookHandler dependencies initialized`, `SalesReturnWebhookHandler dependencies initialized`, `ProductWebhookHandler dependencies initialized`.

- [ ] **Step 3: Place a test order on a Jubelio storefront**

Small qty (1-2 units) on a recognizable test SKU (e.g. TEST-PUSH-* SKUs from sub-3, or any mapped Elorae item). Use COD if possible (avoids real payment).

- [ ] **Step 4: Verify decrement landed**

Wait ~5s for webhook → check outbox/webhook dashboard at `http://localhost:3000/backoffice/jubelio/admin`. Then verify DB:

```bash
set -a && source apps/web/.env && set +a && pnpm -F @elorae/db exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const states = await prisma.jubelioSalesOrderState.findMany({ orderBy: { createdAt: 'desc' }, take: 3 });
  console.log('JubelioSalesOrderState:', states);
  const adjustments = await prisma.stockAdjustment.findMany({ where: { source: 'JUBELIO_WEBHOOK' }, orderBy: { createdAt: 'desc' }, take: 5 });
  console.log('Recent JUBELIO_WEBHOOK adjustments:', adjustments.map(a => ({ docNumber: a.docNumber, itemId: a.itemId, variantSku: a.variantSku, qty: a.qty, idempotencyKey: a.idempotencyKey })));
  await prisma.\$disconnect();
})();
" 2>&1 | tail -20
```

Expected: 1 new `JubelioSalesOrderState` row with `stockApplied=true`. N `StockAdjustment` rows (one per non-canceled mapped line) with `idempotencyKey` matching the `salesorder-{id}-decrement-line-{detail}` pattern.

- [ ] **Step 5: Cancel the test order on Jubelio admin**

Open Jubelio admin → find the test order → cancel. Wait ~5s for the cancellation webhook.

Verify the state flipped + reversal applied:

```bash
set -a && source apps/web/.env && set +a && pnpm -F @elorae/db exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const state = await prisma.jubelioSalesOrderState.findFirst({ orderBy: { updatedAt: 'desc' } });
  console.log('latest state:', state);
  const reversals = await prisma.stockAdjustment.findMany({ where: { idempotencyKey: { contains: 'reversal' } }, orderBy: { createdAt: 'desc' }, take: 5 });
  console.log('reversal adjustments:', reversals.map(a => ({ docNumber: a.docNumber, idempotencyKey: a.idempotencyKey, qty: a.qty })));
  await prisma.\$disconnect();
})();
" 2>&1 | tail -10
```

Expected: state.stockApplied=false, reversedAt set. N reversal `StockAdjustment` rows with positive qty.

- [ ] **Step 6: Trigger a product webhook**

On Jubelio admin, edit any product (e.g. change description) → save. Wait ~5s. Verify the local Item updated:

```bash
set -a && source apps/web/.env && set +a && pnpm -F @elorae/db exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const m = await prisma.jubelioProductMapping.findFirst({ where: { jubelioItemGroupId: <pick a group_id> }, include: { item: true } });
  console.log('item description:', m?.item.description);
  console.log('updatedAt:', m?.item.updatedAt);
  await prisma.\$disconnect();
})();
" 2>&1 | tail -5
```

Expected: `updatedAt` recent (within last 30 seconds), description matches Jubelio.

- [ ] **Step 7: Unmapped-line scenario (optional)**

Place an order that includes an item that does NOT have a `JubelioProductMapping`. Verify an `AdminNotification` row with `category=JUBELIO_UNMAPPED_LINES` was created, while mapped lines still got their `StockAdjustment` rows.

- [ ] **Step 8: Stop services**

```bash
# Ctrl-C in api + web + ngrok terminals
docker stop elorae-dev-redis
```

- [ ] **Step 9: Push branch + open PR**

```bash
git push -u origin feat/jubelio-inbound-handlers
gh pr create --base master --head feat/jubelio-inbound-handlers --title "feat: sub-4 Jubelio inbound webhook handlers (salesorder + salesreturn stub + product)" --body "..."
```

PR body should reference the spec, list shipped handlers, note the salesreturn deferral, and call out the smoke results.

---

## After all tasks

- Branch `feat/jubelio-inbound-handlers` carries: schema + migration, 3 new handlers + tests, router/module wiring, payload types, skip reasons.
- Full api test suite: existing + ~13 new tests across the three handlers + 3 new router cases ≈ 16 net new tests.
- EPIC-01-02 is fully covered (excluding salesreturn until samples arrive).
- Next slice: sub-5 (bulk migration tool) — now unblocked since sub-3 product push + sub-3.5 category sync are live.

## Self-Review checklist (already run; documenting)

- **Spec coverage:**
  - §3 architecture → Task 6 router/module wiring.
  - §4 schema → Task 1.
  - §5.1 salesorder → Task 3.
  - §5.2 salesreturn stub → Task 4.
  - §5.3 product → Task 5.
  - §6 boundary respect → preserved (api owns all new writes; existing helpers used).
  - §7 error handling → handler-level try/catch + AdminNotification (Task 3).
  - §8 testing → Tasks 3, 4, 5, 6 cover unit; Task 7 covers manual smoke.
  - §9 open questions resolved during impl (grouping per-order is in Task 3 code; transaction scope is just the state CAS).
  - §10 decisions → all implemented.
- **No placeholders:** every code-changing step has complete code. PR body in Task 7 Step 9 left as `"..."` — that's a fill-during-execution step (user composes), not a placeholder for missing logic.
- **Type consistency:** `SalesOrderPayload`, `SalesOrderLine`, `ProductWebhookPayload`, `SalesOrderWebhookHandler`, `SalesReturnWebhookHandler`, `ProductWebhookHandler`, `JubelioSalesOrderState`, `SKIP_REASONS.*` consistent across tasks.
