# Fulfillment Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the backend foundation for Pick → Pack → Ship: schema additions, state machine + writer helper, three outbox push handlers. No UI, no live Jubelio test.

**Architecture:** New `fulfillmentStatus` enum + 8 audit columns on `SalesOrder`. Web-writes go through a single helper in `@elorae/db/sales-order-fulfillment-writer` that enforces transitions and enqueues a `JubelioOutbox` row in the same transaction. Three new outbox handlers in `apps/api` route the rows to the matching Jubelio WMS endpoint, reusing the existing `JubelioHttpService` + retry policy. AWB capture path is unchanged — Jubelio's existing salesorder webhook delivers it asynchronously to sub-A's handler.

**Tech Stack:** Prisma 7 (MariaDB/TiDB), NestJS 11, vitest (apps/web tests for the writer helper), Jest (apps/api handler tests), TypeScript. No frontend.

**Spec:** `docs/superpowers/specs/2026-06-14-fulfillment-backend-design.md`

---

## File Structure

**New files:**

```
packages/db/prisma/migrations/20260614120000_add_fulfillment_columns/migration.sql
packages/db/src/sales-order-fulfillment-writer.ts

apps/api/src/jubelio/outbox/handlers/salesorder-pick.handler.ts
apps/api/src/jubelio/outbox/handlers/salesorder-pick.handler.spec.ts
apps/api/src/jubelio/outbox/handlers/salesorder-pack.handler.ts
apps/api/src/jubelio/outbox/handlers/salesorder-pack.handler.spec.ts
apps/api/src/jubelio/outbox/handlers/salesorder-ship.handler.ts
apps/api/src/jubelio/outbox/handlers/salesorder-ship.handler.spec.ts

apps/web/lib/sales-orders/fulfillment-writer.test.ts                # vitest for the writer (writer file lives in @elorae/db; tests live here for runner availability)
```

**Modified files:**

```
packages/db/prisma/schema.prisma                         # + enum + 8 columns + index on fulfillmentStatus
packages/db/package.json                                 # + ./sales-order-fulfillment-writer subpath export
apps/api/src/jubelio/outbox/outbox-router.ts             # + route 3 new entityTypes
apps/api/src/jubelio/outbox/outbox-status.ts             # + JUBELIO_ALREADY_IN_STATE skip reason
apps/api/src/jubelio/outbox/jubelio-outbox.module.ts     # + register 3 new handlers
docs/BOUNDARY.md                                         # + §3.2 dual-ownership column matrix
```

**Reused (no modification):**

- `apps/api/src/jubelio/http.service.ts` — `JubelioHttpService.post()`.
- `apps/api/src/jubelio/outbox/handlers/handler.types.ts` — `OutboxHandler` interface + `HandlerOutcome`.
- `apps/api/src/admin/notification.service.ts` — admin alert when handler goes DEAD.
- `apps/api/src/db/prisma.module.ts` — `PRISMA` token + `PrismaService` type.

---

## Task 1: Schema additions + migration

Add the `SalesOrderFulfillmentStatus` enum, 8 new audit/state columns on `SalesOrder`, and an index on `fulfillmentStatus`. Hand-author the migration SQL. The user runs `migrate:deploy` against the shared TiDB.

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260614120000_add_fulfillment_columns/migration.sql`

- [ ] **Step 1: Add the enum below `SalesOrderStatus` in `schema.prisma`**

Locate the `SalesOrderStatus` enum (around line 875). Directly below it, add:

```prisma
enum SalesOrderFulfillmentStatus {
  PENDING
  PICKED
  PACKED
  SHIPPED
}
```

- [ ] **Step 2: Add 8 columns + index to `SalesOrder` model**

Locate the `SalesOrder` model (around line 1281). Find the existing `lastWebhookEventId` line. Add these new fields immediately after `lastWebhookEventId` (before `createdAt`):

```prisma
  fulfillmentStatus   SalesOrderFulfillmentStatus @default(PENDING)
  pickedAt            DateTime?
  pickedById          String?
  packedAt            DateTime?
  packedById          String?
  shippedAt           DateTime?
  shippedById         String?
  shipmentJubelioId   Int?
  courierId           Int?
```

Then locate the `@@index` block at the end of the `SalesOrder` model. Append:

```prisma
  @@index([fulfillmentStatus])
