# Fulfillment Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/backoffice/fulfillment` — a paginated, filterable queue of orders grouped by `fulfillmentStatus`, with multi-select + batch Finish Pick / Finish Pack actions.

**Architecture:** Pure `apps/web` feature. New server-action file with `listFulfillmentQueue` + two batch actions that loop the writer helper from sub-A sequentially. Server page parses URL search params (filter + sort + pagination), passes data + `canFulfill` to a new client component. Client renders shadcn Table with Checkbox column, filter bar, sticky batch-action bar, and the existing Pager. No schema changes.

**Tech Stack:** Next.js 16 App Router (RSC + server actions), Prisma 7 read + the sub-A writer for mutations, shadcn Table/Card/Select/Input/Checkbox/Button, `next-intl`, sonner, vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-fulfillment-queue-design.md`

---

## File Structure

**New files:**

```
apps/web/app/actions/fulfillment-queue.ts
apps/web/app/actions/fulfillment-queue.spec.ts

apps/web/app/backoffice/fulfillment/page.tsx
apps/web/app/backoffice/fulfillment/FulfillmentQueueClient.tsx
```

**Modified files:**

```
apps/web/lib/rbac.ts                                    # + /backoffice/fulfillment route + BACKOFFICE_ROUTES_ORDER
apps/web/lib/i18n/messages/en.json                      # + fulfillmentQueue namespace + nav key
apps/web/lib/i18n/messages/id.json                      # + same in Indonesian
apps/web/app/backoffice/BackofficeShell.tsx             # + Fulfillment child under Sales nav group
```

**Reused (no modification):**

- `@elorae/db/sales-order-fulfillment-writer` — `markOrderPicked`, `markOrderPacked`, `InvalidFulfillmentTransition` (sub-A).
- `@/lib/sales-orders/fulfillment-result` — `FULFILLMENT_FORBIDDEN_REASON`.
- `@/lib/sales-orders/format` — `formatDateTime`, `formatIDR` (sub-B).
- `@/lib/sales-orders/badges` — `CHANNEL_BADGE`, `STATUS_BADGE` (sub-B), plus `FULFILLMENT_STATUS_BADGE` if it lives there. If not, inline the small palette in the client component (~10 LOC).
- `@/lib/constants/enums` — `SALES_CHANNEL_VALUES`, `SALES_ORDER_STATUS_VALUES`, `SalesChannel`, `SalesOrderStatus`, `SalesOrderFulfillmentStatus`, `SALES_ORDER_FULFILLMENT_STATUS_VALUES`.
- `@/lib/date-only` — `parseDateOnly` for the date filter.
- `@/components/Pager` + shadcn primitives.
- `@/lib/auth`, `@/lib/rbac`.

---

## Task 1: Server actions + tests (TDD)

`listFulfillmentQueue` + `batchFinishPickAction` + `batchFinishPackAction` + their result types. All tested with mocked Prisma and mocked writer helper.

**Files:**
- Create: `apps/web/app/actions/fulfillment-queue.ts`
- Create: `apps/web/app/actions/fulfillment-queue.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/app/actions/fulfillment-queue.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    salesOrder: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@elorae/db/sales-order-fulfillment-writer", () => ({
  markOrderPicked: vi.fn(),
  markOrderPacked: vi.fn(),
  InvalidFulfillmentTransition: class InvalidFulfillmentTransition extends Error {
    code = "INVALID_FULFILLMENT_TRANSITION";
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@elorae/db";
import {
  markOrderPicked,
  markOrderPacked,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  listFulfillmentQueue,
  batchFinishPickAction,
  batchFinishPackAction,
} from "./fulfillment-queue";

const sessionWithFulfill = {
  user: { id: "u1", permissions: ["sales_orders:view", "sales_orders:fulfill"] },
};
const sessionViewOnly = {
  user: { id: "u1", permissions: ["sales_orders:view"] },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listFulfillmentQueue", () => {
  it("defaults to fulfillmentStatus=PENDING when not provided", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listFulfillmentQueue({ page: 1, pageSize: 10 });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.where.fulfillmentStatus).toBe("PENDING");
  });

  it("ALL skips the fulfillmentStatus filter", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listFulfillmentQueue({ fulfillmentStatus: "ALL", page: 1, pageSize: 10 });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.where.fulfillmentStatus).toBeUndefined();
  });

  it("applies channel + date + search filters", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listFulfillmentQueue({
      fulfillmentStatus: "PENDING",
      channel: "SHOPEE",
      search: "Alice",
      dateFrom: new Date("2026-06-01T00:00:00Z"),
      dateTo: new Date("2026-06-30T23:59:59Z"),
      page: 1,
      pageSize: 10,
    });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.where.channel).toBe("SHOPEE");
    expect(args.where.transactionDate).toEqual({
      gte: new Date("2026-06-01T00:00:00Z"),
      lte: new Date("2026-06-30T23:59:59Z"),
    });
    expect(args.where.OR).toEqual([
      { salesorderNo: { contains: "Alice" } },
      { customerName: { contains: "Alice" } },
    ]);
  });

  it("translates sort field + dir to orderBy", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listFulfillmentQueue({
      sortField: "salesorderNo",
      sortDir: "asc",
      page: 2,
      pageSize: 25,
    });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.orderBy).toEqual({ salesorderNo: "asc" });
    expect(args.skip).toBe(25);
    expect(args.take).toBe(25);
  });
});

