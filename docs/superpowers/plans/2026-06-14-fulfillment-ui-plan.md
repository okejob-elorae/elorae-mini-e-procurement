# Fulfillment UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Fulfillment card to the order detail page with state-aware Pick / Pack / Ship actions that call sub-A's writer helpers, plus a tiny `JubelioCourier` cache that backs the Ship courier dropdown.

**Architecture:** Pure feature add. Server actions in `apps/web/app/actions/sales-order-fulfillment.ts` call the writer helper from `@elorae/db/sales-order-fulfillment-writer` directly (server-side, in the web process). Courier sync goes through the existing `apiFetch` signed channel to a new apps/api endpoint that hits Jubelio. New `JubelioCourier` table is tiny (~56 rows) and lazy-populates on first ship-dialog open.

**Tech Stack:** Next.js 16 App Router (RSC + server actions), Prisma 7, NestJS 11 (new controller), shadcn AlertDialog/Card/Badge/Select, `next-intl`, `sonner` toasts, vitest (apps/web) + Jest (apps/api).

**Spec:** `docs/superpowers/specs/2026-06-14-fulfillment-ui-design.md`

---

## File Structure

**New files:**

```
packages/db/prisma/migrations/20260614150000_add_jubelio_courier/migration.sql

apps/api/src/jubelio/couriers/couriers.controller.ts
apps/api/src/jubelio/couriers/couriers.service.ts
apps/api/src/jubelio/couriers/couriers.service.spec.ts
apps/api/src/jubelio/couriers/couriers.module.ts

apps/web/app/actions/jubelio-couriers.ts
apps/web/app/actions/sales-order-fulfillment.ts
apps/web/app/actions/sales-order-fulfillment.spec.ts

apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx
```

**Modified files:**

```
packages/db/prisma/schema.prisma                                # + JubelioCourier model
apps/api/src/jubelio/jubelio.module.ts                          # + JubelioCouriersModule
apps/web/lib/constants/enums.ts                                 # + SalesOrderFulfillmentStatus literal
apps/web/lib/rbac.ts                                            # + SALES_ORDERS_FULFILL permission
apps/web/lib/sales-orders/queries.ts                            # + fulfillment fields on SalesOrderDetail + audit-name resolution
apps/web/lib/sales-orders/queries.test.ts                       # + assertions for new fields
apps/web/lib/i18n/messages/en.json                              # + salesOrders.fulfillment namespace
apps/web/lib/i18n/messages/id.json                              # + same in Indonesian
apps/web/app/backoffice/sales-orders/[id]/page.tsx              # no change required if all data comes via getSalesOrderById
apps/web/app/backoffice/sales-orders/[id]/SalesOrderDetailClient.tsx  # + render FulfillmentCard
packages/db/prisma/seed.ts                                      # + sales_orders:fulfill permission grant
```

**Reused (no modification):**

- `@elorae/db/sales-order-fulfillment-writer` — sub-A's writer (`markOrderPicked`, `markOrderPacked`, `markOrderShipped`, `InvalidFulfillmentTransition`).
- `apps/web/lib/internal-api.ts` — `apiFetch` + `extractApiMessage`.
- `apps/web/components/ui/{card,badge,button,select,alert-dialog}.tsx` — shadcn primitives.
- `apps/web/components/ui/sonner.tsx` — toaster (already mounted in app layout).
- `apps/web/lib/auth.ts` — `auth()` for session in server actions.
- `apps/web/lib/rbac.ts` — `requirePermission()`.

---

## Task 1: `JubelioCourier` schema + migration