```

- [ ] **Step 3: Hand-author the migration SQL**

```bash
mkdir -p packages/db/prisma/migrations/20260614120000_add_fulfillment_columns
```

Create `packages/db/prisma/migrations/20260614120000_add_fulfillment_columns/migration.sql`:

```sql
-- AlterTable
ALTER TABLE `SalesOrder`
    ADD COLUMN `fulfillmentStatus` ENUM('PENDING', 'PICKED', 'PACKED', 'SHIPPED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `pickedAt` DATETIME(3) NULL,
    ADD COLUMN `pickedById` VARCHAR(191) NULL,
    ADD COLUMN `packedAt` DATETIME(3) NULL,
    ADD COLUMN `packedById` VARCHAR(191) NULL,
    ADD COLUMN `shippedAt` DATETIME(3) NULL,
    ADD COLUMN `shippedById` VARCHAR(191) NULL,
    ADD COLUMN `shipmentJubelioId` INTEGER NULL,
    ADD COLUMN `courierId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `SalesOrder_fulfillmentStatus_idx` ON `SalesOrder`(`fulfillmentStatus`);
```

Note: per the spec, the `pickedById`/`packedById`/`shippedById` columns are audit-only string references to `User.id`. No FK constraint is created in this migration — match the existing pattern of `JubelioOutbox.enqueuedById` (which is declared as a Prisma relation but has no explicit `ADD CONSTRAINT` in its migration). The Prisma `@relation` directive is NOT added in step 2 either; treat them as plain `String?` columns. This keeps the schema minimal and avoids needing a back-ref on `User`.

- [ ] **Step 4: Regenerate Prisma client and rebuild `@elorae/db`**

```bash
pnpm -F @elorae/db generate
pnpm -F @elorae/db build
```

Expected: both exit 0. The new types `SalesOrderFulfillmentStatus`, `SalesOrder.fulfillmentStatus` etc. now exist in `packages/db/dist/`.

- [ ] **Step 5: Type-check everything**

```bash
pnpm -F @elorae/api type-check
pnpm -F @elorae/web type-check
```

Expected: PASS for both. No existing code references the new fields yet.

- [ ] **Step 6: DO NOT run `migrate:deploy`**

Stop. Tell the user the migration is ready. Per `feedback_service_control` memory the user runs `pnpm -F @elorae/db migrate:deploy` themselves.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260614120000_add_fulfillment_columns
git commit -m "feat(db): add fulfillment status + audit columns to SalesOrder"
```

---

## Task 2: Subpath export wiring

The writer helper lives at `packages/db/src/sales-order-fulfillment-writer.ts` and is consumed via `@elorae/db/sales-order-fulfillment-writer`. This task only sets up the export entry — the file itself is created in Task 3.

**Files:**
- Modify: `packages/db/package.json`

- [ ] **Step 1: Add the subpath export entry**

Open `packages/db/package.json`. Locate the existing `exports` block:

```json
  "exports": {
    ".": {
      "types": "./dist/src/index.d.ts",
      "default": "./dist/src/index.js"
    },
    "./color": {
      "types": "./dist/src/color/lab.d.ts",
      "default": "./dist/src/color/lab.js"
    },
    "./pantone": {
      "types": "./dist/src/pantone/classify.d.ts",
      "default": "./dist/src/pantone/classify.js"
    }
  },
```

Add a new entry inside the object (preserve trailing-comma rules):

```json
    "./sales-order-fulfillment-writer": {
      "types": "./dist/src/sales-order-fulfillment-writer.d.ts",
      "default": "./dist/src/sales-order-fulfillment-writer.js"
    }
```

- [ ] **Step 2: Verify package.json still parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('packages/db/package.json'));"
```

Expected: exits 0.

- [ ] **Step 3: Commit (file referenced does not exist yet — Task 3 creates it)**

```bash
git add packages/db/package.json
git commit -m "build(db): subpath export for sales-order-fulfillment-writer"
```

---

## Task 3: Writer helper + state machine (TDD)

Create the writer with three exported functions: `markOrderPicked`, `markOrderPacked`, `markOrderShipped`. Each enforces the state machine and enqueues a `JubelioOutbox` row inside the same `$transaction`. Tests live in apps/web because that's where vitest is configured.

**Files:**
- Create: `packages/db/src/sales-order-fulfillment-writer.ts`
- Create: `apps/web/lib/sales-orders/fulfillment-writer.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/lib/sales-orders/fulfillment-writer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  markOrderPicked,
  markOrderPacked,
  markOrderShipped,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";

type MockPrisma = {
  $transaction: (cb: (tx: MockPrisma) => Promise<unknown>) => Promise<unknown>;
  salesOrder: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  jubelioOutbox: {
    create: ReturnType<typeof vi.fn>;
  };
};

function makePrismaMock(orderRow: Record<string, unknown> | null): MockPrisma {
  const inner: MockPrisma = {
    $transaction: (cb) => cb(inner),
    salesOrder: {
      findUnique: vi.fn().mockResolvedValue(orderRow),
      update: vi.fn().mockResolvedValue({}),
    },
    jubelioOutbox: {
      create: vi.fn().mockResolvedValue({ id: "ob1" }),
    },
  };
  return inner;
}

const baseOrder = {
  id: "so1",
  salesorderId: 23043,
  status: "NEW",
  fulfillmentStatus: "PENDING",
};

describe("markOrderPicked", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions PENDING -> PICKED, updates audit columns, enqueues outbox", async () => {
    const prisma = makePrismaMock(baseOrder);
    await markOrderPicked(prisma as any, { orderId: "so1", userId: "u1" });

    const updateArgs = prisma.salesOrder.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "so1" });
    expect(updateArgs.data.fulfillmentStatus).toBe("PICKED");
    expect(updateArgs.data.pickedById).toBe("u1");
    expect(updateArgs.data.pickedAt).toBeInstanceOf(Date);

    const outboxArgs = prisma.jubelioOutbox.create.mock.calls[0][0];
    expect(outboxArgs.data.entityType).toBe("salesorder_pick");
    expect(outboxArgs.data.entityId).toBe("so1");
    expect(outboxArgs.data.payload).toEqual({
      salesOrderId: "so1",
      jubelioSalesorderId: 23043,
    });
    expect(outboxArgs.data.enqueuedById).toBe("u1");
  });

  it("throws InvalidFulfillmentTransition when order already PICKED", async () => {
    const prisma = makePrismaMock({ ...baseOrder, fulfillmentStatus: "PICKED" });
    await expect(markOrderPicked(prisma as any, { orderId: "so1", userId: "u1" })).rejects.toBeInstanceOf(
      InvalidFulfillmentTransition,
    );
    expect(prisma.salesOrder.update).not.toHaveBeenCalled();
    expect(prisma.jubelioOutbox.create).not.toHaveBeenCalled();
  });

  it("throws when sub-A status is CANCELLED", async () => {
    const prisma = makePrismaMock({ ...baseOrder, status: "CANCELLED" });
    await expect(markOrderPicked(prisma as any, { orderId: "so1", userId: "u1" })).rejects.toBeInstanceOf(
      InvalidFulfillmentTransition,
    );
  });

  it("throws when order does not exist", async () => {
    const prisma = makePrismaMock(null);
    await expect(markOrderPicked(prisma as any, { orderId: "missing", userId: "u1" })).rejects.toBeInstanceOf(
      InvalidFulfillmentTransition,
    );
  });
});

describe("markOrderPacked", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions PICKED -> PACKED, enqueues outbox", async () => {
    const prisma = makePrismaMock({ ...baseOrder, fulfillmentStatus: "PICKED" });
    await markOrderPacked(prisma as any, { orderId: "so1", userId: "u2" });

    expect(prisma.salesOrder.update.mock.calls[0][0].data.fulfillmentStatus).toBe("PACKED");
    expect(prisma.jubelioOutbox.create.mock.calls[0][0].data.entityType).toBe("salesorder_pack");
  });

  it("throws when called on PENDING (skipping the PICKED step)", async () => {
    const prisma = makePrismaMock(baseOrder);
    await expect(markOrderPacked(prisma as any, { orderId: "so1", userId: "u2" })).rejects.toBeInstanceOf(
      InvalidFulfillmentTransition,
    );
  });
});

describe("markOrderShipped", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions PACKED -> SHIPPED, writes courierId, enqueues outbox with courierId in payload", async () => {
    const prisma = makePrismaMock({ ...baseOrder, fulfillmentStatus: "PACKED" });
    await markOrderShipped(prisma as any, { orderId: "so1", userId: "u3", courierId: 4 });

    const updateData = prisma.salesOrder.update.mock.calls[0][0].data;
    expect(updateData.fulfillmentStatus).toBe("SHIPPED");
    expect(updateData.courierId).toBe(4);
    expect(updateData.shippedById).toBe("u3");

    const payload = prisma.jubelioOutbox.create.mock.calls[0][0].data.payload;
    expect(payload).toEqual({
      salesOrderId: "so1",
      jubelioSalesorderId: 23043,
      courierId: 4,
    });
  });

  it("throws when called on PICKED (must be PACKED first)", async () => {
    const prisma = makePrismaMock({ ...baseOrder, fulfillmentStatus: "PICKED" });
    await expect(
      markOrderShipped(prisma as any, { orderId: "so1", userId: "u3", courierId: 4 }),
    ).rejects.toBeInstanceOf(InvalidFulfillmentTransition);
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

```bash
pnpm -F @elorae/web test -- fulfillment-writer.test.ts
```

Expected: FAIL with `Cannot find module '@elorae/db/sales-order-fulfillment-writer'`.

- [ ] **Step 3: Implement the writer**

`packages/db/src/sales-order-fulfillment-writer.ts`:

```ts
import { Prisma, type PrismaClient } from "../generated/prisma/client";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export class InvalidFulfillmentTransition extends Error {
  readonly code = "INVALID_FULFILLMENT_TRANSITION";
  constructor(message: string) {
    super(message);
    this.name = "InvalidFulfillmentTransition";
  }
}

type MarkOpts = { orderId: string; userId: string };
type MarkShipOpts = MarkOpts & { courierId: number };

function assertNotCancelled(status: string, orderId: string): void {
  if (status === "CANCELLED" || status === "RETURNED") {
    throw new InvalidFulfillmentTransition(
      `Order ${orderId} status is ${status} — fulfillment blocked`,
    );
  }
}

export async function markOrderPicked(prisma: AnyClient, opts: MarkOpts): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({ where: { id: opts.orderId } });
    if (!order) {
      throw new InvalidFulfillmentTransition(`Order ${opts.orderId} not found`);
    }
    assertNotCancelled(order.status, opts.orderId);
    if (order.fulfillmentStatus !== "PENDING") {
      throw new InvalidFulfillmentTransition(
        `Order ${opts.orderId} fulfillmentStatus is ${order.fulfillmentStatus}, expected PENDING`,
      );
    }
    await tx.salesOrder.update({
      where: { id: opts.orderId },
      data: {
        fulfillmentStatus: "PICKED",
        pickedAt: new Date(),
        pickedById: opts.userId,
      },
    });
    await tx.jubelioOutbox.create({
      data: {
        entityType: "salesorder_pick",
        entityId: opts.orderId,
        payload: { salesOrderId: opts.orderId, jubelioSalesorderId: order.salesorderId } as Prisma.InputJsonValue,
        enqueuedById: opts.userId,
      },
    });
  });
}