describe("batchFinishPickAction", () => {
  it("processes all PENDING orders, returns processed count", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPicked as any).mockResolvedValue(undefined);

    const r = await batchFinishPickAction(["so1", "so2", "so3"]);

    expect(r).toEqual({ ok: true, processed: 3, skipped: 0 });
    expect(markOrderPicked).toHaveBeenCalledTimes(3);
    expect(revalidatePath).toHaveBeenCalledWith("/backoffice/fulfillment");
  });

  it("buckets InvalidFulfillmentTransition as skipped without throwing", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPicked as any)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new InvalidFulfillmentTransition("Order so2 already PICKED"))
      .mockResolvedValueOnce(undefined);

    const r = await batchFinishPickAction(["so1", "so2", "so3"]);

    expect(r).toEqual({ ok: true, processed: 2, skipped: 1 });
  });

  it("returns forbidden when user lacks sales_orders:fulfill", async () => {
    (auth as any).mockResolvedValue(sessionViewOnly);

    const r = await batchFinishPickAction(["so1"]);

    expect(r).toEqual({ ok: false, reason: "forbidden" });
    expect(markOrderPicked).not.toHaveBeenCalled();
  });

  it("propagates non-transition errors (DB down etc.)", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPicked as any).mockRejectedValueOnce(new Error("connection refused"));

    await expect(batchFinishPickAction(["so1"])).rejects.toThrow("connection refused");
  });
});