Add the courier cache table. Hand-author migration. User runs `migrate:deploy`.

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260614150000_add_jubelio_courier/migration.sql`

- [ ] **Step 1: Add the model to schema.prisma**

Locate a good spot among the `Jubelio*` models (e.g. near `JubelioOutbox`). Append:

```prisma
model JubelioCourier {
  id        Int      @id
  name      String
  syncedAt  DateTime
  updatedAt DateTime @updatedAt

  @@index([name])
}
```

`id` is Jubelio's `courier_id` — not auto-generated. Stored as PK directly.

- [ ] **Step 2: Hand-author the migration SQL**

```bash
mkdir -p packages/db/prisma/migrations/20260614150000_add_jubelio_courier
```

Create `packages/db/prisma/migrations/20260614150000_add_jubelio_courier/migration.sql`:

```sql
-- CreateTable
CREATE TABLE `JubelioCourier` (
    `id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `syncedAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `JubelioCourier_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- [ ] **Step 3: Regenerate Prisma client + rebuild @elorae/db**

```bash
pnpm -F @elorae/db generate
pnpm -F @elorae/db build
```

Expected: both exit 0.

- [ ] **Step 4: Type-check both packages**

```bash
pnpm -F @elorae/api type-check
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 5: DO NOT run `migrate:deploy`**

Tell the user. Per `feedback_service_control` they run it.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260614150000_add_jubelio_courier
git commit -m "feat(db): add JubelioCourier cache table"
```

---

## Task 2: apps/api couriers controller + service (TDD)

apps/api side of the courier sync. `POST /jubelio/couriers/sync` fetches Jubelio + upserts to `JubelioCourier`.

**Files:**
- Create: `apps/api/src/jubelio/couriers/couriers.service.ts`
- Create: `apps/api/src/jubelio/couriers/couriers.service.spec.ts`
- Create: `apps/api/src/jubelio/couriers/couriers.controller.ts`
- Create: `apps/api/src/jubelio/couriers/couriers.module.ts`

- [ ] **Step 1: Write the failing test for the service**

`apps/api/src/jubelio/couriers/couriers.service.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { JubelioCouriersService } from "./couriers.service";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

describe("JubelioCouriersService", () => {
  let svc: JubelioCouriersService;
  let prisma: any;
  let http: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      jubelioCourier: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    http = { get: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        JubelioCouriersService,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();

    svc = mod.get(JubelioCouriersService);
  });

  it("sync: fetches Jubelio + upserts each row + returns count", async () => {
    http.get.mockResolvedValue([
      { courier_id: 1, courier_name: "JNE" },
      { courier_id: 2, courier_name: "J&T" },
    ]);

    const result = await svc.sync();

    expect(result).toEqual({ count: 2 });
    expect(http.get).toHaveBeenCalledWith("/wms/couriers");
    expect(prisma.jubelioCourier.upsert).toHaveBeenCalledTimes(2);

    const firstUpsert = prisma.jubelioCourier.upsert.mock.calls[0][0];
    expect(firstUpsert.where).toEqual({ id: 1 });
    expect(firstUpsert.create).toMatchObject({ id: 1, name: "JNE" });
    expect(firstUpsert.update).toMatchObject({ name: "JNE" });
  });

  it("sync: deletes rows missing from latest Jubelio response", async () => {
    http.get.mockResolvedValue([{ courier_id: 1, courier_name: "JNE" }]);

    await svc.sync();

    expect(prisma.jubelioCourier.deleteMany).toHaveBeenCalledWith({
      where: { id: { notIn: [1] } },
    });
  });

  it("sync: stamps syncedAt to a Date", async () => {
    http.get.mockResolvedValue([{ courier_id: 1, courier_name: "JNE" }]);

    await svc.sync();

    const upsertArgs = prisma.jubelioCourier.upsert.mock.calls[0][0];
    expect(upsertArgs.create.syncedAt).toBeInstanceOf(Date);
    expect(upsertArgs.update.syncedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm -F @elorae/api test -- couriers.service.spec.ts --runInBand
```

Expected: FAIL with `Cannot find module './couriers.service'`.

- [ ] **Step 3: Implement the service**

`apps/api/src/jubelio/couriers/couriers.service.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

type JubelioCourierRow = {
  courier_id: number;
  courier_name: string;
};

@Injectable()
export class JubelioCouriersService {
  private readonly logger = new Logger(JubelioCouriersService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async sync(): Promise<{ count: number }> {
    const rows = await this.http.get<JubelioCourierRow[]>("/wms/couriers");
    const now = new Date();
    const ids = rows.map((r) => r.courier_id);

    await this.prisma.$transaction(async (tx) => {
      await tx.jubelioCourier.deleteMany({ where: { id: { notIn: ids } } });
      for (const r of rows) {
        await tx.jubelioCourier.upsert({
          where: { id: r.courier_id },
          create: { id: r.courier_id, name: r.courier_name, syncedAt: now },
          update: { name: r.courier_name, syncedAt: now },
        });
      }
    });

    this.logger.log(`Synced ${rows.length} couriers from Jubelio`);
    return { count: rows.length };
  }
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm -F @elorae/api test -- couriers.service.spec.ts --runInBand
```

Expected: PASS, 3/3.

- [ ] **Step 5: Implement the controller**

`apps/api/src/jubelio/couriers/couriers.controller.ts`:

```ts
import { Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JubelioCouriersService } from "./couriers.service";

@ApiTags("jubelio-couriers")
@Controller("jubelio/couriers")
export class JubelioCouriersController {
  constructor(private readonly svc: JubelioCouriersService) {}

  @Post("sync")
  @HttpCode(200)
  @ApiOperation({
    summary: "Refresh JubelioCourier cache from Jubelio /wms/couriers",
  })
  @ApiOkResponse({ description: "Returns the count of couriers synced" })
  sync(): Promise<{ count: number }> {
    return this.svc.sync();
  }
}
```

- [ ] **Step 6: Implement the module**

`apps/api/src/jubelio/couriers/couriers.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "../../db/prisma.module";
import { JubelioModule } from "../jubelio.module";
import { JubelioCouriersController } from "./couriers.controller";
import { JubelioCouriersService } from "./couriers.service";

@Module({
  imports: [PrismaModule, JubelioModule],
  controllers: [JubelioCouriersController],
  providers: [JubelioCouriersService],
  exports: [JubelioCouriersService],
})
export class JubelioCouriersModule {}
```

- [ ] **Step 7: Wire the module into the api app**

Locate the existing root module that imports `JubelioCategoriesModule` (or similar Jubelio submodules). Search:

```bash
grep -n "JubelioCategoriesModule" apps/api/src/app.module.ts
```

Add `JubelioCouriersModule` to that same `imports` array. Match style.

- [ ] **Step 8: Run full api test suite**

```bash
pnpm -F @elorae/api test --runInBand
```

Expected: all green.

- [ ] **Step 9: Type-check**

```bash
pnpm -F @elorae/api type-check
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/jubelio/couriers apps/api/src/app.module.ts
git commit -m "feat(api): JubelioCouriersController for courier cache sync"
```

(If `app.module.ts` wasn't the wiring point, swap the path for whichever file gained the new module import.)

---

## Task 3: apps/web `syncJubelioCouriers` server action

Thin wrapper around `apiFetch` that hits the new apps/api endpoint.

**Files:**
- Create: `apps/web/app/actions/jubelio-couriers.ts`

- [ ] **Step 1: Implement the server action**

`apps/web/app/actions/jubelio-couriers.ts`:

```ts
"use server";

import { apiFetch, extractApiMessage } from "@/lib/internal-api";
import { auth } from "@/lib/auth";

export async function syncJubelioCouriers(): Promise<{ count: number }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const r = await apiFetch<{ count: number }>("POST", "/jubelio/couriers/sync", {
    userId: session.user.id,
    body: {},
  });
  if (!r.ok) {
    throw new Error(extractApiMessage(r.error, `Courier sync failed (${r.status})`));
  }
  return r.data as { count: number };
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/actions/jubelio-couriers.ts
git commit -m "feat(web): server action for Jubelio courier sync"
```

---

## Task 4: RBAC + seed for `sales_orders:fulfill`

**Files:**
- Modify: `apps/web/lib/rbac.ts`
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Add the permission code to rbac.ts**

Open `apps/web/lib/rbac.ts`. Locate the `PERMISSIONS` const. Find the `SALES_ORDERS_VIEW` entry. Add directly below:

```ts
  SALES_ORDERS_FULFILL: 'sales_orders:fulfill',
```

(Use single quotes — this file is pre-flip and uses single quotes throughout.)

Do NOT add an entry to `ROUTE_PERMISSIONS`. The new permission is checked at action-call time, not route-load.

- [ ] **Step 2: Add the descriptor to seed.ts**

Open `packages/db/prisma/seed.ts`. Locate the descriptor:

```ts
{ code: 'sales_orders:view', module: 'sales_orders', action: 'view', description: 'View marketplace sales orders' },
```

Add directly below:

```ts
{ code: 'sales_orders:fulfill', module: 'sales_orders', action: 'fulfill', description: 'Pick, pack, ship marketplace orders' },
```

- [ ] **Step 3: Grant to fulfillment-capable roles**

In `seed.ts`, find each role-permission list that already contains `'sales_orders:view'` and is for a fulfillment-capable role (PURCHASER, WAREHOUSE, PRODUCTION). Append `'sales_orders:fulfill'` next to each.

Verify after edits:

```bash
grep -c "sales_orders:fulfill" packages/db/prisma/seed.ts
```

Expected: 4 (1 descriptor + 3 role assignments).

- [ ] **Step 4: Verify @elorae/db still builds**

```bash
pnpm -F @elorae/db build
```

Expected: exit 0.

- [ ] **Step 5: Do NOT run `pnpm -F @elorae/db seed`**

User runs it after merge.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/rbac.ts packages/db/prisma/seed.ts
git commit -m "feat: sales_orders:fulfill permission registered + seeded"
```

---

## Task 5: Client-safe `SalesOrderFulfillmentStatus` literal

Mirror the Prisma enum from sub-A. Required for the client Fulfillment Card.

**Files:**
- Modify: `apps/web/lib/constants/enums.ts`

- [ ] **Step 1: Append the new enum literal**

Open `apps/web/lib/constants/enums.ts`. Locate the existing `SalesOrderStatus` const-object enum block (added by sub-B). Append AFTER it (use double quotes — this file was extended with double quotes for sub-B's additions):

```ts
export const SalesOrderFulfillmentStatus = {
  PENDING: "PENDING",
  PICKED: "PICKED",
  PACKED: "PACKED",
  SHIPPED: "SHIPPED",
} as const;
export type SalesOrderFulfillmentStatus =
  (typeof SalesOrderFulfillmentStatus)[keyof typeof SalesOrderFulfillmentStatus];
export const SALES_ORDER_FULFILLMENT_STATUS_VALUES = Object.values(SalesOrderFulfillmentStatus);
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/constants/enums.ts
git commit -m "feat(web): client-safe SalesOrderFulfillmentStatus enum literal"
```

---

## Task 6: Extend `getSalesOrderById` to include fulfillment fields

Adds fulfillment columns + audit name resolution + courier name lookup to the existing detail query.

**Files:**
- Modify: `apps/web/lib/sales-orders/queries.ts`
- Modify: `apps/web/lib/sales-orders/queries.test.ts`

- [ ] **Step 1: Extend the SalesOrderDetail type**

Open `apps/web/lib/sales-orders/queries.ts`. Locate the `SalesOrderDetail` type. Add fields at the end:

```ts
  fulfillmentStatus: SalesOrderFulfillmentStatus;
  pickedAt: Date | null;
  pickedById: string | null;
  pickedByName: string | null;
  packedAt: Date | null;
  packedById: string | null;
  packedByName: string | null;
  shippedAt: Date | null;
  shippedById: string | null;
  shippedByName: string | null;
  courierId: number | null;
  courierName: string | null;
  shipmentJubelioId: number | null;
```

Add the import at the top of the file:

```ts
import type { SalesOrderFulfillmentStatus } from "@/lib/constants/enums";
```

- [ ] **Step 2: Update test fixtures**

Open `apps/web/lib/sales-orders/queries.test.ts`. The existing `getSalesOrderById` test fixtures need the new columns. Find the `findUnique.mockResolvedValue({...})` block (sub-B). Add fields:

```ts
fulfillmentStatus: "PENDING",
pickedAt: null,
pickedById: null,
packedAt: null,
packedById: null,
shippedAt: null,
shippedById: null,
shipmentJubelioId: null,
```

Add NEW prisma mocks for the resolution queries:

```ts
prisma.user = { findMany: jest.fn().mockResolvedValue([]) };
prisma.jubelioCourier = { findUnique: jest.fn().mockResolvedValue(null) };
```

Wait — the test file uses vitest, not jest. Use `vi.fn()` instead of `jest.fn()`. Adapt to the file's existing pattern.

Add a new test case:

```ts
it("resolves audit user names and courier name", async () => {
  (prisma.salesOrder.findUnique as any).mockResolvedValue({
    id: "so1",
    salesorderId: 23043,
    salesorderNo: "TT-001",
    channel: "TOKOPEDIA",
    sourceName: "Shop | Tokopedia",
    status: "NEW",
    channelStatus: null,
    internalStatus: null,
    wmsStatus: null,
    isCanceled: false,
    isPaid: false,
    markedAsComplete: false,
    customerName: null,
    customerPhone: null,
    customerEmail: null,
    shippingProvince: null,
    shippingCity: null,
    shippingAddress: null,
    subTotal: { toString: () => "0" },
    totalDisc: { toString: () => "0" },
    totalTax: { toString: () => "0" },
    shippingCost: { toString: () => "0" },
    grandTotal: { toString: () => "0" },
    feeBreakdown: null,
    paymentMethod: null,
    paymentDate: null,
    transactionDate: new Date(),
    createdDateJubelio: null,
    completedDate: null,
    cancelDate: null,
    lastModifiedJubelio: null,
    trackingNumber: null,
    courier: null,
    fulfillmentStatus: "SHIPPED",
    pickedAt: new Date(),
    pickedById: "u1",
    packedAt: new Date(),
    packedById: "u2",
    shippedAt: new Date(),
    shippedById: "u3",
    shipmentJubelioId: 99,
    courierId: 4,
    items: [],
  });
  (prisma.user.findMany as any).mockResolvedValue([
    { id: "u1", name: "Alice" },
    { id: "u2", name: "Bob" },
    { id: "u3", name: "Carol" },
  ]);
  (prisma.jubelioCourier.findUnique as any).mockResolvedValue({ id: 4, name: "SiCepat" });

  const r = await getSalesOrderById("so1");

  expect(r!.order.pickedByName).toBe("Alice");
  expect(r!.order.packedByName).toBe("Bob");
  expect(r!.order.shippedByName).toBe("Carol");
  expect(r!.order.courierName).toBe("SiCepat");
  expect(r!.order.fulfillmentStatus).toBe("SHIPPED");
});
```

Also extend the vi.mock at the top:

```ts
vi.mock("@elorae/db", () => ({
  prisma: {
    salesOrder: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn() },
    user: { findMany: vi.fn() },
    jubelioCourier: { findUnique: vi.fn() },
  },
}));
```

- [ ] **Step 3: Run tests, expect FAIL**

```bash
pnpm -F @elorae/web test -- queries.test.ts
```

Expected: FAIL on the new resolution case.

- [ ] **Step 4: Implement the resolution in `getSalesOrderById`**

In `queries.ts`, find the existing `getSalesOrderById`. Replace the body so that after the `findUnique`, it gathers the distinct user IDs and the courierId, then resolves names. Then folds them into the returned `order`:

```ts
export async function getSalesOrderById(
  id: string,
): Promise<{ order: SalesOrderDetail; items: SalesOrderItemRow[] } | null> {
  const row = await prisma.salesOrder.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!row) return null;

  const userIds = [row.pickedById, row.packedById, row.shippedById].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const distinctUserIds = Array.from(new Set(userIds));

  const [users, courier] = await Promise.all([
    distinctUserIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: distinctUserIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string | null }>),
    row.courierId !== null && row.courierId !== undefined
      ? prisma.jubelioCourier.findUnique({ where: { id: row.courierId } })
      : Promise.resolve(null),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name ?? null]));

  const order: SalesOrderDetail = {
    // ... existing fields kept exactly as before ...
    id: row.id,
    salesorderId: row.salesorderId,
    salesorderNo: row.salesorderNo,
    channel: row.channel as SalesChannel,
    sourceName: row.sourceName,
    status: row.status as SalesOrderStatus,
    channelStatus: row.channelStatus,
    internalStatus: row.internalStatus,
    wmsStatus: row.wmsStatus,
    isCanceled: row.isCanceled,
    isPaid: row.isPaid,
    markedAsComplete: row.markedAsComplete,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    shippingProvince: row.shippingProvince,
    shippingCity: row.shippingCity,
    shippingAddress: row.shippingAddress as Record<string, string | null> | null,
    subTotal: row.subTotal.toString(),
    totalDisc: row.totalDisc.toString(),
    totalTax: row.totalTax.toString(),
    shippingCost: row.shippingCost.toString(),
    grandTotal: row.grandTotal.toString(),
    feeBreakdown: row.feeBreakdown as Record<string, string> | null,
    paymentMethod: row.paymentMethod,
    paymentDate: row.paymentDate,
    transactionDate: row.transactionDate,
    createdDateJubelio: row.createdDateJubelio,
    completedDate: row.completedDate,
    cancelDate: row.cancelDate,
    lastModifiedJubelio: row.lastModifiedJubelio,
    trackingNumber: row.trackingNumber,
    courier: row.courier,
    // new fields:
    fulfillmentStatus: row.fulfillmentStatus as SalesOrderFulfillmentStatus,
    pickedAt: row.pickedAt,
    pickedById: row.pickedById,
    pickedByName: row.pickedById ? nameById.get(row.pickedById) ?? null : null,
    packedAt: row.packedAt,
    packedById: row.packedById,
    packedByName: row.packedById ? nameById.get(row.packedById) ?? null : null,
    shippedAt: row.shippedAt,
    shippedById: row.shippedById,
    shippedByName: row.shippedById ? nameById.get(row.shippedById) ?? null : null,
    courierId: row.courierId,
    courierName: courier?.name ?? null,
    shipmentJubelioId: row.shipmentJubelioId,
  };

  // existing items mapping unchanged:
  const items: SalesOrderItemRow[] = row.items.map((it: any) => ({
    id: it.id,
    salesorderDetailId: it.salesorderDetailId,
    jubelioItemId: it.jubelioItemId,
    jubelioItemCode: it.jubelioItemCode,
    itemId: it.itemId,
    productName: it.productName,
    qty: it.qty.toString(),
    qtyInBase: it.qtyInBase.toString(),
    returnedQty: it.returnedQty.toString(),
    isCanceledItem: it.isCanceledItem,
    unitPrice: it.unitPrice.toString(),
    pricePaid: it.pricePaid.toString(),
    discAmount: it.discAmount.toString(),
    taxAmount: it.taxAmount.toString(),
    lineTotal: it.lineTotal.toString(),
    discMarketplace: it.discMarketplace.toString(),
    weightInGram: it.weightInGram.toString(),
  }));

  return { order, items };
}
```

Note: the existing `getSalesOrderById` body needs to be replaced — preserve every previous field exactly. Only ADD the new fields + the resolution Promise.all + the userIds extraction.

- [ ] **Step 5: Run tests, expect PASS**

```bash
pnpm -F @elorae/web test -- queries.test.ts
```

Expected: PASS, all existing cases plus the new audit-resolution case.

- [ ] **Step 6: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/sales-orders/queries.ts apps/web/lib/sales-orders/queries.test.ts
git commit -m "feat(web): SalesOrderDetail resolves fulfillment audit names + courier name"
```

---

## Task 7: Fulfillment server actions (TDD)

Three transition actions + one courier-list helper. All call sub-A's writer or hit the courier cache.

**Files:**
- Create: `apps/web/app/actions/sales-order-fulfillment.ts`
- Create: `apps/web/app/actions/sales-order-fulfillment.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/app/actions/sales-order-fulfillment.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    jubelioCourier: { count: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@elorae/db/sales-order-fulfillment-writer", () => ({
  markOrderPicked: vi.fn(),
  markOrderPacked: vi.fn(),
  markOrderShipped: vi.fn(),
  InvalidFulfillmentTransition: class InvalidFulfillmentTransition extends Error {
    code = "INVALID_FULFILLMENT_TRANSITION";
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/jubelio-couriers", () => ({ syncJubelioCouriers: vi.fn() }));

import { prisma } from "@elorae/db";
import {
  markOrderPicked,
  markOrderPacked,
  markOrderShipped,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { syncJubelioCouriers } from "@/app/actions/jubelio-couriers";
import {
  finishPickAction,
  finishPackAction,
  shipOrderAction,
  getCouriersForShipDialog,
} from "./sales-order-fulfillment";

const sessionWithFulfill = {
  user: { id: "u1", permissions: ["sales_orders:fulfill"] },
};
const sessionWithoutFulfill = {
  user: { id: "u1", permissions: ["sales_orders:view"] },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("finishPickAction", () => {
  it("happy path: calls markOrderPicked, revalidates, returns ok", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPicked as any).mockResolvedValue(undefined);

    const r = await finishPickAction("so1");

    expect(r).toEqual({ ok: true });
    expect(markOrderPicked).toHaveBeenCalledWith(prisma, { orderId: "so1", userId: "u1" });
    expect(revalidatePath).toHaveBeenCalledWith("/backoffice/sales-orders/so1");
  });

  it("returns ok:false on InvalidFulfillmentTransition", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPicked as any).mockRejectedValue(
      new InvalidFulfillmentTransition("Order so1 fulfillmentStatus is PICKED"),
    );

    const r = await finishPickAction("so1");

    expect(r).toEqual({ ok: false, reason: expect.stringContaining("PICKED") });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("throws 403 when user lacks sales_orders:fulfill", async () => {
    (auth as any).mockResolvedValue(sessionWithoutFulfill);

    await expect(finishPickAction("so1")).rejects.toThrow(/Forbidden|Insufficient/);
  });

  it("throws when no session", async () => {
    (auth as any).mockResolvedValue(null);
    await expect(finishPickAction("so1")).rejects.toThrow(/Unauthorized/);
  });
});

describe("finishPackAction", () => {
  it("calls markOrderPacked", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPacked as any).mockResolvedValue(undefined);

    await finishPackAction("so1");

    expect(markOrderPacked).toHaveBeenCalledWith(prisma, { orderId: "so1", userId: "u1" });
  });
});

describe("shipOrderAction", () => {
  it("passes courierId to markOrderShipped", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderShipped as any).mockResolvedValue(undefined);

    await shipOrderAction("so1", 4);

    expect(markOrderShipped).toHaveBeenCalledWith(prisma, {
      orderId: "so1",
      userId: "u1",
      courierId: 4,
    });
  });
});

describe("getCouriersForShipDialog", () => {
  it("returns cached list when JubelioCourier table is non-empty", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.jubelioCourier.count as any).mockResolvedValue(5);
    (prisma.jubelioCourier.findMany as any).mockResolvedValue([
      { id: 1, name: "JNE" },
      { id: 2, name: "J&T" },
    ]);

    const list = await getCouriersForShipDialog();

    expect(syncJubelioCouriers).not.toHaveBeenCalled();
    expect(list).toEqual([
      { id: 1, name: "JNE" },
      { id: 2, name: "J&T" },
    ]);
  });

  it("triggers sync when cache is empty, then returns fresh list", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.jubelioCourier.count as any).mockResolvedValueOnce(0);
    (syncJubelioCouriers as any).mockResolvedValue({ count: 2 });
    (prisma.jubelioCourier.findMany as any).mockResolvedValue([
      { id: 1, name: "JNE" },
      { id: 2, name: "J&T" },
    ]);

    const list = await getCouriersForShipDialog();

    expect(syncJubelioCouriers).toHaveBeenCalledTimes(1);
    expect(list).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm -F @elorae/web test -- sales-order-fulfillment.spec.ts
```

Expected: FAIL with `Cannot find module './sales-order-fulfillment'`.

- [ ] **Step 3: Implement the server actions**

`apps/web/app/actions/sales-order-fulfillment.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import {
  markOrderPicked,
  markOrderPacked,
  markOrderShipped,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { syncJubelioCouriers } from "@/app/actions/jubelio-couriers";

export type FulfillmentActionResult = { ok: true } | { ok: false; reason: string };
export type CourierOption = { id: number; name: string };

async function requireFulfillSession(): Promise<{ userId: string }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SALES_ORDERS_FULFILL);
  return { userId: session.user.id };
}

export async function finishPickAction(orderId: string): Promise<FulfillmentActionResult> {
  const { userId } = await requireFulfillSession();
  try {
    await markOrderPicked(prisma, { orderId, userId });
  } catch (err) {
    if (err instanceof InvalidFulfillmentTransition) {
      return { ok: false, reason: err.message };
    }
    throw err;
  }
  revalidatePath(`/backoffice/sales-orders/${orderId}`);
  return { ok: true };
}

export async function finishPackAction(orderId: string): Promise<FulfillmentActionResult> {
  const { userId } = await requireFulfillSession();
  try {
    await markOrderPacked(prisma, { orderId, userId });
  } catch (err) {
    if (err instanceof InvalidFulfillmentTransition) {
      return { ok: false, reason: err.message };
    }
    throw err;
  }
  revalidatePath(`/backoffice/sales-orders/${orderId}`);
  return { ok: true };
}

export async function shipOrderAction(
  orderId: string,
  courierId: number,
): Promise<FulfillmentActionResult> {
  const { userId } = await requireFulfillSession();
  try {
    await markOrderShipped(prisma, { orderId, userId, courierId });
  } catch (err) {
    if (err instanceof InvalidFulfillmentTransition) {
      return { ok: false, reason: err.message };
    }
    throw err;
  }
  revalidatePath(`/backoffice/sales-orders/${orderId}`);
  return { ok: true };
}

export async function getCouriersForShipDialog(): Promise<CourierOption[]> {
  await requireFulfillSession();

  const count = await prisma.jubelioCourier.count();
  if (count === 0) {
    await syncJubelioCouriers();
  }

  const rows = await prisma.jubelioCourier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows;
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm -F @elorae/web test -- sales-order-fulfillment.spec.ts
```

Expected: PASS, all 7 cases.

- [ ] **Step 5: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/actions/sales-order-fulfillment.ts apps/web/app/actions/sales-order-fulfillment.spec.ts
git commit -m "feat(web): server actions for fulfillment transitions + courier dialog"
```

---

## Task 8: i18n keys (en + id)

Adds the `salesOrders.fulfillment.*` namespace to both message files.

**Files:**
- Modify: `apps/web/lib/i18n/messages/en.json`
- Modify: `apps/web/lib/i18n/messages/id.json`

- [ ] **Step 1: Find the existing salesOrders namespace in en.json**

```bash
grep -n "\"salesOrders\": {" apps/web/lib/i18n/messages/en.json
```

The namespace starts at the matched line. Locate its closing `}` to find the insertion point.

- [ ] **Step 2: Add the fulfillment block in en.json**

Inside the `salesOrders` object (just before its closing `}`), add a trailing comma to the previous key if needed, then insert:

```json
    "fulfillment": {
      "section": "Fulfillment",
      "status": "Status",
      "statusValues": {
        "PENDING": "Pending",
        "PICKED": "Picked",
        "PACKED": "Packed",
        "SHIPPED": "Shipped"
      },
      "timeline": "Timeline",
      "timelinePicked": "Picked",
      "timelinePacked": "Packed",
      "timelineShipped": "Shipped",
      "tracking": "Tracking",
      "byUser": "by {name}",
      "cancelledLocked": "Cancelled — fulfillment locked.",
      "action": {
        "finishPick": "Finish Pick",
        "finishPack": "Finish Pack",
        "ship": "Ship",
        "courier": "Courier",
        "courierPlaceholder": "Select courier…",
        "shipConfirmTitle": "Ship this order?",
        "shipConfirmBody": "Jubelio will request the AWB from {courier}. This action cannot be undone.",
        "shipConfirmOk": "Ship",
        "shipConfirmCancel": "Cancel"
      },
      "toast": {
        "success": "Action completed.",
        "invalidTransition": "Status already changed. Refresh the page.",
        "forbidden": "Insufficient permissions.",
        "networkError": "Couldn't reach the server. Try again."
      }
    }
```

- [ ] **Step 3: Add the SAME block to id.json with Indonesian strings**

In `apps/web/lib/i18n/messages/id.json`, find the `salesOrders` namespace and add:

```json
    "fulfillment": {
      "section": "Pemenuhan",
      "status": "Status",
      "statusValues": {
        "PENDING": "Menunggu",
        "PICKED": "Sudah diambil",
        "PACKED": "Sudah dikemas",
        "SHIPPED": "Sudah dikirim"
      },
      "timeline": "Linimasa",
      "timelinePicked": "Diambil",
      "timelinePacked": "Dikemas",
      "timelineShipped": "Dikirim",
      "tracking": "No. Resi",
      "byUser": "oleh {name}",
      "cancelledLocked": "Dibatalkan — pemenuhan dikunci.",
      "action": {
        "finishPick": "Selesai Pick",
        "finishPack": "Selesai Pack",
        "ship": "Kirim",
        "courier": "Kurir",
        "courierPlaceholder": "Pilih kurir…",
        "shipConfirmTitle": "Kirim pesanan ini?",
        "shipConfirmBody": "Jubelio akan meminta resi dari {courier}. Aksi ini tidak bisa dibatalkan.",
        "shipConfirmOk": "Kirim",
        "shipConfirmCancel": "Batal"
      },
      "toast": {
        "success": "Berhasil.",
        "invalidTransition": "Status sudah berubah. Muat ulang halaman.",
        "forbidden": "Akses tidak diizinkan.",
        "networkError": "Gagal terhubung ke server. Coba lagi."
      }
    }
```

- [ ] **Step 4: Verify both files parse**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/en.json'));"
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/id.json'));"
```

Both must exit 0.

- [ ] **Step 5: Type-check (next-intl validates parity)**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/i18n/messages/en.json apps/web/lib/i18n/messages/id.json
git commit -m "i18n: fulfillment UI strings (en + id)"
```

---

## Task 9: Fulfillment Card component + wire into detail page

The user-facing piece. Card with status badge + audit timeline + state-aware action button(s) + confirmation dialog for Ship + sonner toasts.

**Files:**
- Create: `apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx`
- Modify: `apps/web/app/backoffice/sales-orders/[id]/SalesOrderDetailClient.tsx`

- [ ] **Step 1: Implement the Fulfillment Card**

`apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SalesOrderFulfillmentStatus } from "@/lib/constants/enums";
import { formatDateTime } from "@/lib/sales-orders/format";
import {
  finishPickAction,
  finishPackAction,
  shipOrderAction,
  getCouriersForShipDialog,
  type CourierOption,
  type FulfillmentActionResult,
} from "@/app/actions/sales-order-fulfillment";

const STATUS_TAILWIND: Record<SalesOrderFulfillmentStatus, string> = {
  PENDING: "bg-zinc-100 text-zinc-700 border-zinc-200",
  PICKED: "bg-amber-100 text-amber-800 border-amber-200",
  PACKED: "bg-blue-100 text-blue-800 border-blue-200",
  SHIPPED: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

type Props = {
  orderId: string;
  salesorderNo: string;
  fulfillmentStatus: SalesOrderFulfillmentStatus;
  isLocked: boolean; // status IN (CANCELLED, RETURNED)
  canFulfill: boolean; // session has sales_orders:fulfill
  pickedAt: Date | null;
  pickedByName: string | null;
  packedAt: Date | null;
  packedByName: string | null;
  shippedAt: Date | null;
  shippedByName: string | null;
  trackingNumber: string | null;
  courierName: string | null;
};

export function FulfillmentCard(props: Props) {
  const t = useTranslations("salesOrders.fulfillment");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [couriersLoaded, setCouriersLoaded] = useState(false);
  const [selectedCourier, setSelectedCourier] = useState<number | null>(null);
  const [shipDialogOpen, setShipDialogOpen] = useState(false);

  function handleResult(r: FulfillmentActionResult): void {
    if (r.ok) {
      toast.success(t("toast.success"));
    } else {
      toast.warning(t("toast.invalidTransition"));
    }
  }

  function callAction(promise: Promise<FulfillmentActionResult>): void {
    startTransition(async () => {
      try {
        const r = await promise;
        handleResult(r);
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message.includes("Forbidden") || message.includes("Insufficient")) {
          toast.error(t("toast.forbidden"));
        } else {
          toast.error(t("toast.networkError"));
        }
      }
    });
  }

  async function openShipDialog(): Promise<void> {
    if (!couriersLoaded) {
      try {
        const list = await getCouriersForShipDialog();
        setCouriers(list);
        setCouriersLoaded(true);
      } catch {
        toast.error(t("toast.networkError"));
        return;
      }
    }
    setShipDialogOpen(true);
  }

  const selectedCourierName =
    selectedCourier !== null
      ? couriers.find((c) => c.id === selectedCourier)?.name ?? ""
      : "";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("section")}</h2>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_TAILWIND[props.fulfillmentStatus]}`}
        >
          {t(`statusValues.${props.fulfillmentStatus}` as never)}
        </span>
      </div>

      <div className="space-y-1 text-sm">
        <TimelineRow
          label={t("timelinePicked")}
          at={props.pickedAt}
          by={props.pickedByName}
          locale={locale}
          t={t}
        />
        <TimelineRow
          label={t("timelinePacked")}
          at={props.packedAt}
          by={props.packedByName}
          locale={locale}
          t={t}
        />
        <TimelineRow
          label={t("timelineShipped")}
          at={props.shippedAt}
          by={props.shippedByName}
          locale={locale}
          t={t}
        />
      </div>

      {(props.trackingNumber || props.courierName) && (
        <div className="text-sm pt-2 border-t">
          <span className="text-muted-foreground">{t("tracking")}: </span>
          <span className="font-mono">
            {props.courierName ? `${props.courierName} · ` : ""}
            {props.trackingNumber ?? "—"}
          </span>
        </div>
      )}

      {props.isLocked ? (
        <div className="text-sm text-muted-foreground italic">{t("cancelledLocked")}</div>
      ) : props.canFulfill ? (
        <div className="pt-2 border-t">
          {props.fulfillmentStatus === "PENDING" && (
            <Button
              disabled={isPending}
              onClick={() => callAction(finishPickAction(props.orderId))}
            >
              {t("action.finishPick")}
            </Button>
          )}
          {props.fulfillmentStatus === "PICKED" && (
            <Button
              disabled={isPending}
              onClick={() => callAction(finishPackAction(props.orderId))}
            >
              {t("action.finishPack")}
            </Button>
          )}
          {props.fulfillmentStatus === "PACKED" && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground mb-1 block">
                  {t("action.courier")}
                </label>
                <Select
                  value={selectedCourier !== null ? String(selectedCourier) : ""}
                  onValueChange={(v) => setSelectedCourier(Number(v))}
                  onOpenChange={(open) => {
                    if (open && !couriersLoaded) {
                      void openShipDialog().then(() => setShipDialogOpen(false));
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("action.courierPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {couriers.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={isPending || selectedCourier === null}
                onClick={() => setShipDialogOpen(true)}
              >
                {t("action.ship")}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <AlertDialog open={shipDialogOpen} onOpenChange={setShipDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("action.shipConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("action.shipConfirmBody", { courier: selectedCourierName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("action.shipConfirmCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedCourier !== null) {
                  callAction(shipOrderAction(props.orderId, selectedCourier));
                }
              }}
            >
              {t("action.shipConfirmOk")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function TimelineRow({
  label,
  at,
  by,
  locale,
  t,
}: {
  label: string;
  at: Date | null;
  by: string | null;
  locale: string;
  t: ReturnType<typeof useTranslations<"salesOrders.fulfillment">>;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>
        {at ? formatDateTime(at, locale) : "—"}
        {by ? <span className="text-muted-foreground ml-2">{t("byUser", { name: by })}</span> : null}
      </span>
    </div>
  );
}
```

The Select component uses `onOpenChange` to lazy-trigger the courier sync the first time it opens. The `selectedCourier` state holds the chosen id; the AlertDialog confirms before firing `shipOrderAction`.

The `t.has` style isn't available reliably across `next-intl` versions, so `t(\`statusValues.${props.fulfillmentStatus}\` as never)` uses the documented "as never" cast precedent from sub-B's earlier client components.

- [ ] **Step 2: Wire into `SalesOrderDetailClient.tsx`**

Open `apps/web/app/backoffice/sales-orders/[id]/SalesOrderDetailClient.tsx`. The page currently receives `{ order, items }` props (from sub-B's PR #44). Add a new `canFulfill: boolean` prop and pass `fulfillmentStatus` etc. through to the card.

The component's props type is currently:

```tsx
type Props = { order: SalesOrderDetail; items: SalesOrderItemRow[] };
```

Expand to:

```tsx
type Props = {
  order: SalesOrderDetail;
  items: SalesOrderItemRow[];
  canFulfill: boolean;
};
```

Destructure `canFulfill` in the component signature.

Add the import at the top:

```tsx
import { FulfillmentCard } from "./FulfillmentCard";
```

Inside the JSX, insert the FulfillmentCard between the header strip and the existing first row of cards. Looking at the file structure, the header strip ends with the status badge `<span>` and the next element is the `<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">` containing the Buyer + Order meta cards. Insert immediately before that grid:

```tsx
      <FulfillmentCard
        orderId={order.id}
        salesorderNo={order.salesorderNo}
        fulfillmentStatus={order.fulfillmentStatus}
        isLocked={order.isCanceled || order.status === "CANCELLED" || order.status === "RETURNED"}
        canFulfill={canFulfill}
        pickedAt={order.pickedAt}
        pickedByName={order.pickedByName}
        packedAt={order.packedAt}
        packedByName={order.packedByName}
        shippedAt={order.shippedAt}
        shippedByName={order.shippedByName}
        trackingNumber={order.trackingNumber}
        courierName={order.courierName}
      />
```

- [ ] **Step 3: Pass `canFulfill` from the server page**

Open `apps/web/app/backoffice/sales-orders/[id]/page.tsx`. Currently it does:

```tsx
return <SalesOrderDetailClient order={data.order} items={data.items} />;
```

Change to:

```tsx
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

// ... existing ...

const canFulfill = hasPermission(
  session.user.permissions ?? [],
  PERMISSIONS.SALES_ORDERS_FULFILL,
);
return <SalesOrderDetailClient order={data.order} items={data.items} canFulfill={canFulfill} />;
```

- [ ] **Step 4: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 5: Run full web tests**

```bash
pnpm -F @elorae/web test
```

Expected: all green (no test changes; queries + fulfillment-actions already covered earlier).

- [ ] **Step 6: Manual smoke**

User starts the dev server (per `feedback_service_control`):

```bash
pnpm -F @elorae/web dev
```

Then navigate to a real order detail page. Expected:
- Fulfillment card renders with PENDING badge + empty timeline + Finish Pick button.
- Clicking Finish Pick fires a server action, toast appears, refresh → status is PICKED, timeline shows your name.
- The corresponding `JubelioOutbox` row exists with `entityType=salesorder_pick` (verify via Prisma Studio or direct SQL).

This is manual verification. Don't block on apps/api processing — that depends on Jubelio being reachable, which is out of scope for sub-B.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx apps/web/app/backoffice/sales-orders/[id]/SalesOrderDetailClient.tsx apps/web/app/backoffice/sales-orders/[id]/page.tsx
git commit -m "feat(web): Fulfillment card on sales order detail with Pick/Pack/Ship actions"
```

---

## Smoke test path (post-merge, not a task)

After the branch merges:

1. User runs `pnpm -F @elorae/db migrate:deploy` to apply the JubelioCourier migration.
2. User runs `pnpm -F @elorae/db seed` (or assigns manually via RBAC admin UI) to register the `sales_orders:fulfill` permission.
3. Open `/backoffice/sales-orders/<some-pending-order>`. Verify card.
4. Click Finish Pick. Verify toast. Reload. Status PICKED, timeline shows user.
5. Click Finish Pack. Same flow.
6. Click Ship → courier dropdown loads (first click triggers sync), pick a courier, confirm dialog, submit. Verify outbox row created.
7. Observe outbox poller in apps/api logs. The handler will hit Jubelio's real endpoint — that's the FIRST live Jubelio touch in EPIC-04. Capture the error response shape (if any) and fix-forward `isAlreadyInStateError` in sub-A's three handlers.

If apps/api is NOT running or Jubelio is down, the outbox row stays PENDING. That's fine — re-runs once apps/api comes back.

## Out-of-scope follow-ups

- Sub-C: Fulfillment Queue page (filter by `fulfillmentStatus`, batch enqueue).
- Sub-D: Print views (pick list, packing slip) + manual "Sync couriers" button on `/backoffice/jubelio/admin`.
- Sub-A-followup: fix `isAlreadyInStateError` once a real Jubelio error shape is observed during sub-B's post-merge smoke.
- AWB display already wired: sub-A's webhook handler writes `trackingNumber` + `courier` when Jubelio relays the AWB. The Fulfillment card reads these from `SalesOrderDetail` and shows them under "Tracking:".