export async function markOrderPacked(prisma: AnyClient, opts: MarkOpts): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({ where: { id: opts.orderId } });
    if (!order) {
      throw new InvalidFulfillmentTransition(`Order ${opts.orderId} not found`);
    }
    assertNotCancelled(order.status, opts.orderId);
    if (order.fulfillmentStatus !== "PICKED") {
      throw new InvalidFulfillmentTransition(
        `Order ${opts.orderId} fulfillmentStatus is ${order.fulfillmentStatus}, expected PICKED`,
      );
    }
    await tx.salesOrder.update({
      where: { id: opts.orderId },
      data: {
        fulfillmentStatus: "PACKED",
        packedAt: new Date(),
        packedById: opts.userId,
      },
    });
    await tx.jubelioOutbox.create({
      data: {
        entityType: "salesorder_pack",
        entityId: opts.orderId,
        payload: { salesOrderId: opts.orderId, jubelioSalesorderId: order.salesorderId } as Prisma.InputJsonValue,
        enqueuedById: opts.userId,
      },
    });
  });
}

export async function markOrderShipped(prisma: AnyClient, opts: MarkShipOpts): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({ where: { id: opts.orderId } });
    if (!order) {
      throw new InvalidFulfillmentTransition(`Order ${opts.orderId} not found`);
    }
    assertNotCancelled(order.status, opts.orderId);
    if (order.fulfillmentStatus !== "PACKED") {
      throw new InvalidFulfillmentTransition(
        `Order ${opts.orderId} fulfillmentStatus is ${order.fulfillmentStatus}, expected PACKED`,
      );
    }
    await tx.salesOrder.update({
      where: { id: opts.orderId },
      data: {
        fulfillmentStatus: "SHIPPED",
        shippedAt: new Date(),
        shippedById: opts.userId,
        courierId: opts.courierId,
      },
    });
    await tx.jubelioOutbox.create({
      data: {
        entityType: "salesorder_ship",
        entityId: opts.orderId,
        payload: {
          salesOrderId: opts.orderId,
          jubelioSalesorderId: order.salesorderId,
          courierId: opts.courierId,
        } as Prisma.InputJsonValue,
        enqueuedById: opts.userId,
      },
    });
  });
}
```

- [ ] **Step 4: Rebuild `@elorae/db` so the subpath resolves to a real dist file**

```bash
pnpm -F @elorae/db build
```

Expected: exit 0. Verify the dist file exists:

```bash
test -f packages/db/dist/src/sales-order-fulfillment-writer.js && echo OK || echo MISSING
```

Expected: `OK`.

- [ ] **Step 5: Run tests, expect PASS**

```bash
pnpm -F @elorae/web test -- fulfillment-writer.test.ts
```

Expected: PASS — 8 cases (Picked: 4, Packed: 2, Shipped: 2).

- [ ] **Step 6: Type-check**

```bash
pnpm -F @elorae/web type-check
pnpm -F @elorae/api type-check
```

Expected: PASS for both.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/sales-order-fulfillment-writer.ts apps/web/lib/sales-orders/fulfillment-writer.test.ts
git commit -m "feat(db): SalesOrder fulfillment writer with state machine"
```

