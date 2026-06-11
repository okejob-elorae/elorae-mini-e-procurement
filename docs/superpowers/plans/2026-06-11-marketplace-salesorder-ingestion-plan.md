# Marketplace Sales Order Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Jubelio `salesorder` webhook handler to persist a denormalized local copy of each marketplace order as `SalesOrder` + `SalesOrderItem`, so future UI slices (dashboard, detail, KPI) have a queryable data layer.

**Architecture:** New Prisma tables `SalesOrder` + `SalesOrderItem` in `@elorae/db`. Handler upsert runs inside the same `$transaction` block as the existing stock-state update. Channel detection and status derivation are pure helpers tested in isolation. A small `_shared/mapping-lookup.ts` helper deduplicates the `jubelioItemId → JubelioProductMapping` lookup used by both the existing stock loop and the new line builder.

**Tech Stack:** Prisma 7 (MariaDB/TiDB), NestJS 11, Jest, TypeScript. No frontend code in this sub-project.

**Spec:** `docs/superpowers/specs/2026-06-11-marketplace-salesorder-ingestion-design.md`

---

## File Structure

**New files:**

```
packages/db/prisma/migrations/20260611120000_add_sales_order_tables/migration.sql

apps/api/src/jubelio/handlers/_shared/channel-detect.ts
apps/api/src/jubelio/handlers/_shared/channel-detect.spec.ts
apps/api/src/jubelio/handlers/_shared/status-derive.ts
apps/api/src/jubelio/handlers/_shared/status-derive.spec.ts
apps/api/src/jubelio/handlers/_shared/mapping-lookup.ts
apps/api/src/jubelio/handlers/_shared/mapping-lookup.spec.ts
```

**Modified files:**

```
packages/db/prisma/schema.prisma                                 # extend enum + 2 new models
apps/api/src/jubelio/handlers/salesorder.payload.ts              # widen payload type
apps/api/src/jubelio/handlers/salesorder.handler.ts              # add upsertSalesOrder + wire mapping-lookup helper
apps/api/src/jubelio/handlers/salesorder.handler.spec.ts         # add new test cases
docs/BOUNDARY.md                                                 # add §3 ownership row
```

**Reused (no modification):**

- `apps/api/src/db/prisma.module.ts` — PRISMA token, PrismaService type.
- `apps/api/src/admin/notification.service.ts` — already injected.
- `apps/api/src/jubelio/queue/webhook-status.ts` — SKIP_REASONS table.
- `apps/api/src/jubelio/queue/event-router.ts` — already routes `salesorder` events to the handler.
- `JubelioSalesOrderState` (sub-4) — untouched. Stock-state machine continues unchanged.

---

## Task 1: Schema + migration