describe("batchFinishPackAction", () => {
  it("calls markOrderPacked for each order", async () => {
    (auth as any).mockResolvedValue(sessionWithFulfill);
    (markOrderPacked as any).mockResolvedValue(undefined);

    const r = await batchFinishPackAction(["so1", "so2"]);

    expect(r).toEqual({ ok: true, processed: 2, skipped: 0 });
    expect(markOrderPacked).toHaveBeenCalledTimes(2);
  });

  it("returns forbidden when user lacks fulfill permission", async () => {
    (auth as any).mockResolvedValue(sessionViewOnly);

    const r = await batchFinishPackAction(["so1"]);

    expect(r).toEqual({ ok: false, reason: "forbidden" });
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm -F @elorae/web test -- fulfillment-queue.spec.ts
```

Expected: FAIL `Cannot find module './fulfillment-queue'`.

- [ ] **Step 3: Implement**

`apps/web/app/actions/fulfillment-queue.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import {
  markOrderPicked,
  markOrderPacked,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type {
  SalesChannel,
  SalesOrderFulfillmentStatus,
  SalesOrderStatus,
} from "@/lib/constants/enums";
import {
  FULFILLMENT_FORBIDDEN_REASON,
  type FulfillmentActionResult,
} from "@/lib/sales-orders/fulfillment-result";

export type FulfillmentQueueRow = {
  id: string;
  salesorderNo: string;
  channel: SalesChannel;
  status: SalesOrderStatus;
  fulfillmentStatus: SalesOrderFulfillmentStatus;
  customerName: string | null;
  transactionDate: Date;
};

export type QueueSortField =
  | "transactionDate"
  | "salesorderNo"
  | "channel"
  | "fulfillmentStatus";
export type QueueSortDir = "asc" | "desc";

export type ListFulfillmentQueueOpts = {
  fulfillmentStatus?: SalesOrderFulfillmentStatus | "ALL";
  channel?: SalesChannel;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortField?: QueueSortField;
  sortDir?: QueueSortDir;
  page: number;
  pageSize: number;
};

export type QueuePage = {
  rows: FulfillmentQueueRow[];
  totalCount: number;
};

export type BatchResult =
  | { ok: true; processed: number; skipped: number }
  | { ok: false; reason: typeof FULFILLMENT_FORBIDDEN_REASON };

async function requireSession(): Promise<{ userId: string; permissions: string[] }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  return { userId: session.user.id, permissions: session.user.permissions };
}

function buildWhere(opts: ListFulfillmentQueueOpts): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const fStatus = opts.fulfillmentStatus ?? "PENDING";
  if (fStatus !== "ALL") {
    where.fulfillmentStatus = fStatus;
  }
  if (opts.channel) where.channel = opts.channel;
  if (opts.dateFrom || opts.dateTo) {
    where.transactionDate = {
      ...(opts.dateFrom ? { gte: opts.dateFrom } : {}),
      ...(opts.dateTo ? { lte: opts.dateTo } : {}),
    };
  }
  if (opts.search && opts.search.trim().length > 0) {
    const s = opts.search.trim();
    where.OR = [
      { salesorderNo: { contains: s } },
      { customerName: { contains: s } },
    ];
  }
  return where;
}

export async function listFulfillmentQueue(opts: ListFulfillmentQueueOpts): Promise<QueuePage> {
  await requireSession();

  const where = buildWhere(opts);
  const sortField: QueueSortField = opts.sortField ?? "transactionDate";
  const sortDir: QueueSortDir = opts.sortDir ?? (sortField === "transactionDate" ? "desc" : "asc");

  const [rows, totalCount] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      orderBy: { [sortField]: sortDir },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      select: {
        id: true,
        salesorderNo: true,
        channel: true,
        status: true,
        fulfillmentStatus: true,
        customerName: true,
        transactionDate: true,
      },
    }),
    prisma.salesOrder.count({ where }),
  ]);

  const out: FulfillmentQueueRow[] = rows.map((r) => ({
    id: r.id,
    salesorderNo: r.salesorderNo,
    channel: r.channel as SalesChannel,
    status: r.status as SalesOrderStatus,
    fulfillmentStatus: r.fulfillmentStatus as SalesOrderFulfillmentStatus,
    customerName: r.customerName,
    transactionDate: r.transactionDate,
  }));

  return { rows: out, totalCount };
}