---

## Task 4: New outbox skip reason

Add a `JUBELIO_ALREADY_IN_STATE` constant so handlers can SKIP cleanly when Jubelio reports the order is already past the requested state (e.g. re-enqueued Pick on an already-picked order).

**Files:**
- Modify: `apps/api/src/jubelio/outbox/outbox-status.ts`

- [ ] **Step 1: Open the file**

```bash
cat apps/api/src/jubelio/outbox/outbox-status.ts
```

Confirm the existing `OUTBOX_SKIP_REASONS` const-object shape.

- [ ] **Step 2: Add the new key**

Locate the `OUTBOX_SKIP_REASONS` object. Add a new line inside it:

```ts
  JUBELIO_ALREADY_IN_STATE: "jubelio_already_in_state",
```

Keep alphabetical order with siblings if the existing file is alphabetised; otherwise append at the end before the closing brace.

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/api type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/jubelio/outbox/outbox-status.ts
git commit -m "feat(api): outbox skip reason for already-in-state Jubelio responses"
```

---

## Task 5: Pick handler (TDD)

`salesorder-pick.handler.ts` reads the outbox row, looks up the order, posts to Jubelio's pick endpoint, updates outbox status.

**Note on Jubelio endpoint shape:** the OpenAPI doc lists `POST /wms/sales/picklists/` (with `ids` + `is_completed` body) AND a separate `GET /wms/sales/orders/finish-pick/` (list endpoint). The transition action is the POST. The handler uses the `ids` body shape per `postWMSSalesPicklistsChangePickerRequest`'s pattern. If first live smoke in sub-B reveals the wrong endpoint or body shape, fix-forward in a follow-up commit; unit tests in this task only assert the call shape, not Jubelio's actual behaviour.

**Files:**
- Create: `apps/api/src/jubelio/outbox/handlers/salesorder-pick.handler.ts`
- Create: `apps/api/src/jubelio/outbox/handlers/salesorder-pick.handler.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/jubelio/outbox/handlers/salesorder-pick.handler.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { SalesOrderPickHandler } from "./salesorder-pick.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { AdminNotificationService } from "../../../admin/notification.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