Add `TOKOPEDIA` + `OTHER` to `SalesChannel`, add `SalesOrderStatus` enum, add `SalesOrder` + `SalesOrderItem` models, hand-author the migration SQL, regenerate the Prisma client, rebuild `@elorae/db`. The user (NOT the implementer) runs `migrate:deploy` against the shared TiDB.

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260611120000_add_sales_order_tables/migration.sql`

- [ ] **Step 1: Find the `SalesChannel` enum block in `schema.prisma` and extend it**

Locate:

```prisma
enum SalesChannel {
  SHOPEE
  TIKTOK
}
```

Replace with:

```prisma
enum SalesChannel {
  SHOPEE
  TIKTOK
  TOKOPEDIA
  OTHER
}
```

- [ ] **Step 2: Add the `SalesOrderStatus` enum directly below `SalesChannel`**

```prisma
enum SalesOrderStatus {
  NEW
  PROCESSING
  SHIPPED
  COMPLETED
  CANCELLED
  RETURNED
}
```

- [ ] **Step 3: Add the `SalesOrder` model**

Append at the end of `schema.prisma` (after the last existing model, before the trailing newline):

```prisma
model SalesOrder {
  id                  String           @id @default(cuid())
  salesorderId        Int              @unique
  salesorderNo        String
  channel             SalesChannel
  sourceName          String
  status              SalesOrderStatus
  channelStatus       String?
  internalStatus      String?
  wmsStatus           String?
  isCanceled          Boolean          @default(false)
  isPaid              Boolean          @default(false)
  markedAsComplete    Boolean          @default(false)
  customerName        String?
  customerPhone       String?
  customerEmail       String?
  shippingProvince    String?
  shippingCity        String?
  shippingAddress     Json?
  subTotal            Decimal          @db.Decimal(15, 2)
  totalDisc           Decimal          @db.Decimal(15, 2)
  totalTax            Decimal          @db.Decimal(15, 2)
  shippingCost        Decimal          @db.Decimal(15, 2)
  grandTotal          Decimal          @db.Decimal(15, 2)
  feeBreakdown        Json?
  paymentMethod       String?
  paymentDate         DateTime?
  transactionDate     DateTime
  createdDateJubelio  DateTime?
  completedDate       DateTime?
  cancelDate          DateTime?
  lastModifiedJubelio DateTime?
  trackingNumber      String?
  courier             String?
  lastWebhookEventId  String?
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt
  items               SalesOrderItem[]

  @@index([channel])
  @@index([status])
  @@index([transactionDate])
  @@index([shippingProvince])
  @@index([shippingCity])
}
```

- [ ] **Step 4: Add the `SalesOrderItem` model directly below `SalesOrder`**

```prisma
model SalesOrderItem {
  id                 String     @id @default(cuid())
  salesOrderId       String
  salesorderDetailId Int        @unique
  jubelioItemId      Int
  jubelioItemCode    String
  itemId             String?
  productName        String
  qty                Decimal    @db.Decimal(15, 4)
  qtyInBase          Decimal    @db.Decimal(15, 4)
  returnedQty        Decimal    @db.Decimal(15, 4) @default(0)
  isCanceledItem     Boolean    @default(false)
  unitPrice          Decimal    @db.Decimal(15, 2)
  pricePaid          Decimal    @db.Decimal(15, 2)
  discAmount         Decimal    @db.Decimal(15, 2)
  taxAmount          Decimal    @db.Decimal(15, 2)
  lineTotal          Decimal    @db.Decimal(15, 2)
  discMarketplace    Decimal    @db.Decimal(15, 2) @default(0)
  weightInGram       Decimal    @db.Decimal(15, 4) @default(0)
  salesOrder         SalesOrder @relation(fields: [salesOrderId], references: [id], onDelete: Cascade)

  @@index([itemId])
  @@index([jubelioItemCode])
}
```

- [ ] **Step 5: Hand-author the migration SQL**

`pnpm prisma migrate dev` is FORBIDDEN against the shared TiDB (CLAUDE.md). Create the migration directory and file by hand.

```bash
mkdir -p packages/db/prisma/migrations/20260611120000_add_sales_order_tables
```

Create `packages/db/prisma/migrations/20260611120000_add_sales_order_tables/migration.sql`:

```sql
-- AlterEnum
ALTER TABLE `SalesHistory` MODIFY `channel` ENUM('SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'OTHER') NOT NULL;

-- CreateTable
CREATE TABLE `SalesOrder` (
    `id` VARCHAR(191) NOT NULL,
    `salesorderId` INTEGER NOT NULL,
    `salesorderNo` VARCHAR(191) NOT NULL,
    `channel` ENUM('SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'OTHER') NOT NULL,
    `sourceName` VARCHAR(191) NOT NULL,
    `status` ENUM('NEW', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'RETURNED') NOT NULL,
    `channelStatus` VARCHAR(191) NULL,
    `internalStatus` VARCHAR(191) NULL,
    `wmsStatus` VARCHAR(191) NULL,
    `isCanceled` BOOLEAN NOT NULL DEFAULT false,
    `isPaid` BOOLEAN NOT NULL DEFAULT false,
    `markedAsComplete` BOOLEAN NOT NULL DEFAULT false,
    `customerName` VARCHAR(191) NULL,
    `customerPhone` VARCHAR(191) NULL,
    `customerEmail` VARCHAR(191) NULL,
    `shippingProvince` VARCHAR(191) NULL,
    `shippingCity` VARCHAR(191) NULL,
    `shippingAddress` JSON NULL,
    `subTotal` DECIMAL(15, 2) NOT NULL,
    `totalDisc` DECIMAL(15, 2) NOT NULL,
    `totalTax` DECIMAL(15, 2) NOT NULL,
    `shippingCost` DECIMAL(15, 2) NOT NULL,
    `grandTotal` DECIMAL(15, 2) NOT NULL,
    `feeBreakdown` JSON NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `paymentDate` DATETIME(3) NULL,
    `transactionDate` DATETIME(3) NOT NULL,
    `createdDateJubelio` DATETIME(3) NULL,
    `completedDate` DATETIME(3) NULL,
    `cancelDate` DATETIME(3) NULL,
    `lastModifiedJubelio` DATETIME(3) NULL,
    `trackingNumber` VARCHAR(191) NULL,
    `courier` VARCHAR(191) NULL,
    `lastWebhookEventId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesOrder_salesorderId_key`(`salesorderId`),
    INDEX `SalesOrder_channel_idx`(`channel`),
    INDEX `SalesOrder_status_idx`(`status`),
    INDEX `SalesOrder_transactionDate_idx`(`transactionDate`),
    INDEX `SalesOrder_shippingProvince_idx`(`shippingProvince`),
    INDEX `SalesOrder_shippingCity_idx`(`shippingCity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesOrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `salesorderDetailId` INTEGER NOT NULL,
    `jubelioItemId` INTEGER NOT NULL,
    `jubelioItemCode` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `productName` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(15, 4) NOT NULL,
    `qtyInBase` DECIMAL(15, 4) NOT NULL,
    `returnedQty` DECIMAL(15, 4) NOT NULL DEFAULT 0,
    `isCanceledItem` BOOLEAN NOT NULL DEFAULT false,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `pricePaid` DECIMAL(15, 2) NOT NULL,
    `discAmount` DECIMAL(15, 2) NOT NULL,
    `taxAmount` DECIMAL(15, 2) NOT NULL,
    `lineTotal` DECIMAL(15, 2) NOT NULL,
    `discMarketplace` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `weightInGram` DECIMAL(15, 4) NOT NULL DEFAULT 0,

    UNIQUE INDEX `SalesOrderItem_salesorderDetailId_key`(`salesorderDetailId`),
    INDEX `SalesOrderItem_itemId_idx`(`itemId`),
    INDEX `SalesOrderItem_jubelioItemCode_idx`(`jubelioItemCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SalesOrderItem` ADD CONSTRAINT `SalesOrderItem_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 6: Regenerate Prisma client and rebuild `@elorae/db`**

```bash
pnpm -F @elorae/db generate
pnpm -F @elorae/db build
```

Expected: both commands exit 0. `packages/db/dist/` now has `SalesOrder` and `SalesOrderItem` types exported.

- [ ] **Step 7: Type-check the api package against new types**

```bash
pnpm -F @elorae/api type-check
```

Expected: PASS. Existing code does not reference the new models yet.

- [ ] **Step 8: DO NOT run `migrate:deploy` yourself**

Stop. Tell the user the migration is ready. The user runs:

```bash
pnpm -F @elorae/db migrate:deploy
```

Per `feedback_service_control` memory — Claude only tells WHEN, user runs the destructive command.

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260611120000_add_sales_order_tables
git commit -m "feat(db): add SalesOrder + SalesOrderItem tables"
```

---

## Task 2: Channel detection helper (TDD)

Pure function. `source_name` string → `SalesChannel` enum value. Unknown tokens map to `OTHER`. Empty / null inputs map to `OTHER`.

**Files:**
- Create: `apps/api/src/jubelio/handlers/_shared/channel-detect.ts`
- Create: `apps/api/src/jubelio/handlers/_shared/channel-detect.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/jubelio/handlers/_shared/channel-detect.spec.ts`:

```ts
import { detectChannel } from "./channel-detect";

describe("detectChannel", () => {
  it("maps Tokopedia source_name", () => {
    expect(detectChannel("Shop | Tokopedia")).toEqual({ channel: "TOKOPEDIA", unknown: false });
  });

  it("maps Shopee source_name", () => {
    expect(detectChannel("Shop | Shopee")).toEqual({ channel: "SHOPEE", unknown: false });
  });

  it("maps TikTok source_name (mixed case)", () => {
    expect(detectChannel("Shop | TikTok")).toEqual({ channel: "TIKTOK", unknown: false });
  });

  it("falls back to OTHER for unknown marketplace, flags unknown=true", () => {
    expect(detectChannel("Shop | Lazada")).toEqual({ channel: "OTHER", unknown: true });
  });

  it("falls back to OTHER for empty string", () => {
    expect(detectChannel("")).toEqual({ channel: "OTHER", unknown: true });
  });

  it("falls back to OTHER for null", () => {
    expect(detectChannel(null)).toEqual({ channel: "OTHER", unknown: true });
  });

  it("falls back to OTHER for undefined", () => {
    expect(detectChannel(undefined)).toEqual({ channel: "OTHER", unknown: true });
  });

  it("handles no separator (whole string is the token)", () => {
    expect(detectChannel("Tokopedia")).toEqual({ channel: "TOKOPEDIA", unknown: false });
  });

  it("strips whitespace and is case-insensitive", () => {
    expect(detectChannel("Shop |   shopee  ")).toEqual({ channel: "SHOPEE", unknown: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @elorae/api test -- channel-detect.spec.ts --runInBand
```

Expected: FAIL with `Cannot find module './channel-detect'`.

- [ ] **Step 3: Implement the helper**

`apps/api/src/jubelio/handlers/_shared/channel-detect.ts`:

```ts
import type { SalesChannel } from "@elorae/db";

const KNOWN: Record<string, SalesChannel> = {
  SHOPEE: "SHOPEE",
  TOKOPEDIA: "TOKOPEDIA",
  TIKTOK: "TIKTOK",
};

export function detectChannel(sourceName: string | null | undefined): {
  channel: SalesChannel;
  unknown: boolean;
} {
  if (!sourceName) return { channel: "OTHER", unknown: true };
  const parts = sourceName.split("|").map((s) => s.trim()).filter((s) => s.length > 0);
  const token = (parts[parts.length - 1] ?? "").toUpperCase();
  const channel = KNOWN[token];
  return channel ? { channel, unknown: false } : { channel: "OTHER", unknown: true };
}
```

- [ ] **Step 4: Run test to verify all 9 cases pass**

```bash
pnpm -F @elorae/api test -- channel-detect.spec.ts --runInBand
```

Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/handlers/_shared/channel-detect.ts apps/api/src/jubelio/handlers/_shared/channel-detect.spec.ts
git commit -m "feat(api): source_name to SalesChannel detection helper"
```

---

## Task 3: Status derivation helper (TDD)

Pure function. Maps a raw status bundle into `SalesOrderStatus`. Precedence per spec §5.2.

**Files:**
- Create: `apps/api/src/jubelio/handlers/_shared/status-derive.ts`
- Create: `apps/api/src/jubelio/handlers/_shared/status-derive.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/jubelio/handlers/_shared/status-derive.spec.ts`:

```ts
import { deriveStatus } from "./status-derive";

describe("deriveStatus", () => {
  it("CANCELLED when is_canceled true", () => {
    expect(deriveStatus({ is_canceled: true })).toBe("CANCELLED");
  });

  it("CANCELLED when internal_status is CANCELED (Jubelio spelling)", () => {
    expect(deriveStatus({ internal_status: "CANCELED" })).toBe("CANCELLED");
  });

  it("CANCELLED takes precedence over marked_as_complete", () => {
    expect(deriveStatus({ is_canceled: true, marked_as_complete: true })).toBe("CANCELLED");
  });

  it("COMPLETED when marked_as_complete true", () => {
    expect(deriveStatus({ marked_as_complete: true })).toBe("COMPLETED");
  });

  it("COMPLETED when internal_status COMPLETED", () => {
    expect(deriveStatus({ internal_status: "COMPLETED" })).toBe("COMPLETED");
  });

  it("COMPLETED when completed_date set", () => {
    expect(deriveStatus({ completed_date: "2026-06-11T00:00:00Z" })).toBe("COMPLETED");
  });

  it("SHIPPED when wms_status SHIPPED", () => {
    expect(deriveStatus({ wms_status: "SHIPPED" })).toBe("SHIPPED");
  });

  it("SHIPPED when is_shipped true", () => {
    expect(deriveStatus({ is_shipped: true })).toBe("SHIPPED");
  });

  it("PROCESSING for wms_status PROCESSING", () => {
    expect(deriveStatus({ wms_status: "PROCESSING" })).toBe("PROCESSING");
  });

  it("PROCESSING for wms_status PICKED", () => {
    expect(deriveStatus({ wms_status: "PICKED" })).toBe("PROCESSING");
  });

  it("PROCESSING for wms_status PACKED", () => {
    expect(deriveStatus({ wms_status: "PACKED" })).toBe("PROCESSING");
  });

  it("PROCESSING for wms_status READY_TO_PACK", () => {
    expect(deriveStatus({ wms_status: "READY_TO_PACK" })).toBe("PROCESSING");
  });

  it("PROCESSING for internal_status PROCESSING", () => {
    expect(deriveStatus({ internal_status: "PROCESSING" })).toBe("PROCESSING");
  });

  it("NEW when nothing else applies (empty input)", () => {
    expect(deriveStatus({})).toBe("NEW");
  });

  it("NEW when wms_status NEW", () => {
    expect(deriveStatus({ wms_status: "NEW" })).toBe("NEW");
  });

  it("COMPLETED overrides SHIPPED when both signaled", () => {
    expect(deriveStatus({ wms_status: "SHIPPED", marked_as_complete: true })).toBe("COMPLETED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @elorae/api test -- status-derive.spec.ts --runInBand
```

Expected: FAIL with `Cannot find module './status-derive'`.

- [ ] **Step 3: Implement the helper**

`apps/api/src/jubelio/handlers/_shared/status-derive.ts`:

```ts
import type { SalesOrderStatus } from "@elorae/db";

export type RawStatusInput = {
  is_canceled?: boolean | null;
  internal_status?: string | null;
  marked_as_complete?: boolean | null;
  completed_date?: string | null;
  wms_status?: string | null;
  is_shipped?: boolean | null;
};

const PROCESSING_WMS = new Set(["PROCESSING", "PICKED", "PACKED", "READY_TO_PACK"]);

export function deriveStatus(p: RawStatusInput): SalesOrderStatus {
  if (p.is_canceled === true || p.internal_status === "CANCELED") return "CANCELLED";
  if (p.marked_as_complete === true || p.internal_status === "COMPLETED" || p.completed_date) {
    return "COMPLETED";
  }
  if (p.wms_status === "SHIPPED" || p.is_shipped === true) return "SHIPPED";
  if ((p.wms_status && PROCESSING_WMS.has(p.wms_status)) || p.internal_status === "PROCESSING") {
    return "PROCESSING";
  }
  return "NEW";
}
```

- [ ] **Step 4: Run test to verify all 16 cases pass**

```bash
pnpm -F @elorae/api test -- status-derive.spec.ts --runInBand
```

Expected: PASS, 16/16.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/handlers/_shared/status-derive.ts apps/api/src/jubelio/handlers/_shared/status-derive.spec.ts
git commit -m "feat(api): salesorder status derivation helper"
```

---

## Task 4: Mapping lookup helper extraction (refactor)

The existing handler's stock loop has `await this.prisma.jubelioProductMapping.findFirst({ where: { jubelioItemId: line.item_id } })`. Extract it into a helper so the new `upsertSalesOrder` path can call the same code. Behavior unchanged.

**Files:**
- Create: `apps/api/src/jubelio/handlers/_shared/mapping-lookup.ts`
- Create: `apps/api/src/jubelio/handlers/_shared/mapping-lookup.spec.ts`
- Modify: `apps/api/src/jubelio/handlers/salesorder.handler.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/jubelio/handlers/_shared/mapping-lookup.spec.ts`:

```ts
import { resolveItemMapping } from "./mapping-lookup";

describe("resolveItemMapping", () => {
  it("returns the matching mapping when jubelioItemId is found", async () => {
    const mapping = { id: "m1", itemId: "i1", erpVariantSku: "SKU-A", jubelioItemId: 42, jubelioItemGroupId: 9, jubelioItemCode: "SKU-A" };
    const tx = {
      jubelioProductMapping: {
        findFirst: jest.fn().mockResolvedValue(mapping),
      },
    };
    const r = await resolveItemMapping(tx as any, 42);
    expect(r).toBe(mapping);
    expect(tx.jubelioProductMapping.findFirst).toHaveBeenCalledWith({ where: { jubelioItemId: 42 } });
  });

  it("returns null when no mapping matches", async () => {
    const tx = {
      jubelioProductMapping: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const r = await resolveItemMapping(tx as any, 999);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @elorae/api test -- mapping-lookup.spec.ts --runInBand
```

Expected: FAIL with `Cannot find module './mapping-lookup'`.

- [ ] **Step 3: Implement the helper**

`apps/api/src/jubelio/handlers/_shared/mapping-lookup.ts`:

```ts
import type { JubelioProductMapping } from "@elorae/db";

export type MappingFinder = {
  jubelioProductMapping: {
    findFirst: (args: { where: { jubelioItemId: number } }) => Promise<JubelioProductMapping | null>;
  };
};

export async function resolveItemMapping(
  tx: MappingFinder,
  jubelioItemId: number,
): Promise<JubelioProductMapping | null> {
  return tx.jubelioProductMapping.findFirst({ where: { jubelioItemId } });
}
```

Why a structural type rather than `PrismaService` or `Prisma.TransactionClient`: the helper needs to accept BOTH the outer `prisma` client (used by sub-4's stock loop in `applyAdjustments`) AND the transaction callback's `tx` parameter (used by the new `upsertSalesOrder`). The two have different type identities in Prisma. A minimal structural type covers both without coupling the helper to either.

- [ ] **Step 4: Run helper test, verify PASS**

```bash
pnpm -F @elorae/api test -- mapping-lookup.spec.ts --runInBand
```

Expected: PASS, 2/2.

- [ ] **Step 5: Refactor the stock loop to use the helper**

Open `apps/api/src/jubelio/handlers/salesorder.handler.ts`. Locate `private async applyAdjustments(...)`. Inside the `for (const line of items)` loop, find:

```ts
      const mapping = await this.prisma.jubelioProductMapping.findFirst({
        where: { jubelioItemId: line.item_id },
      });
```

Replace with:

```ts
      const mapping = await resolveItemMapping(this.prisma, line.item_id);
```

Add the import at the top:

```ts
import { resolveItemMapping } from "./_shared/mapping-lookup";
```

- [ ] **Step 6: Run full salesorder handler tests (sub-4 regression guard)**

```bash
pnpm -F @elorae/api test -- salesorder.handler.spec.ts --runInBand
```

Expected: PASS, all existing cases (no behavior change). If anything fails, the refactor introduced a bug — revert and re-do.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/jubelio/handlers/_shared/mapping-lookup.ts apps/api/src/jubelio/handlers/_shared/mapping-lookup.spec.ts apps/api/src/jubelio/handlers/salesorder.handler.ts
git commit -m "refactor(api): extract jubelio product mapping lookup helper"
```

---

## Task 5: Widen `SalesOrderPayload` type

Add every field the handler will consume from the Jubelio payload. Type-only change.

**Files:**
- Modify: `apps/api/src/jubelio/handlers/salesorder.payload.ts`

- [ ] **Step 1: Replace the file contents**

```ts
export type SalesOrderLine = {
  item_id: number;
  item_code: string;
  item_group_id: number;
  item_name?: string;
  qty: string | number;
  qty_in_base?: string | number | null;
  is_canceled_item?: boolean | null;
  salesorder_detail_id: number;
  sell_price?: string | number | null;
  price?: string | number | null;
  disc_amount?: string | number | null;
  tax_amount?: string | number | null;
  amount?: string | number | null;
  disc_marketplace?: string | number | null;
  discount_marketplace?: string | number | null;
  weight_in_gram?: string | number | null;
};

export type SalesOrderPayload = {
  action?: string;
  salesorder_id: number;
  salesorder_no?: string;
  channel_status?: string | null;
  internal_status?: string | null;
  wms_status?: string | null;
  is_canceled?: boolean | null;
  is_paid?: boolean | null;
  marked_as_complete?: boolean | null;
  is_shipped?: boolean | null;
  source?: number | null;
  source_name?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  shipping_full_name?: string | null;
  shipping_address?: string | null;
  shipping_area?: string | null;
  shipping_city?: string | null;
  shipping_province?: string | null;
  shipping_post_code?: string | null;
  shipping_country?: string | null;
  shipping_phone?: string | null;
  shipping_subdistrict?: string | null;
  sub_total?: string | number | null;
  total_disc?: string | number | null;
  total_tax?: string | number | null;
  grand_total?: string | number | null;
  shipping_cost?: string | number | null;
  insurance_cost?: string | number | null;
  add_fee?: string | number | null;
  add_disc?: string | number | null;
  service_fee?: string | number | null;
  escrow_amount?: string | number | null;
  voucher_amount?: string | number | null;
  cod_fee?: string | number | null;
  order_processing_fee?: string | number | null;
  shipping_tax?: string | number | null;
  total_amount_mp?: string | number | null;
  payment_method?: string | null;
  payment_date?: string | null;
  transaction_date?: string | null;
  created_date?: string | null;
  completed_date?: string | null;
  internal_cancel_date?: string | null;
  last_modified?: string | null;
  tracking_number?: string | null;
  courier?: string | null;
  items?: SalesOrderLine[];
};
```

- [ ] **Step 2: Type-check api package**

```bash
pnpm -F @elorae/api type-check
```

Expected: PASS. Existing handler code reads only `salesorder_id`, `salesorder_no`, `channel_status`, `is_canceled`, `items` — all still present. Nothing breaks.

- [ ] **Step 3: Run salesorder handler tests (existing fixtures still compile)**

```bash
pnpm -F @elorae/api test -- salesorder.handler.spec.ts --runInBand
```

Expected: PASS, unchanged.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/jubelio/handlers/salesorder.payload.ts
git commit -m "feat(api): widen salesorder payload type to expose dashboard fields"
```

---

## Task 6: `upsertSalesOrder` happy path

Wire the upsert logic into the existing handler. First the happy-path test, then the implementation.

**Files:**
- Modify: `apps/api/src/jubelio/handlers/salesorder.handler.spec.ts`
- Modify: `apps/api/src/jubelio/handlers/salesorder.handler.ts`

- [ ] **Step 1: Inspect the existing spec file to understand the mock shape**

```bash
head -120 apps/api/src/jubelio/handlers/salesorder.handler.spec.ts
```

You'll see the existing `prisma` mock with `jubelioSalesOrderState`, `jubelioProductMapping`, `inventoryValue` etc. The `$transaction` mock receives a callback and passes a tx-shaped object. We need to add `salesOrder` and `salesOrderItem` mock methods on both `prisma` (outer) and the tx object passed to `$transaction`.

- [ ] **Step 2: Add `salesOrder` + `salesOrderItem` mocks to the test file's prisma factory**

Locate the `makePrisma` (or similar) helper in `salesorder.handler.spec.ts`. Add to the returned object:

```ts
salesOrder: {
  upsert: jest.fn(),
},
salesOrderItem: {
  deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  createMany: jest.fn().mockResolvedValue({ count: 0 }),
},
```

Ensure the `$transaction` callback also passes these methods on its tx object (typically `$transaction` mock returns `cb({ ...prisma })` — should be automatic if the same object is reused).

- [ ] **Step 3: Add the happy-path test case**

Append to `salesorder.handler.spec.ts`:

```ts
  it("upserts SalesOrder + SalesOrderItem on first webhook (happy path)", async () => {
    prisma.salesOrder.upsert.mockResolvedValue({ id: "so1" });
    prisma.jubelioProductMapping.findFirst
      .mockResolvedValueOnce({ id: "m1", itemId: "i1", erpVariantSku: "SKU-A", jubelioItemId: 1721, jubelioItemGroupId: 96, jubelioItemCode: "SKU-A" })
      .mockResolvedValueOnce(null); // second line unmapped

    const row = makeRow({
      ...basePayload,
      source_name: "Shop | Tokopedia",
      customer_name: "Alice",
      shipping_province: "Jakarta",
      shipping_city: "Jakarta Selatan",
      sub_total: "100000",
      total_disc: "5000",
      total_tax: "0",
      grand_total: "97000",
      shipping_cost: "2000",
      transaction_date: "2026-06-11T10:00:00.000Z",
      items: [
        { salesorder_detail_id: 25193, item_id: 1721, item_code: "SKU-A", item_group_id: 96, item_name: "Item A", qty: "1.0000", qty_in_base: "1.0000", is_canceled_item: null, sell_price: "100000", price: "97000", disc_amount: "3000", tax_amount: "0", amount: "97000" },
        { salesorder_detail_id: 25194, item_id: 1688, item_code: "SKU-B", item_group_id: 96, item_name: "Item B", qty: "2.0000", qty_in_base: "2.0000", is_canceled_item: null, sell_price: "50000", price: "50000", disc_amount: "0", tax_amount: "0", amount: "100000" },
      ],
    });

    const r = await handler.handle(row);

    expect(r).toEqual({ kind: "processed" });
    expect(prisma.salesOrder.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = prisma.salesOrder.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ salesorderId: 23043 });
    expect(upsertArgs.create.channel).toBe("TOKOPEDIA");
    expect(upsertArgs.create.sourceName).toBe("Shop | Tokopedia");
    expect(upsertArgs.create.customerName).toBe("Alice");
    expect(upsertArgs.create.shippingProvince).toBe("Jakarta");
    expect(upsertArgs.create.grandTotal).toBe("97000");
    expect(upsertArgs.create.transactionDate).toEqual(new Date("2026-06-11T10:00:00.000Z"));
    expect(upsertArgs.create.lastWebhookEventId).toBe(row.id);

    expect(prisma.salesOrderItem.deleteMany).toHaveBeenCalledWith({ where: { salesOrderId: "so1" } });
    expect(prisma.salesOrderItem.createMany).toHaveBeenCalledTimes(1);
    const createArgs = prisma.salesOrderItem.createMany.mock.calls[0][0];
    expect(createArgs.data).toHaveLength(2);
    expect(createArgs.data[0]).toMatchObject({
      salesOrderId: "so1",
      salesorderDetailId: 25193,
      jubelioItemId: 1721,
      jubelioItemCode: "SKU-A",
      itemId: "i1",
      productName: "Item A",
      qty: "1.0000",
      unitPrice: "100000",
      pricePaid: "97000",
      lineTotal: "97000",
    });
    expect(createArgs.data[1].itemId).toBeNull();
    expect(createArgs.data[1].jubelioItemCode).toBe("SKU-B");
  });
```

- [ ] **Step 4: Run the test, verify it fails**

```bash
pnpm -F @elorae/api test -- salesorder.handler.spec.ts --runInBand -t "happy path"
```

Expected: FAIL — handler does not yet call `salesOrder.upsert`.

- [ ] **Step 5: Implement `upsertSalesOrder` in the handler**

Open `apps/api/src/jubelio/handlers/salesorder.handler.ts`.

Add imports near the top:

```ts
import { detectChannel } from "./_shared/channel-detect";
import { deriveStatus } from "./_shared/status-derive";
import { resolveItemMapping } from "./_shared/mapping-lookup";
```

Add this private method on the class:

```ts
  private async upsertSalesOrder(
    tx: PrismaService,
    p: SalesOrderPayload,
    webhookEventId: string,
  ): Promise<void> {
    const { channel, unknown } = detectChannel(p.source_name);
    if (unknown) {
      this.logger.warn(`Unknown source_name "${p.source_name ?? ""}" mapped to OTHER (salesorder ${p.salesorder_id})`);
    }

    const status = deriveStatus({
      is_canceled: p.is_canceled,
      internal_status: p.internal_status,
      marked_as_complete: p.marked_as_complete,
      completed_date: p.completed_date,
      wms_status: p.wms_status,
      is_shipped: p.is_shipped,
    });

    const txDate = parseDate(p.transaction_date) ?? parseDate(p.created_date);
    let transactionDate: Date;
    if (!txDate) {
      this.logger.warn(`Salesorder ${p.salesorder_id} missing transaction_date and created_date — falling back to now()`);
      transactionDate = new Date();
    } else {
      transactionDate = txDate;
    }

    const baseFields = {
      salesorderNo: p.salesorder_no ?? "",
      channel,
      sourceName: p.source_name ?? "",
      status,
      channelStatus: p.channel_status ?? null,
      internalStatus: p.internal_status ?? null,
      wmsStatus: p.wms_status ?? null,
      isCanceled: !!p.is_canceled,
      isPaid: !!p.is_paid,
      markedAsComplete: !!p.marked_as_complete,
      customerName: p.customer_name ?? null,
      customerPhone: p.customer_phone ?? null,
      customerEmail: p.customer_email ?? null,
      shippingProvince: p.shipping_province ?? null,
      shippingCity: p.shipping_city ?? null,
      shippingAddress: buildShippingAddress(p),
      subTotal: dec(p.sub_total),
      totalDisc: dec(p.total_disc),
      totalTax: dec(p.total_tax),
      shippingCost: dec(p.shipping_cost),
      grandTotal: dec(p.grand_total),
      feeBreakdown: buildFeeBreakdown(p),
      paymentMethod: p.payment_method ?? null,
      paymentDate: parseDate(p.payment_date),
      transactionDate,
      createdDateJubelio: parseDate(p.created_date),
      completedDate: parseDate(p.completed_date),
      cancelDate: parseDate(p.internal_cancel_date),
      lastModifiedJubelio: parseDate(p.last_modified),
      trackingNumber: p.tracking_number ?? null,
      courier: p.courier ?? null,
      lastWebhookEventId: webhookEventId,
    };

    const order = await tx.salesOrder.upsert({
      where: { salesorderId: p.salesorder_id },
      create: { salesorderId: p.salesorder_id, ...baseFields },
      update: baseFields,
    });

    const items = Array.isArray(p.items) ? p.items : [];
    const lines = [];
    for (const line of items) {
      const mapping = await resolveItemMapping(tx, line.item_id);
      lines.push({
        salesOrderId: order.id,
        salesorderDetailId: line.salesorder_detail_id,
        jubelioItemId: line.item_id,
        jubelioItemCode: line.item_code,
        itemId: mapping?.itemId ?? null,
        productName: line.item_name ?? line.item_code,
        qty: dec(line.qty),
        qtyInBase: dec(line.qty_in_base ?? line.qty),
        returnedQty: "0",
        isCanceledItem: !!line.is_canceled_item,
        unitPrice: dec(line.sell_price),
        pricePaid: dec(line.price),
        discAmount: dec(line.disc_amount),
        taxAmount: dec(line.tax_amount),
        lineTotal: dec(line.amount),
        discMarketplace: dec(line.disc_marketplace ?? line.discount_marketplace),
        weightInGram: dec(line.weight_in_gram),
      });
    }

    await tx.salesOrderItem.deleteMany({ where: { salesOrderId: order.id } });
    if (lines.length > 0) {
      await tx.salesOrderItem.createMany({ data: lines });
    }
  }
```

Add module-level helpers near the top of the file (above the `@Injectable()` line):

```ts
function dec(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "0";
  return String(v);
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildShippingAddress(p: SalesOrderPayload): Record<string, string | null> | null {
  const fields = {
    full_name: p.shipping_full_name ?? null,
    address: p.shipping_address ?? null,
    area: p.shipping_area ?? null,
    city: p.shipping_city ?? null,
    province: p.shipping_province ?? null,
    post_code: p.shipping_post_code ?? null,
    country: p.shipping_country ?? null,
    phone: p.shipping_phone ?? null,
    subdistrict: p.shipping_subdistrict ?? null,
  };
  const hasAny = Object.values(fields).some((v) => v !== null && v !== "");
  return hasAny ? fields : null;
}

function buildFeeBreakdown(p: SalesOrderPayload): Record<string, string> | null {
  const fields = {
    insurance_cost: dec(p.insurance_cost),
    add_fee: dec(p.add_fee),
    add_disc: dec(p.add_disc),
    service_fee: dec(p.service_fee),
    escrow_amount: dec(p.escrow_amount),
    voucher_amount: dec(p.voucher_amount),
    cod_fee: dec(p.cod_fee),
    order_processing_fee: dec(p.order_processing_fee),
    shipping_tax: dec(p.shipping_tax),
    total_amount_mp: dec(p.total_amount_mp),
  };
  const hasAny = Object.values(fields).some((v) => v !== "0");
  return hasAny ? fields : null;
}
```

Wire the call into `handle()`. Locate the existing `await this.prisma.$transaction(async (tx) => { ... })` block. The current block returns a state object after the if/else stock-state branches. Wrap the body so `upsertSalesOrder` runs first, then the existing stock-state logic. Replace the body:

```ts
    const state = await this.prisma.$transaction(async (tx) => {
      await this.upsertSalesOrder(tx as unknown as PrismaService, p, row.id);

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
```

The `tx as unknown as PrismaService` cast keeps the method signature simple. `upsertSalesOrder` only uses methods that exist on both the outer prisma and the inner tx.

- [ ] **Step 6: Run the happy-path test, verify PASS**

```bash
pnpm -F @elorae/api test -- salesorder.handler.spec.ts --runInBand -t "happy path"
```

Expected: PASS. If field shape mismatches, fix the handler to match the test (the test is the spec contract).

- [ ] **Step 7: Run the entire salesorder handler spec (regression)**

```bash
pnpm -F @elorae/api test -- salesorder.handler.spec.ts --runInBand
```

Expected: PASS, all cases including sub-4's existing stock-state tests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/jubelio/handlers/salesorder.handler.ts apps/api/src/jubelio/handlers/salesorder.handler.spec.ts
git commit -m "feat(api): persist SalesOrder + items from jubelio salesorder webhook"
```

---

## Task 7: Edge case tests

Idempotency, set-replace on fewer lines, OTHER channel warning, `transactionDate` fallback, transaction atomicity.

**Files:**
- Modify: `apps/api/src/jubelio/handlers/salesorder.handler.spec.ts`

- [ ] **Step 1: Add idempotency test (re-receive identical payload)**

Append:

```ts
  it("upsert is idempotent — re-receiving same payload calls upsert once per webhook with same key", async () => {
    prisma.salesOrder.upsert.mockResolvedValue({ id: "so1" });
    const row = makeRow(basePayload);
    await handler.handle(row);
    await handler.handle(row);
    expect(prisma.salesOrder.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.salesOrder.upsert.mock.calls[0][0].where).toEqual({ salesorderId: 23043 });
    expect(prisma.salesOrder.upsert.mock.calls[1][0].where).toEqual({ salesorderId: 23043 });
  });
```

- [ ] **Step 2: Add set-replace test (fewer lines on second webhook)**

Append:

```ts
  it("replaces SalesOrderItem set on re-receive (delete-then-createMany)", async () => {
    prisma.salesOrder.upsert.mockResolvedValue({ id: "so1" });
    prisma.jubelioProductMapping.findFirst.mockResolvedValue(null);

    const firstPayload = { ...basePayload, items: [
      { salesorder_detail_id: 1, item_id: 10, item_code: "A", item_group_id: 1, qty: "1", is_canceled_item: null },
      { salesorder_detail_id: 2, item_id: 11, item_code: "B", item_group_id: 1, qty: "1", is_canceled_item: null },
    ]};
    await handler.handle(makeRow(firstPayload));

    expect(prisma.salesOrderItem.deleteMany).toHaveBeenCalledWith({ where: { salesOrderId: "so1" } });
    expect(prisma.salesOrderItem.createMany.mock.calls[0][0].data).toHaveLength(2);

    prisma.salesOrderItem.createMany.mockClear();
    prisma.salesOrderItem.deleteMany.mockClear();

    const secondPayload = { ...basePayload, items: [
      { salesorder_detail_id: 1, item_id: 10, item_code: "A", item_group_id: 1, qty: "1", is_canceled_item: null },
    ]};
    await handler.handle(makeRow(secondPayload));

    expect(prisma.salesOrderItem.deleteMany).toHaveBeenCalledWith({ where: { salesOrderId: "so1" } });
    expect(prisma.salesOrderItem.createMany.mock.calls[0][0].data).toHaveLength(1);
  });
```

- [ ] **Step 3: Add OTHER channel warn test**

Append:

```ts
  it("logs WARN and persists OTHER channel for unknown source_name", async () => {
    prisma.salesOrder.upsert.mockResolvedValue({ id: "so1" });
    const warn = jest.spyOn((handler as any).logger, "warn").mockImplementation(() => {});

    await handler.handle(makeRow({ ...basePayload, source_name: "Shop | Lazada" }));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Lazada"));
    expect(prisma.salesOrder.upsert.mock.calls[0][0].create.channel).toBe("OTHER");
    expect(prisma.salesOrder.upsert.mock.calls[0][0].create.sourceName).toBe("Shop | Lazada");
    warn.mockRestore();
  });
```

- [ ] **Step 4: Add transactionDate fallback test**

Append:

```ts
  it("falls back to created_date when transaction_date missing", async () => {
    prisma.salesOrder.upsert.mockResolvedValue({ id: "so1" });
    await handler.handle(makeRow({
      ...basePayload,
      transaction_date: null,
      created_date: "2026-06-11T08:00:00.000Z",
    }));
    expect(prisma.salesOrder.upsert.mock.calls[0][0].create.transactionDate)
      .toEqual(new Date("2026-06-11T08:00:00.000Z"));
  });

  it("falls back to now() with WARN when both transaction_date and created_date missing", async () => {
    prisma.salesOrder.upsert.mockResolvedValue({ id: "so1" });
    const warn = jest.spyOn((handler as any).logger, "warn").mockImplementation(() => {});
    const before = Date.now();

    await handler.handle(makeRow({ ...basePayload, transaction_date: null, created_date: null }));

    const txDate = prisma.salesOrder.upsert.mock.calls[0][0].create.transactionDate as Date;
    expect(txDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("missing transaction_date"));
    warn.mockRestore();
  });
```

- [ ] **Step 5: Add transaction atomicity test**

Append:

```ts
  it("rolls back the whole transaction if salesOrderItem.createMany throws", async () => {
    prisma.salesOrder.upsert.mockResolvedValue({ id: "so1" });
    prisma.salesOrderItem.createMany.mockRejectedValueOnce(new Error("createMany boom"));

    await expect(handler.handle(makeRow(basePayload))).rejects.toThrow("createMany boom");

    // Stock-state upsert lives inside the same $transaction. Verify stock-state was not committed.
    // (With a real DB this is enforced. In the mock, we assert that any post-upsert state write is NOT called.)
    expect(prisma.jubelioSalesOrderState.update).not.toHaveBeenCalled();
  });
```

Note: the existing `$transaction` mock in the spec file may auto-rollback by re-throwing; if not, adjust the mock so a thrown error inside the callback propagates. The assertion `jubelioSalesOrderState.update` not called is the meaningful signal — stock-applied flag did not flip.

- [ ] **Step 6: Run full salesorder handler spec**

```bash
pnpm -F @elorae/api test -- salesorder.handler.spec.ts --runInBand
```

Expected: PASS, all cases. If atomicity test reveals the `$transaction` mock swallows errors, fix the mock factory in the same commit:

```ts
$transaction: jest.fn(async (cb: any) => cb({ ...prismaInner })),
```

ensure the body's thrown error bubbles up to the caller.

- [ ] **Step 7: Run full api test suite (catch broader regressions)**

```bash
pnpm -F @elorae/api test --runInBand
```

Expected: PASS. Sub-1/2/3/4 specs unaffected.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/jubelio/handlers/salesorder.handler.spec.ts
git commit -m "test(api): edge cases for salesorder upsert (idempotency, set-replace, fallback, atomicity)"
```

---

## Task 8: BOUNDARY.md update

Add the ownership row.

**Files:**
- Modify: `docs/BOUNDARY.md`

- [ ] **Step 1: Locate §3 of `docs/BOUNDARY.md`**

```bash
grep -n "^## 3\|^### 3\." docs/BOUNDARY.md | head
```

Find the section that lists per-table ownership rows (often a Markdown table or a list under §3).

- [ ] **Step 2: Add the new ownership row**

Add this entry next to the existing `JubelioSalesOrderState` row (alphabetical or co-located with sales-order ownership):

```markdown
| `SalesOrder`, `SalesOrderItem` | apps/api (write) | apps/web (read-only) | Inbound projection of Jubelio salesorder webhook. Web never writes; reads via Prisma directly. |
```

Adjust to match the existing table format in `BOUNDARY.md` (column count, alignment).

- [ ] **Step 3: Commit**

```bash
git add docs/BOUNDARY.md
git commit -m "docs: BOUNDARY ownership row for SalesOrder + SalesOrderItem"
```

---

## Smoke test path (post-merge, not a task)

After the PR merges and the user runs `migrate:deploy`:

1. Restart `apps/api` against the live ngrok tunnel.
2. Trigger any Jubelio test salesorder (via Jubelio's test store), or wait for a real production webhook.
3. Verify:
   - `JubelioWebhookEvent` row created with `event=salesorder`, status=PROCESSED.
   - `SalesOrder` row exists for that `salesorderId` with sensible `channel`, `status`, `grandTotal`, `transactionDate`.
   - `SalesOrderItem` rows match the line count from the payload.
   - Stock-state (sub-4) behavior unchanged — `StockMovement` rows still produced for non-cancelled lines.
4. Send the same webhook again (or wait for Jubelio to update the order): assert SalesOrder row updates in place, item set replaced cleanly.

No writes back to Jubelio. No rollback needed.

---

## Out-of-scope (next sub-projects)

- Sub-B: dashboard list + filters + detail view at `/backoffice/sales-orders`.
- Sub-C: KPI widgets on `/backoffice/dashboard` (Pending Fulfillment, Today's Sales).
- Sub-A-followup: wire `SalesReturnWebhookHandler` against real return payload, update `returnedQty` + emit `RETURNED` status.