async function runBatch(
  orderIds: string[],
  fn: (orderId: string, userId: string) => Promise<void>,
): Promise<BatchResult> {
  const { userId, permissions } = await requireSession();
  if (!hasPermission(permissions, PERMISSIONS.SALES_ORDERS_FULFILL)) {
    return { ok: false, reason: FULFILLMENT_FORBIDDEN_REASON };
  }

  let processed = 0;
  let skipped = 0;
  for (const orderId of orderIds) {
    try {
      await fn(orderId, userId);
      processed += 1;
    } catch (err) {
      if (err instanceof InvalidFulfillmentTransition) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  revalidatePath("/backoffice/fulfillment");
  return { ok: true, processed, skipped };
}

export async function batchFinishPickAction(orderIds: string[]): Promise<BatchResult> {
  return runBatch(orderIds, (orderId, userId) =>
    markOrderPicked(prisma, { orderId, userId }),
  );
}

export async function batchFinishPackAction(orderIds: string[]): Promise<BatchResult> {
  return runBatch(orderIds, (orderId, userId) =>
    markOrderPacked(prisma, { orderId, userId }),
  );
}

// Re-export for client convenience
export type { FulfillmentActionResult };
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm -F @elorae/web test -- fulfillment-queue.spec.ts
```

Expected: PASS, 9 cases.

- [ ] **Step 5: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/actions/fulfillment-queue.ts apps/web/app/actions/fulfillment-queue.spec.ts
git commit -m "feat(web): server actions for fulfillment queue + batch Pick/Pack"
```

---

## Task 2: RBAC route entry

Register the new route in `ROUTE_PERMISSIONS` and `BACKOFFICE_ROUTES_ORDER`.

**Files:**
- Modify: `apps/web/lib/rbac.ts`

- [ ] **Step 1: Add `ROUTE_PERMISSIONS` entry**

Open `apps/web/lib/rbac.ts`. Locate the `ROUTE_PERMISSIONS` map. Find the existing `/backoffice/sales-orders` entry. Add directly below:

```ts
  '/backoffice/fulfillment': 'sales_orders:view',
```

(File uses single quotes; match.)

- [ ] **Step 2: Add to `BACKOFFICE_ROUTES_ORDER`**

Locate the `BACKOFFICE_ROUTES_ORDER` array. Find the `/backoffice/sales-orders` line. Insert directly below:

```ts
  '/backoffice/fulfillment',
```

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/rbac.ts
git commit -m "feat(web): RBAC route entry for fulfillment queue"
```

---

## Task 3: Nav entry under Sales group

Add Fulfillment as second child of the Sales nav group.

**Files:**
- Modify: `apps/web/app/backoffice/BackofficeShell.tsx`

- [ ] **Step 1: Locate the Sales nav block**

```bash
grep -A 6 "labelKey: 'sales'" apps/web/app/backoffice/BackofficeShell.tsx
```

The block currently has one child: `{ labelKey: 'navSalesOrders', href: '/backoffice/sales-orders' }`.

- [ ] **Step 2: Add the second child**

Inside the `children` array of the Sales nav item, after `navSalesOrders`, add:

```ts
      { labelKey: 'navFulfillment', href: '/backoffice/fulfillment' },
```

(Single quotes — file is pre-flip. Match style.)

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/backoffice/BackofficeShell.tsx
git commit -m "feat(web): Fulfillment nav child under Sales group"
```

---

## Task 4: i18n keys (en + id)

`navigation.navFulfillment` + the `fulfillmentQueue.*` namespace.

**Files:**
- Modify: `apps/web/lib/i18n/messages/en.json`
- Modify: `apps/web/lib/i18n/messages/id.json`

- [ ] **Step 1: Add nav key to en.json**

Locate the `navigation` namespace. Find the line:

```json
    "navSalesOrders": "Sales Orders",
```

Add directly below:

```json
    "navFulfillment": "Fulfillment",
```

- [ ] **Step 2: Add nav key to id.json**

Find `"navSalesOrders": "Pesanan",` in the navigation namespace. Add:

```json
    "navFulfillment": "Pemenuhan",
```

- [ ] **Step 3: Append `fulfillmentQueue` namespace to en.json**

Inside the root object, before the closing `}`, add (with leading comma on previous entry):

```json
  "fulfillmentQueue": {
    "pageTitle": "Fulfillment Queue",
    "pageSubtitle": "Marketplace orders awaiting pick, pack, or ship.",
    "empty": "No orders match the current filters.",
    "filter": {
      "fulfillmentStatus": "Fulfillment status",
      "channel": "Channel",
      "search": "Search",
      "searchPlaceholder": "Order # or buyer name",
      "dateRange": "Date range",
      "reset": "Reset",
      "all": "All"
    },
    "fulfillmentStatus": {
      "PENDING": "Pending",
      "PICKED": "Picked",
      "PACKED": "Packed",
      "SHIPPED": "Shipped"
    },
    "table": {
      "orderNo": "Order #",
      "channel": "Channel",
      "buyer": "Buyer",
      "date": "Date",
      "fulfillmentStatus": "Fulfillment",
      "status": "Jubelio"
    },
    "batch": {
      "selectedCount": "{count, plural, one {# selected} other {# selected}}",
      "finishPick": "Finish Pick",
      "finishPack": "Finish Pack",
      "clear": "Clear",
      "toast": {
        "success": "{processed} processed.",
        "successWithSkipped": "{processed} processed, {skipped} skipped.",
        "forbidden": "Insufficient permissions.",
        "networkError": "Couldn't reach the server. Try again."
      }
    }
  }
```

- [ ] **Step 4: Append the SAME namespace to id.json with Indonesian strings**

```json
  "fulfillmentQueue": {
    "pageTitle": "Antrian Pemenuhan",
    "pageSubtitle": "Pesanan marketplace yang menunggu pick, pack, atau pengiriman.",
    "empty": "Tidak ada pesanan yang cocok dengan filter saat ini.",
    "filter": {
      "fulfillmentStatus": "Status pemenuhan",
      "channel": "Channel",
      "search": "Cari",
      "searchPlaceholder": "Nomor pesanan atau nama pembeli",
      "dateRange": "Rentang tanggal",
      "reset": "Reset",
      "all": "Semua"
    },
    "fulfillmentStatus": {
      "PENDING": "Menunggu",
      "PICKED": "Sudah diambil",
      "PACKED": "Sudah dikemas",
      "SHIPPED": "Sudah dikirim"
    },
    "table": {
      "orderNo": "No. Pesanan",
      "channel": "Channel",
      "buyer": "Pembeli",
      "date": "Tanggal",
      "fulfillmentStatus": "Pemenuhan",
      "status": "Jubelio"
    },
    "batch": {
      "selectedCount": "{count, plural, other {# dipilih}}",
      "finishPick": "Selesai Pick",
      "finishPack": "Selesai Pack",
      "clear": "Bersihkan",
      "toast": {
        "success": "{processed} berhasil diproses.",
        "successWithSkipped": "{processed} diproses, {skipped} dilewati.",
        "forbidden": "Akses tidak diizinkan.",
        "networkError": "Gagal terhubung ke server. Coba lagi."
      }
    }
  }
```

- [ ] **Step 5: Verify both files parse**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/en.json'));"
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/id.json'));"
```

Both must exit 0.

- [ ] **Step 6: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS (next-intl validates parity).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/i18n/messages/en.json apps/web/lib/i18n/messages/id.json
git commit -m "i18n: fulfillment queue strings (en + id)"
```

---

## Task 5: Server page

Parse URL search params, compute filter + sort + pagination, fetch the queue, pass props + `canFulfill` to the client.

**Files:**
- Create: `apps/web/app/backoffice/fulfillment/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import {
  SALES_CHANNEL_VALUES,
  SALES_ORDER_FULFILLMENT_STATUS_VALUES,
  type SalesChannel,
  type SalesOrderFulfillmentStatus,
} from "@/lib/constants/enums";
import { parseDateOnly } from "@/lib/date-only";
import {
  listFulfillmentQueue,
  type QueueSortField,
  type QueueSortDir,
} from "@/app/actions/fulfillment-queue";
import { FulfillmentQueueClient } from "./FulfillmentQueueClient";

export const dynamic = "force-dynamic";

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const SORT_FIELDS: QueueSortField[] = [
  "transactionDate",
  "salesorderNo",
  "channel",
  "fulfillmentStatus",
];
const SORT_DIRS: QueueSortDir[] = ["asc", "desc"];

type PageProps = {
  searchParams: Promise<{
    fulfillmentStatus?: string;
    channel?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    sortField?: string;
    sortDir?: string;
    page?: string;
    pageSize?: string;
  }>;
};

function parseFulfillmentStatus(
  raw: string | undefined,
): SalesOrderFulfillmentStatus | "ALL" | undefined {
  if (!raw) return undefined;
  if (raw === "ALL") return "ALL";
  return (SALES_ORDER_FULFILLMENT_STATUS_VALUES as readonly string[]).includes(raw)
    ? (raw as SalesOrderFulfillmentStatus)
    : undefined;
}

function parseChannel(raw: string | undefined): SalesChannel | undefined {
  if (!raw) return undefined;
  return (SALES_CHANNEL_VALUES as readonly string[]).includes(raw)
    ? (raw as SalesChannel)
    : undefined;
}

function parseSortField(raw: string | undefined): QueueSortField {
  return SORT_FIELDS.includes(raw as QueueSortField)
    ? (raw as QueueSortField)
    : "transactionDate";
}

function parseSortDir(raw: string | undefined, field: QueueSortField): QueueSortDir {
  if (SORT_DIRS.includes(raw as QueueSortDir)) return raw as QueueSortDir;
  return field === "transactionDate" ? "desc" : "asc";
}

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseDateFrom(raw: string | undefined): Date | undefined {
  return raw ? parseDateOnly(raw) : undefined;
}

function parseDateTo(raw: string | undefined): Date | undefined {
  const d = raw ? parseDateOnly(raw) : undefined;
  if (!d) return undefined;
  d.setHours(23, 59, 59, 999);
  return d;
}

export default async function FulfillmentQueuePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const fulfillmentStatus = parseFulfillmentStatus(sp.fulfillmentStatus);
  const channel = parseChannel(sp.channel);
  const sortField = parseSortField(sp.sortField);
  const sortDir = parseSortDir(sp.sortDir, sortField);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const { rows, totalCount } = await listFulfillmentQueue({
    fulfillmentStatus,
    channel,
    search: sp.search?.trim() || undefined,
    dateFrom: parseDateFrom(sp.dateFrom),
    dateTo: parseDateTo(sp.dateTo),
    sortField,
    sortDir,
    page,
    pageSize,
  });

  const canFulfill = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.SALES_ORDERS_FULFILL,
  );

  return (
    <FulfillmentQueueClient
      rows={rows}
      totalCount={totalCount}
      fulfillmentStatus={fulfillmentStatus ?? "PENDING"}
      channel={channel ?? ""}
      search={sp.search?.trim() ?? ""}
      dateFrom={sp.dateFrom ?? ""}
      dateTo={sp.dateTo ?? ""}
      sortField={sortField}
      sortDir={sortDir}
      page={page}
      pageSize={pageSize}
      canFulfill={canFulfill}
    />
  );
}
```

- [ ] **Step 2: Type-check (will fail until Task 6 implements client)**

```bash
pnpm -F @elorae/web type-check
```

Expected: FAIL with `Cannot find module './FulfillmentQueueClient'`. That's fine — Task 6 fixes it. Don't commit yet — defer the commit until Task 6 lands so the working-tree compiles between commits.

---

## Task 6: Client component

Filter bar + sortable table with Checkbox column + sticky batch action bar + Pager. Uses sonner toast for batch results.

**Files:**
- Create: `apps/web/app/backoffice/fulfillment/FulfillmentQueueClient.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/components/Pager";
import {
  SALES_CHANNEL_VALUES,
  SALES_ORDER_FULFILLMENT_STATUS_VALUES,
  type SalesChannel,
  type SalesOrderFulfillmentStatus,
  type SalesOrderStatus,
} from "@/lib/constants/enums";
import { CHANNEL_BADGE, STATUS_BADGE } from "@/lib/sales-orders/badges";
import { formatDateTime } from "@/lib/sales-orders/format";
import { FULFILLMENT_FORBIDDEN_REASON } from "@/lib/sales-orders/fulfillment-result";
import {
  batchFinishPickAction,
  batchFinishPackAction,
  type BatchResult,
  type FulfillmentQueueRow,
  type QueueSortDir,
  type QueueSortField,
} from "@/app/actions/fulfillment-queue";

const ROUTE = "/backoffice/fulfillment";

const FULFILLMENT_BADGE: Record<SalesOrderFulfillmentStatus, string> = {
  PENDING: "bg-zinc-100 text-zinc-700 border-zinc-200",
  PICKED: "bg-amber-100 text-amber-800 border-amber-200",
  PACKED: "bg-blue-100 text-blue-800 border-blue-200",
  SHIPPED: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

type Props = {
  rows: FulfillmentQueueRow[];
  totalCount: number;
  fulfillmentStatus: SalesOrderFulfillmentStatus | "ALL";
  channel: string;
  search: string;
  dateFrom: string;
  dateTo: string;
  sortField: QueueSortField;
  sortDir: QueueSortDir;
  page: number;
  pageSize: number;
  canFulfill: boolean;
};

export function FulfillmentQueueClient(props: Props) {
  const t = useTranslations("fulfillmentQueue");
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(props.search);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection when the underlying page changes (filter / pagination / sort)
  useEffect(() => {
    setSelected(new Set());
  }, [props.rows]);

  // Debounce search → URL push
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== props.search) pushParam("search", searchInput || undefined);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function pushParams(updates: Record<string, string | undefined>): void {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`${ROUTE}?${params.toString()}`));
  }

  function pushParam(key: string, value: string | undefined): void {
    pushParams({ [key]: value, page: undefined });
  }

  function onSortClick(field: QueueSortField): void {
    let nextDir: QueueSortDir = field === "transactionDate" ? "desc" : "asc";
    if (props.sortField === field) {
      nextDir = props.sortDir === "asc" ? "desc" : "asc";
    }
    pushParams({ sortField: field, sortDir: nextDir, page: undefined });
  }

  function reset(): void {
    setSearchInput("");
    startTransition(() => router.push(ROUTE));
  }

  function toggleRow(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    if (selected.size === props.rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(props.rows.map((r) => r.id)));
    }
  }

  function handleBatchResult(r: BatchResult): void {
    if (!r.ok) {
      if (r.reason === FULFILLMENT_FORBIDDEN_REASON) {
        toast.error(t("batch.toast.forbidden"));
      } else {
        toast.error(t("batch.toast.networkError"));
      }
      return;
    }
    if (r.skipped > 0) {
      toast.success(
        t("batch.toast.successWithSkipped", { processed: r.processed, skipped: r.skipped }),
      );
    } else {
      toast.success(t("batch.toast.success", { processed: r.processed }));
    }
    setSelected(new Set());
  }

  function runBatch(action: (ids: string[]) => Promise<BatchResult>): void {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      try {
        const r = await action(ids);
        handleBatchResult(r);
      } catch {
        toast.error(t("batch.toast.networkError"));
      }
    });
  }

  const allSelected = props.rows.length > 0 && selected.size === props.rows.length;
  const someSelected = selected.size > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground">{t("pageSubtitle")}</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-7">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.fulfillmentStatus")}
            </label>
            <Select
              value={props.fulfillmentStatus}
              onValueChange={(v) => pushParam("fulfillmentStatus", v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("filter.all")}</SelectItem>
                {SALES_ORDER_FULFILLMENT_STATUS_VALUES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`fulfillmentStatus.${s}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.channel")}
            </label>
            <Select
              value={props.channel || "ALL"}
              onValueChange={(v) => pushParam("channel", v === "ALL" ? undefined : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("filter.channel")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("filter.all")}</SelectItem>
                {SALES_CHANNEL_VALUES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`fulfillmentStatus.${c}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="lg:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.search")}
            </label>
            <Input
              placeholder={t("filter.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.dateRange")}
            </label>
            <Input
              type="date"
              value={props.dateFrom}
              onChange={(e) => pushParam("dateFrom", e.target.value || undefined)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">&nbsp;</label>
            <Input
              type="date"
              value={props.dateTo}
              onChange={(e) => pushParam("dateTo", e.target.value || undefined)}
            />
          </div>
          <div className="flex flex-col justify-end">
            <Button variant="outline" onClick={reset} className="w-full">
              {t("filter.reset")}
            </Button>
          </div>
        </div>
      </Card>

      {someSelected && props.canFulfill && (
        <Card className="p-3 flex items-center justify-between sticky top-0 z-10">
          <span className="text-sm font-medium">
            {t("batch.selectedCount", { count: selected.size })}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => runBatch(batchFinishPickAction)}
            >
              {t("batch.finishPick")}
            </Button>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => runBatch(batchFinishPackAction)}
            >
              {t("batch.finishPack")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("batch.clear")}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                {props.canFulfill && (
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                )}
              </TableHead>
              <SortableHead
                label={t("table.orderNo")}
                field="salesorderNo"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
              />
              <SortableHead
                label={t("table.channel")}
                field="channel"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
              />
              <TableHead>{t("table.buyer")}</TableHead>
              <SortableHead
                label={t("table.date")}
                field="transactionDate"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
              />
              <SortableHead
                label={t("table.fulfillmentStatus")}
                field="fulfillmentStatus"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
              />
              <TableHead>{t("table.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              props.rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    startTransition(() => router.push(`/backoffice/sales-orders/${r.id}`))
                  }
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {props.canFulfill && (
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => toggleRow(r.id)}
                        aria-label={`Select ${r.salesorderNo}`}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/backoffice/sales-orders/${r.id}`}
                      className="font-mono text-sm hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.salesorderNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CHANNEL_BADGE[r.channel].tailwindClass}`}
                    >
                      {t(`fulfillmentStatus.${CHANNEL_BADGE[r.channel].labelKey}` as never)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {r.customerName ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(r.transactionDate, locale)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${FULFILLMENT_BADGE[r.fulfillmentStatus]}`}
                    >
                      {t(`fulfillmentStatus.${r.fulfillmentStatus}` as never)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[r.status].tailwindClass}`}
                    >
                      {r.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Pager
        page={props.page}
        pageSize={props.pageSize}
        total={props.totalCount}
        onPageChange={(p) => pushParams({ page: String(p) })}
        onPageSizeChange={(size) => pushParams({ pageSize: String(size), page: undefined })}
      />
    </div>
  );
}

function SortableHead({
  label,
  field,
  currentField,
  currentDir,
  onClick,
  className,
}: {
  label: string;
  field: QueueSortField;
  currentField: QueueSortField;
  currentDir: QueueSortDir;
  onClick: (f: QueueSortField) => void;
  className?: string;
}) {
  const active = currentField === field;
  const Icon = active ? (currentDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onClick(field)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className="h-3.5 w-3.5" />
      </button>
    </TableHead>
  );
}
```

Note: the channel badge label currently uses `t(\`fulfillmentStatus.${CHANNEL_BADGE[r.channel].labelKey}\` as never)` — that's WRONG. The channel labels should come from the `salesOrders.channel.*` keys (sub-B's namespace). Fix during implementation: import the existing `salesOrders` translator (`useTranslations("salesOrders")` separately) and use `tChannel("channel.<key>")`. Same for the `<SelectItem>` in the channel filter. Implementer: confirm the existing key paths from `apps/web/lib/i18n/messages/en.json` then adjust both spots accordingly.

Status badge: the sub-B `STATUS_BADGE` table is keyed by enum value; the label is the enum string itself (e.g. "COMPLETED"). For human-readable display, also use `tStatus("status.COMPLETED")` from the same `salesOrders` namespace. Adjust during implementation.

- [ ] **Step 2: Fix the channel + status label translations**

Read `apps/web/lib/i18n/messages/en.json` to confirm the paths:

```bash
grep -A 2 "\"channel\":" apps/web/lib/i18n/messages/en.json | head -10
```

The right call is `useTranslations("salesOrders")` for those keys. Inside the component, add at the top:

```tsx
const tSalesOrders = useTranslations("salesOrders");
```

Then replace the two badge label lines:

```tsx
{tSalesOrders(`channel.${CHANNEL_BADGE[r.channel].labelKey}` as never)}
```

```tsx
{tSalesOrders(`status.${r.status}` as never)}
```

And in the channel `<SelectItem>` mapper:

```tsx
{tSalesOrders(`channel.${CHANNEL_BADGE[c].labelKey}` as never)}
```

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS. Task 5's red is now green.

- [ ] **Step 4: Run full web tests**

```bash
pnpm -F @elorae/web test
```

Expected: all green. No new test files for this task (server actions covered in Task 1).

- [ ] **Step 5: Manual smoke**

Tell the user to start the dev server (per `feedback_service_control`):

```bash
pnpm -F @elorae/web dev
```

Then navigate to `/backoffice/fulfillment`. Expected:
- Page renders with PENDING rows by default.
- Filter dropdowns work. Search debounces. Sort headers toggle.
- As an admin (`*` permission) or fulfill-capable role: row checkboxes appear. Select ≥1 → batch action bar shows. Click Finish Pick → rows that were PENDING advance; mixed rows skip with toast count.
- Refresh repaints with new state.
- View-only user: no checkboxes, no batch bar.

This is manual verification only. Don't block on apps/api running — the writer enqueues an outbox row but the queue doesn't depend on it being processed.

- [ ] **Step 6: Commit both files together**

```bash
git add apps/web/app/backoffice/fulfillment/page.tsx apps/web/app/backoffice/fulfillment/FulfillmentQueueClient.tsx
git commit -m "feat(web): fulfillment queue page with filter sort + batch actions"
```

---

## Smoke test path (post-merge, not a task)

After merge:

1. Visit `/backoffice/fulfillment`. Verify the nav entry under Sales group.
2. Confirm default landing shows only PENDING rows.
3. Filter combinations + sort + pagination + page-size selector all driving URL state.
4. Batch flow: select 3 PENDING orders → Finish Pick → toast "3 processed" → re-list omits them. Switch to PICKED filter → they appear. Repeat with Finish Pack.
5. Mixed-status batch: select 2 PENDING + 1 already-PICKED → Finish Pick → toast "2 processed, 1 skipped".
6. View-only role: page loads but checkboxes hidden, batch bar never appears.

Each `markOrderPicked` / `markOrderPacked` call enqueues a `salesorder_pick` / `_pack` outbox row — apps/api's poller processes them in the background against Jubelio. Sub-A's existing webhook handler updates the Jubelio-derived `status` separately.

## Out-of-scope follow-ups

- Sub-D: print views (pick list + packing slip) + manual courier-sync admin button.
- Sub-A-followup: `isAlreadyInStateError` fix-forward in the three outbox handlers once a real Jubelio error shape is observed.
- Batch Ship with default courier per order — needs a `defaultCourierId` somewhere (column on `SalesOrder`, per-channel default, etc.). Separate effort.
- Saved filter presets (e.g. "All Shopee PENDING from this week"). Future UX polish.