describe("SalesOrderPickHandler", () => {
  let handler: SalesOrderPickHandler;
  let prisma: any;
  let http: { post: jest.Mock };
  let admin: { write: jest.Mock };

  beforeEach(async () => {
    prisma = {
      salesOrder: { findUnique: jest.fn() },
    };
    http = { post: jest.fn() };
    admin = { write: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalesOrderPickHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
        { provide: AdminNotificationService, useValue: admin },
      ],
    }).compile();

    handler = moduleRef.get(SalesOrderPickHandler);
  });

  const baseRow = (overrides = {}) => ({
    id: "ob1",
    entityType: "salesorder_pick",
    entityId: "so1",
    payload: { salesOrderId: "so1", jubelioSalesorderId: 23043 },
    status: "PENDING",
    attempts: 0,
    ...overrides,
  });

  it("happy path: POSTs to Jubelio and returns processed", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockResolvedValue({ status: "ok" });

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("picklist"),
      expect.objectContaining({ ids: [23043] }),
    );
  });

  it("returns skipped when SalesOrder not found", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(null);

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "skipped", reason: expect.stringContaining("missing") });
    expect(http.post).not.toHaveBeenCalled();
  });

  it("returns skipped with jubelio_already_in_state when Jubelio rejects with already-picked error", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockRejectedValue(Object.assign(new Error("already picked"), { code: "ALREADY_IN_STATE" }));

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE });
  });

  it("propagates other errors so the outbox retries", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockRejectedValue(new Error("network bork"));

    await expect(handler.handle(baseRow() as any)).rejects.toThrow("network bork");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm -F @elorae/api test -- salesorder-pick.handler.spec.ts --runInBand
```

Expected: FAIL with `Cannot find module './salesorder-pick.handler'`.

- [ ] **Step 3: Implement**

`apps/api/src/jubelio/outbox/handlers/salesorder-pick.handler.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { AdminNotificationService } from "../../../admin/notification.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";

type PickPayload = { salesOrderId: string; jubelioSalesorderId: number };

@Injectable()
export class SalesOrderPickHandler implements OutboxHandler {
  private readonly logger = new Logger(SalesOrderPickHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
    private readonly admin: AdminNotificationService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const payload = row.payload as unknown as PickPayload;
    const order = await this.prisma.salesOrder.findUnique({ where: { id: payload.salesOrderId } });
    if (!order) {
      return { kind: "skipped", reason: `${OUTBOX_SKIP_REASONS.MISSING_MAPPING}:salesorder` };
    }

    try {
      await this.http.post("/wms/sales/picklists/", {
        ids: [order.salesorderId],
        is_completed: true,
      });
    } catch (err) {
      if (isAlreadyInStateError(err)) {
        this.logger.warn(
          `Jubelio reports salesorder ${order.salesorderId} already past PICK — skipping`,
        );
        return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE };
      }
      throw err;
    }

    this.logger.log(`Pushed Pick for salesorder ${order.salesorderId}`);
    return { kind: "processed" };
  }
}

function isAlreadyInStateError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ALREADY_IN_STATE";
}
```

The exact Jubelio error shape for "already in state" is unknown until first live observation. The `isAlreadyInStateError` helper currently keys on a synthetic `code === "ALREADY_IN_STATE"`. Sub-B's first live smoke will reveal Jubelio's real error code; update this helper then (probably string-matching against the error body message or HTTP 4xx with specific status text).

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm -F @elorae/api test -- salesorder-pick.handler.spec.ts --runInBand
```

Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/outbox/handlers/salesorder-pick.handler.ts apps/api/src/jubelio/outbox/handlers/salesorder-pick.handler.spec.ts
git commit -m "feat(api): outbox handler for salesorder pick push"
```

---

## Task 6: Pack handler (TDD)

Same shape as Pick, different endpoint and payload (no `is_completed` flag — Jubelio's pack endpoint takes only `{ ids }`).

**Files:**
- Create: `apps/api/src/jubelio/outbox/handlers/salesorder-pack.handler.ts`
- Create: `apps/api/src/jubelio/outbox/handlers/salesorder-pack.handler.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/jubelio/outbox/handlers/salesorder-pack.handler.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { SalesOrderPackHandler } from "./salesorder-pack.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { AdminNotificationService } from "../../../admin/notification.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

describe("SalesOrderPackHandler", () => {
  let handler: SalesOrderPackHandler;
  let prisma: any;
  let http: { post: jest.Mock };
  let admin: { write: jest.Mock };

  beforeEach(async () => {
    prisma = { salesOrder: { findUnique: jest.fn() } };
    http = { post: jest.fn() };
    admin = { write: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalesOrderPackHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
        { provide: AdminNotificationService, useValue: admin },
      ],
    }).compile();

    handler = moduleRef.get(SalesOrderPackHandler);
  });

  const baseRow = (overrides = {}) => ({
    id: "ob1",
    entityType: "salesorder_pack",
    entityId: "so1",
    payload: { salesOrderId: "so1", jubelioSalesorderId: 23043 },
    status: "PENDING",
    attempts: 0,
    ...overrides,
  });

  it("happy path: POSTs to mark-as-complete with ids array", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockResolvedValue({ status: "ok" });

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("packlist/mark-as-complete"),
      { ids: [23043] },
    );
  });

  it("returns skipped when SalesOrder not found", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(null);
    const result = await handler.handle(baseRow() as any);
    expect(result.kind).toBe("skipped");
    expect(http.post).not.toHaveBeenCalled();
  });

  it("returns skipped on already-in-state error", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockRejectedValue(Object.assign(new Error("already packed"), { code: "ALREADY_IN_STATE" }));
    const result = await handler.handle(baseRow() as any);
    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE });
  });

  it("propagates other errors", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockRejectedValue(new Error("network bork"));
    await expect(handler.handle(baseRow() as any)).rejects.toThrow("network bork");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm -F @elorae/api test -- salesorder-pack.handler.spec.ts --runInBand
```

Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/jubelio/outbox/handlers/salesorder-pack.handler.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { AdminNotificationService } from "../../../admin/notification.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";

type PackPayload = { salesOrderId: string; jubelioSalesorderId: number };

@Injectable()
export class SalesOrderPackHandler implements OutboxHandler {
  private readonly logger = new Logger(SalesOrderPackHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
    private readonly admin: AdminNotificationService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const payload = row.payload as unknown as PackPayload;
    const order = await this.prisma.salesOrder.findUnique({ where: { id: payload.salesOrderId } });
    if (!order) {
      return { kind: "skipped", reason: `${OUTBOX_SKIP_REASONS.MISSING_MAPPING}:salesorder` };
    }

    try {
      await this.http.post("/wms/sales/packlist/mark-as-complete", { ids: [order.salesorderId] });
    } catch (err) {
      if (isAlreadyInStateError(err)) {
        this.logger.warn(
          `Jubelio reports salesorder ${order.salesorderId} already past PACK — skipping`,
        );
        return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE };
      }
      throw err;
    }

    this.logger.log(`Pushed Pack for salesorder ${order.salesorderId}`);
    return { kind: "processed" };
  }
}

function isAlreadyInStateError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ALREADY_IN_STATE";
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm -F @elorae/api test -- salesorder-pack.handler.spec.ts --runInBand
```

Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/outbox/handlers/salesorder-pack.handler.ts apps/api/src/jubelio/outbox/handlers/salesorder-pack.handler.spec.ts
git commit -m "feat(api): outbox handler for salesorder pack push"
```

---

## Task 7: Ship handler (TDD)

The Ship handler also writes back to `SalesOrder.shipmentJubelioId` on success — but only when Jubelio returns a recoverable `shipment_header_id`. Per the OpenAPI doc the response schema is just `{ status: "ok" }` so the handler does NOT extract shipment_header_id from the response. Instead, `shipmentJubelioId` is left null in sub-A and will be backfilled by sub-A's webhook handler when Jubelio sends the followup `salesorder` webhook with the new shipment details. The column is on the schema and ready to receive future writes; the Ship handler simply triggers the Jubelio side and doesn't synchronously confirm a header id.

**Files:**
- Create: `apps/api/src/jubelio/outbox/handlers/salesorder-ship.handler.ts`
- Create: `apps/api/src/jubelio/outbox/handlers/salesorder-ship.handler.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/jubelio/outbox/handlers/salesorder-ship.handler.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { SalesOrderShipHandler } from "./salesorder-ship.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { AdminNotificationService } from "../../../admin/notification.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

describe("SalesOrderShipHandler", () => {
  let handler: SalesOrderShipHandler;
  let prisma: any;
  let http: { post: jest.Mock };
  let admin: { write: jest.Mock };

  beforeEach(async () => {
    prisma = { salesOrder: { findUnique: jest.fn() } };
    http = { post: jest.fn() };
    admin = { write: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalesOrderShipHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
        { provide: AdminNotificationService, useValue: admin },
      ],
    }).compile();

    handler = moduleRef.get(SalesOrderShipHandler);
  });

  const baseRow = (overrides = {}) => ({
    id: "ob1",
    entityType: "salesorder_ship",
    entityId: "so1",
    payload: { salesOrderId: "so1", jubelioSalesorderId: 23043, courierId: 4 },
    status: "PENDING",
    attempts: 0,
    ...overrides,
  });

  it("happy path: POSTs to /wms/shipments/ with courier and order metadata", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: "so1",
      salesorderId: 23043,
      salesorderNo: "TT-23043",
    });
    http.post.mockResolvedValue({ status: "ok" });

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.post).toHaveBeenCalledWith(
      "/wms/shipments/",
      expect.objectContaining({
        courier_new_id: 4,
        shipment_header_id: 0,
      }),
    );
  });

  it("returns skipped when SalesOrder not found", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(null);
    const result = await handler.handle(baseRow() as any);
    expect(result.kind).toBe("skipped");
    expect(http.post).not.toHaveBeenCalled();
  });

  it("returns skipped on already-in-state error", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043, salesorderNo: "TT-23043" });
    http.post.mockRejectedValue(Object.assign(new Error("already shipped"), { code: "ALREADY_IN_STATE" }));
    const result = await handler.handle(baseRow() as any);
    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE });
  });

  it("propagates other errors", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043, salesorderNo: "TT-23043" });
    http.post.mockRejectedValue(new Error("network bork"));
    await expect(handler.handle(baseRow() as any)).rejects.toThrow("network bork");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm -F @elorae/api test -- salesorder-ship.handler.spec.ts --runInBand
```

Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/jubelio/outbox/handlers/salesorder-ship.handler.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { AdminNotificationService } from "../../../admin/notification.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";

type ShipPayload = { salesOrderId: string; jubelioSalesorderId: number; courierId: number };

@Injectable()
export class SalesOrderShipHandler implements OutboxHandler {
  private readonly logger = new Logger(SalesOrderShipHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
    private readonly admin: AdminNotificationService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const payload = row.payload as unknown as ShipPayload;
    const order = await this.prisma.salesOrder.findUnique({ where: { id: payload.salesOrderId } });
    if (!order) {
      return { kind: "skipped", reason: `${OUTBOX_SKIP_REASONS.MISSING_MAPPING}:salesorder` };
    }

    const body = {
      courier_new_id: payload.courierId,
      location_id: 1,
      shipment_type: "2",
      shipment_header_id: 0,
      shipment_no: "",
      courier_name: "",
      shipment_date: new Date().toISOString(),
      orders: [order.salesorderId],
    };

    try {
      await this.http.post("/wms/shipments/", body);
    } catch (err) {
      if (isAlreadyInStateError(err)) {
        this.logger.warn(
          `Jubelio reports salesorder ${order.salesorderId} already past SHIP — skipping`,
        );
        return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE };
      }
      throw err;
    }

    this.logger.log(`Pushed Ship for salesorder ${order.salesorderId} via courier ${payload.courierId}`);
    return { kind: "processed" };
  }
}

function isAlreadyInStateError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ALREADY_IN_STATE";
}
```

`location_id` is hardcoded to `1` (the typical Jubelio default location). Sub-B will likely surface this as a setting if the user has multiple locations.

`shipment_no` and `courier_name` empty — Jubelio fills these from `courier_new_id` lookup. If the API rejects empty strings, sub-B's first live smoke will surface that and we add the lookup logic then.

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm -F @elorae/api test -- salesorder-ship.handler.spec.ts --runInBand
```

Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/outbox/handlers/salesorder-ship.handler.ts apps/api/src/jubelio/outbox/handlers/salesorder-ship.handler.spec.ts
git commit -m "feat(api): outbox handler for salesorder ship push"
```

---

## Task 8: Wire handlers into router + module

Register the three handlers as Nest providers and route them in the existing `OutboxRouter`.

**Files:**
- Modify: `apps/api/src/jubelio/outbox/outbox-router.ts`
- Modify: `apps/api/src/jubelio/outbox/jubelio-outbox.module.ts`
- Modify: `apps/api/src/jubelio/outbox/outbox-router.spec.ts`

- [ ] **Step 1: Update the router**

Open `apps/api/src/jubelio/outbox/outbox-router.ts`. Replace the file contents with:

```ts
import { Injectable } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { StockPushHandler } from "./handlers/stock-push.handler";
import { ProductPushHandler } from "./handlers/product-push.handler";
import { SalesOrderPickHandler } from "./handlers/salesorder-pick.handler";
import { SalesOrderPackHandler } from "./handlers/salesorder-pack.handler";
import { SalesOrderShipHandler } from "./handlers/salesorder-ship.handler";
import type { HandlerOutcome } from "./handlers/handler.types";
import { OUTBOX_SKIP_REASONS } from "./outbox-status";

@Injectable()
export class OutboxRouter {
  constructor(
    private readonly stockPush: StockPushHandler,
    private readonly productPush: ProductPushHandler,
    private readonly salesorderPick: SalesOrderPickHandler,
    private readonly salesorderPack: SalesOrderPackHandler,
    private readonly salesorderShip: SalesOrderShipHandler,
  ) {}

  async route(row: JubelioOutbox): Promise<HandlerOutcome> {
    switch (row.entityType) {
      case "stock_push":
        return this.stockPush.handle(row);
      case "product_push":
        return this.productPush.handle(row);
      case "salesorder_pick":
        return this.salesorderPick.handle(row);
      case "salesorder_pack":
        return this.salesorderPack.handle(row);
      case "salesorder_ship":
        return this.salesorderShip.handle(row);
      default:
        return {
          kind: "skipped",
          reason: `${OUTBOX_SKIP_REASONS.UNKNOWN_ENTITY_TYPE}:${row.entityType}`,
        };
    }
  }
}
```

- [ ] **Step 2: Update the module**

Open `apps/api/src/jubelio/outbox/jubelio-outbox.module.ts`. Find the `providers` array. Add the three new handlers to both the imports and the providers list:

```ts
import { StockPushHandler } from "./handlers/stock-push.handler";
import { ProductPushHandler } from "./handlers/product-push.handler";
import { SalesOrderPickHandler } from "./handlers/salesorder-pick.handler";
import { SalesOrderPackHandler } from "./handlers/salesorder-pack.handler";
import { SalesOrderShipHandler } from "./handlers/salesorder-ship.handler";
```

```ts
  providers: [
    OutboxPoller,
    OutboxProcessor,
    OutboxRouter,
    StockPushHandler,
    ProductPushHandler,
    SalesOrderPickHandler,
    SalesOrderPackHandler,
    SalesOrderShipHandler,
  ],
```

- [ ] **Step 3: Update the router spec**

Open `apps/api/src/jubelio/outbox/outbox-router.spec.ts`. Note its existing shape (it wires the router with mocked handlers). Add three new mock handlers to the providers list and three new test cases for the new entityType routing.

Concretely, in the test setup add:

```ts
const salesorderPick = { handle: jest.fn().mockResolvedValue({ kind: "processed" }) };
const salesorderPack = { handle: jest.fn().mockResolvedValue({ kind: "processed" }) };
const salesorderShip = { handle: jest.fn().mockResolvedValue({ kind: "processed" }) };
```

Register them in the `Test.createTestingModule.providers` array with `{ provide: SalesOrderPickHandler, useValue: salesorderPick }` (and similarly for Pack and Ship). Add three test cases:

```ts
  it("routes salesorder_pick to SalesOrderPickHandler", async () => {
    const row = { id: "ob1", entityType: "salesorder_pick" } as any;
    await router.route(row);
    expect(salesorderPick.handle).toHaveBeenCalledWith(row);
  });

  it("routes salesorder_pack to SalesOrderPackHandler", async () => {
    const row = { id: "ob1", entityType: "salesorder_pack" } as any;
    await router.route(row);
    expect(salesorderPack.handle).toHaveBeenCalledWith(row);
  });

  it("routes salesorder_ship to SalesOrderShipHandler", async () => {
    const row = { id: "ob1", entityType: "salesorder_ship" } as any;
    await router.route(row);
    expect(salesorderShip.handle).toHaveBeenCalledWith(row);
  });
```

Read the existing spec file before editing — match its existing pattern for the mock providers exactly.

- [ ] **Step 4: Run the entire api test suite**

```bash
pnpm -F @elorae/api test --runInBand
```

Expected: all green (existing tests plus new ones from tasks 5-7-8).

- [ ] **Step 5: Type-check**

```bash
pnpm -F @elorae/api type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/jubelio/outbox/outbox-router.ts apps/api/src/jubelio/outbox/outbox-router.spec.ts apps/api/src/jubelio/outbox/jubelio-outbox.module.ts
git commit -m "feat(api): wire salesorder pick/pack/ship handlers into outbox router"
```

---

## Task 9: BOUNDARY.md dual-ownership update

Update §3.2 to reflect that `SalesOrder` is now dual-writer: api owns the Jubelio-derived columns, web owns the fulfillment columns (via the writer helper only).

**Files:**
- Modify: `docs/BOUNDARY.md`

- [ ] **Step 1: Update the ownership row in §3 table**

Open `docs/BOUNDARY.md`. Locate the row for `SalesOrder` in the per-table ownership table (it currently reads `api | web (read) | ✅ schema + api writer`). Replace with:

```markdown
| `SalesOrder`                   | **both** — see §3.2         | —                           | ✅ api owns Jubelio-derived cols; web owns fulfillment cols via helper |
```

(Match the table's column count and alignment.)

- [ ] **Step 2: Rewrite §3.2 body**

Find §3.2 (currently titled "Sales writes (api-only as of 2026-06-11)"). Replace its body with:

```markdown
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

- `fulfillmentStatus`
- `pickedAt`, `pickedById`
- `packedAt`, `packedById`
- `shippedAt`, `shippedById`
- `shipmentJubelioId`
- `courierId`

The writer helper enforces the state machine (PENDING → PICKED → PACKED → SHIPPED, no skip, no reverse) and enqueues a `JubelioOutbox` row per transition in the same transaction. Web bare-prisma writes to any fulfillment column are a contract violation.

`SalesOrderItem` remains api-only — web never writes line items.
```

- [ ] **Step 3: Commit**

```bash
git add docs/BOUNDARY.md
git commit -m "docs: BOUNDARY dual-ownership of SalesOrder fulfillment columns"
```

---

## Smoke test path (NOT a task)

Sub-A does not include any live Jubelio smoke. Sub-B (UI actions on order detail) will be the first slice to actually POST to Jubelio. Before sub-B touches a real order:

1. Designate one Jubelio test order (low-value, ideally a sandbox or test store).
2. Document the cleanup procedure for irreversible actions:
   - Pick can't undo at Jubelio; mark a note + ignore.
   - Pack can't undo; same.
   - Ship locks the AWB request; if courier is selected wrong, only Jubelio admin UI cancellation works.
3. Run Pick → Pack → Ship against that one order in dev. Observe error responses (especially the "already in state" code) and update `isAlreadyInStateError` in all 3 handlers in a follow-up commit.

This belongs in sub-B's plan, not here.

---

## Out-of-scope follow-ups

- Sub-B: UI action buttons (Finish Pick / Finish Pack / Ship with courier select) on the sales-order detail page. Server actions that call `markOrderPicked` etc.
- Sub-B: Live Jubelio smoke + handler fix-forward for the real "already in state" error code shape.
- Sub-C: Fulfillment Queue page at `/backoffice/sales-orders/fulfillment` with filters by `fulfillmentStatus` and batch enqueue.
- Print views (pick list + packing slip). Browser print, no PDF generation.
- Multi-location `location_id` selection in the Ship handler.
- Sub-A-followup of EPIC-03: `SalesReturnWebhookHandler` wiring once Jubelio delivers a real return webhook.
