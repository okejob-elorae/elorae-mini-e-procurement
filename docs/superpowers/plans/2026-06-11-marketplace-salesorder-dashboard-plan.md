# Marketplace Sales Order Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only marketplace sales-order dashboard: paginated list with filter + search at `/backoffice/sales-orders` and a per-order detail view at `/backoffice/sales-orders/[id]`, both backed by `SalesOrder` + `SalesOrderItem` (sub-A).

**Architecture:** Pure `apps/web` feature. Server components run all Prisma queries (`lib/sales-orders/queries.ts`); client components are presentational and drive filter state through URL search params. New `sales_orders:view` RBAC permission gates both routes. Decimal columns serialise as strings at the query boundary so client bundles stay free of `@elorae/db`.

**Tech Stack:** Next.js 16 App Router (RSC + server actions style), Prisma 7 read-only, shadcn UI primitives (Table, Select, DateRangePicker, Card, Badge, Pager), `next-intl`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-marketplace-salesorder-dashboard-design.md`

---

## File Structure

**New files:**

```
apps/web/lib/sales-orders/queries.ts                              # listSalesOrders + getSalesOrderById
apps/web/lib/sales-orders/queries.test.ts                         # vitest
apps/web/lib/sales-orders/badges.ts                               # CHANNEL_BADGE + STATUS_BADGE maps
apps/web/lib/sales-orders/badges.test.ts                          # vitest
apps/web/lib/sales-orders/format.ts                               # formatIDR + formatDateTime helpers
apps/web/lib/sales-orders/format.test.ts                          # vitest

apps/web/app/backoffice/sales-orders/page.tsx                     # server: list
apps/web/app/backoffice/sales-orders/SalesOrdersPageClient.tsx    # client: list UI
apps/web/app/backoffice/sales-orders/[id]/page.tsx                # server: detail
apps/web/app/backoffice/sales-orders/[id]/SalesOrderDetailClient.tsx  # client: detail UI
```

**Modified files:**

```
apps/web/lib/constants/enums.ts                                   # + SalesChannel + SalesOrderStatus
apps/web/lib/rbac.ts                                              # + sales_orders:view permission + routes
apps/web/lib/i18n/messages/en.json                                # + nav + salesOrders namespace
apps/web/lib/i18n/messages/id.json                                # + same in Indonesian
apps/web/app/backoffice/BackofficeShell.tsx                       # + nav entry
packages/db/prisma/seed.ts                                        # + sales_orders:view permission seed
```

**Reused (no modification):**

- `apps/web/lib/auth.ts` — `auth()` for session in server components.
- `apps/web/lib/rbac.ts` — `requirePermission()` server-side gate.
- `apps/web/lib/constants/pagination.ts` — `DEFAULT_PAGE_SIZE` (currently 10).
- `apps/web/components/Pager.tsx` — pagination footer.
- `apps/web/components/ui/{table,select,date-range-picker,card,badge,input,skeleton}.tsx` — shadcn primitives.
- `@elorae/db` — server-only Prisma client + types.

**vitest path discipline:** test files under `lib/` use `.test.ts` (matches `apps/web/vitest.config.ts include: ['lib/**/*.test.ts', 'app/**/*.spec.ts']`).

---

## Task 1: Enum constants for client components

Add `SalesChannel` + `SalesOrderStatus` literal mirrors to the client-safe enum file. Per `feedback_client_db_imports`, client components must never import from `@elorae/db`.

**Files:**
- Modify: `apps/web/lib/constants/enums.ts`

- [ ] **Step 1: Open `apps/web/lib/constants/enums.ts` and append the two new const-object enums**

Append at end of file:

```ts
export const SalesChannel = {
  SHOPEE: "SHOPEE",
  TOKOPEDIA: "TOKOPEDIA",
  TIKTOK: "TIKTOK",
  OTHER: "OTHER",
} as const;
export type SalesChannel = (typeof SalesChannel)[keyof typeof SalesChannel];
export const SALES_CHANNEL_VALUES = Object.values(SalesChannel);

export const SalesOrderStatus = {
  NEW: "NEW",
  PROCESSING: "PROCESSING",
  SHIPPED: "SHIPPED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  RETURNED: "RETURNED",
} as const;
export type SalesOrderStatus = (typeof SalesOrderStatus)[keyof typeof SalesOrderStatus];
export const SALES_ORDER_STATUS_VALUES = Object.values(SalesOrderStatus);
```

Use double quotes — `apps/web` is on double quotes since 2026-05-27.

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/constants/enums.ts
git commit -m "feat(web): client-safe SalesChannel + SalesOrderStatus enum literals"
```

---

## Task 2: Badge mapping helper (TDD)

Centralise the channel + status → badge variant mapping. One source of truth for both list table and detail header.

**Files:**
- Create: `apps/web/lib/sales-orders/badges.ts`
- Create: `apps/web/lib/sales-orders/badges.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/lib/sales-orders/badges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CHANNEL_BADGE, STATUS_BADGE } from "./badges";

describe("CHANNEL_BADGE", () => {
  it("has an entry per SalesChannel value with a label + tailwindClass", () => {
    expect(CHANNEL_BADGE.SHOPEE).toEqual({ labelKey: "shopee", tailwindClass: expect.any(String) });
    expect(CHANNEL_BADGE.TOKOPEDIA).toEqual({ labelKey: "tokopedia", tailwindClass: expect.any(String) });
    expect(CHANNEL_BADGE.TIKTOK).toEqual({ labelKey: "tiktok", tailwindClass: expect.any(String) });
    expect(CHANNEL_BADGE.OTHER).toEqual({ labelKey: "other", tailwindClass: expect.any(String) });
  });
});

describe("STATUS_BADGE", () => {
  it("has an entry per SalesOrderStatus value with a tailwindClass", () => {
    expect(STATUS_BADGE.NEW.tailwindClass).toEqual(expect.any(String));
    expect(STATUS_BADGE.PROCESSING.tailwindClass).toEqual(expect.any(String));
    expect(STATUS_BADGE.SHIPPED.tailwindClass).toEqual(expect.any(String));
    expect(STATUS_BADGE.COMPLETED.tailwindClass).toEqual(expect.any(String));
    expect(STATUS_BADGE.CANCELLED.tailwindClass).toEqual(expect.any(String));
    expect(STATUS_BADGE.RETURNED.tailwindClass).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm -F @elorae/web test -- badges.test.ts
```

Expected: FAIL with `Cannot find module './badges'`.

- [ ] **Step 3: Implement the mapping**

`apps/web/lib/sales-orders/badges.ts`:

```ts
import type { SalesChannel, SalesOrderStatus } from "@/lib/constants/enums";

type ChannelBadge = { labelKey: string; tailwindClass: string };
type StatusBadge = { tailwindClass: string };

export const CHANNEL_BADGE: Record<SalesChannel, ChannelBadge> = {
  SHOPEE:    { labelKey: "shopee",    tailwindClass: "bg-orange-100 text-orange-800 border-orange-200" },
  TOKOPEDIA: { labelKey: "tokopedia", tailwindClass: "bg-green-100 text-green-800 border-green-200" },
  TIKTOK:    { labelKey: "tiktok",    tailwindClass: "bg-zinc-900 text-zinc-50 border-zinc-700" },
  OTHER:     { labelKey: "other",     tailwindClass: "bg-zinc-100 text-zinc-700 border-zinc-200" },
};

export const STATUS_BADGE: Record<SalesOrderStatus, StatusBadge> = {
  NEW:        { tailwindClass: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  PROCESSING: { tailwindClass: "bg-amber-100 text-amber-800 border-amber-200" },
  SHIPPED:    { tailwindClass: "bg-blue-100 text-blue-800 border-blue-200" },
  COMPLETED:  { tailwindClass: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  CANCELLED:  { tailwindClass: "bg-red-100 text-red-800 border-red-200" },
  RETURNED:   { tailwindClass: "bg-violet-100 text-violet-800 border-violet-200" },
};
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm -F @elorae/web test -- badges.test.ts
```

Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/sales-orders/badges.ts apps/web/lib/sales-orders/badges.test.ts
git commit -m "feat(web): channel + status badge mapping for sales orders"
```

---

## Task 3: Format helpers (TDD)

Currency + date-time formatters used by both list and detail pages.

**Files:**
- Create: `apps/web/lib/sales-orders/format.ts`
- Create: `apps/web/lib/sales-orders/format.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/lib/sales-orders/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatIDR, formatDateTime } from "./format";

describe("formatIDR", () => {
  it("formats a numeric string as Rp with thousand separators, no decimals", () => {
    // Indonesian locale outputs "Rp" + non-breaking space (U+00A0) + digits; match with \s
    expect(formatIDR("100000")).toMatch(/^Rp\s*100\.000$/);
    expect(formatIDR("1000000")).toMatch(/^Rp\s*1\.000\.000$/);
  });

  it("handles zero", () => {
    expect(formatIDR("0")).toMatch(/^Rp\s*0$/);
  });

  it("handles empty / null fallback as Rp 0", () => {
    expect(formatIDR("")).toMatch(/^Rp\s*0$/);
    expect(formatIDR(null)).toMatch(/^Rp\s*0$/);
    expect(formatIDR(undefined)).toMatch(/^Rp\s*0$/);
  });

  it("accepts a number as well as a string", () => {
    expect(formatIDR(50000)).toMatch(/^Rp\s*50\.000$/);
  });
});

describe("formatDateTime", () => {
  it("renders a Date as 'dd MMM yyyy, HH:mm' in the en-GB locale", () => {
    const d = new Date("2026-06-11T10:30:00.000Z");
    const out = formatDateTime(d, "en-GB");
    expect(out).toMatch(/11 Jun 2026/);
    expect(out).toMatch(/10:30|17:30/); // either UTC or WIB depending on test env
  });

  it("renders id-ID locale with Indonesian month names", () => {
    const d = new Date("2026-06-11T10:30:00.000Z");
    const out = formatDateTime(d, "id-ID");
    expect(out).toMatch(/Jun|Juni/);
    expect(out).toMatch(/2026/);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm -F @elorae/web test -- format.test.ts
```

Expected: FAIL with `Cannot find module './format'`.

- [ ] **Step 3: Implement the helpers**

`apps/web/lib/sales-orders/format.ts`:

```ts
const IDR_FORMATTER = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatIDR(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return IDR_FORMATTER.format(0);
  const n = typeof value === "string" ? Number(value) : value;
  return IDR_FORMATTER.format(Number.isFinite(n) ? n : 0);
}

export function formatDateTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm -F @elorae/web test -- format.test.ts
```

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/sales-orders/format.ts apps/web/lib/sales-orders/format.test.ts
git commit -m "feat(web): IDR + datetime formatters for sales orders"
```

---

## Task 4: RBAC permission registration

Add `sales_orders:view` to the PERMISSIONS const, ROUTE_PERMISSIONS map, and BACKOFFICE_ROUTES_ORDER.

**Files:**
- Modify: `apps/web/lib/rbac.ts`

- [ ] **Step 1: Add the permission code to `ROUTE_PERMISSIONS`**

Inside `ROUTE_PERMISSIONS` map (frontend section), add:

```ts
  '/backoffice/sales-orders': 'sales_orders:view',
```

- [ ] **Step 2: Add to `BACKOFFICE_ROUTES_ORDER`**

Insert after `'/backoffice/work-orders'` and before `'/backoffice/forecast'`:

```ts
  '/backoffice/sales-orders',
```

- [ ] **Step 3: Add to the `PERMISSIONS` const**

Inside the `PERMISSIONS` object literal, add a new section after `// Items`:

```ts
  // Sales Orders
  SALES_ORDERS_VIEW: 'sales_orders:view',
```

- [ ] **Step 4: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/rbac.ts
git commit -m "feat(web): RBAC permission for sales orders dashboard"
```

---

## Task 5: Seed permission row

Add `sales_orders:view` to `packages/db/prisma/seed.ts` so the permission exists in the DB. Assign it to the same roles that hold `items:view`.

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Add the permission descriptor**

Find the permission descriptors array in `seed.ts`. Locate the line:

```ts
    { code: 'items:view', module: 'items', action: 'view', description: 'View items' },
```

Add directly below (or in a co-located cluster):

```ts
    { code: 'sales_orders:view', module: 'sales_orders', action: 'view', description: 'View marketplace sales orders' },
```

- [ ] **Step 2: Grant to roles that currently get `items:view`**

Inside `seed.ts`, find each role-permission array that includes `'items:view'` (around lines 234, 261, 287 per the existing grep results). Add `'sales_orders:view'` to each of those same arrays.

Use:

```bash
grep -n "'items:view'" packages/db/prisma/seed.ts
```

to locate exact lines. For each occurrence inside a role's permission list, append `, 'sales_orders:view'`.

- [ ] **Step 3: Verify the file still parses**

```bash
pnpm -F @elorae/db build
```

Expected: PASS.

- [ ] **Step 4: DO NOT run `pnpm -F @elorae/db seed`**

The user runs the seed against shared TiDB (per `feedback_service_control`). Stop and tell the user the seed is updated.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(db): seed sales_orders:view permission"
```

---

## Task 6: Query layer (TDD)

Two functions: `listSalesOrders` and `getSalesOrderById`. Decimal columns serialise to string at the boundary so client never imports `@elorae/db`.

**Files:**
- Create: `apps/web/lib/sales-orders/queries.ts`
- Create: `apps/web/lib/sales-orders/queries.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/lib/sales-orders/queries.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    salesOrder: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@elorae/db";
import { listSalesOrders, getSalesOrderById } from "./queries";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listSalesOrders", () => {
  it("returns empty result when no rows", async () => {
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    const r = await listSalesOrders({}, { page: 1, pageSize: 10 });

    expect(r).toEqual({ orders: [], totalCount: 0 });
  });

  it("translates filter to Prisma where clause", async () => {
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listSalesOrders(
      { search: "Alice", channel: "SHOPEE", status: "COMPLETED", dateFrom: new Date("2026-06-01"), dateTo: new Date("2026-06-30") },
      { page: 1, pageSize: 10 },
    );

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.where.channel).toBe("SHOPEE");
    expect(args.where.status).toBe("COMPLETED");
    expect(args.where.transactionDate).toEqual({
      gte: new Date("2026-06-01"),
      lte: new Date("2026-06-30"),
    });
    expect(args.where.OR).toEqual([
      { salesorderNo: { contains: "Alice" } },
      { customerName: { contains: "Alice" } },
    ]);
  });

  it("omits where keys when filters are undefined", async () => {
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listSalesOrders({}, { page: 1, pageSize: 10 });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.where.channel).toBeUndefined();
    expect(args.where.status).toBeUndefined();
    expect(args.where.transactionDate).toBeUndefined();
    expect(args.where.OR).toBeUndefined();
  });

  it("applies pagination", async () => {
    (prisma.salesOrder.findMany as any).mockResolvedValue([]);
    (prisma.salesOrder.count as any).mockResolvedValue(0);

    await listSalesOrders({}, { page: 3, pageSize: 25 });

    const args = (prisma.salesOrder.findMany as any).mock.calls[0][0];
    expect(args.skip).toBe(50);
    expect(args.take).toBe(25);
    expect(args.orderBy).toEqual({ transactionDate: "desc" });
  });

  it("serialises Decimal columns to strings", async () => {
    (prisma.salesOrder.findMany as any).mockResolvedValue([{
      id: "so1",
      salesorderNo: "TT-001",
      channel: "TOKOPEDIA",
      status: "COMPLETED",
      customerName: "Alice",
      grandTotal: { toString: () => "97000" },
      transactionDate: new Date("2026-06-11T10:00:00.000Z"),
    }]);
    (prisma.salesOrder.count as any).mockResolvedValue(1);

    const r = await listSalesOrders({}, { page: 1, pageSize: 10 });

    expect(r.orders[0].grandTotal).toBe("97000");
    expect(r.orders[0].transactionDate).toBeInstanceOf(Date);
  });
});

describe("getSalesOrderById", () => {
  it("returns null when not found", async () => {
    (prisma.salesOrder.findUnique as any).mockResolvedValue(null);
    expect(await getSalesOrderById("missing")).toBeNull();
  });

  it("serialises Decimal columns on the order and every item", async () => {
    (prisma.salesOrder.findUnique as any).mockResolvedValue({
      id: "so1",
      salesorderNo: "TT-001",
      channel: "TOKOPEDIA",
      status: "COMPLETED",
      subTotal: { toString: () => "100000" },
      grandTotal: { toString: () => "97000" },
      items: [
        { id: "i1", productName: "Item A", qty: { toString: () => "1.0000" }, lineTotal: { toString: () => "97000" } },
      ],
    });

    const r = await getSalesOrderById("so1");

    expect(r!.order.grandTotal).toBe("97000");
    expect(r!.order.subTotal).toBe("100000");
    expect(r!.items[0].qty).toBe("1.0000");
    expect(r!.items[0].lineTotal).toBe("97000");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm -F @elorae/web test -- queries.test.ts
```

Expected: FAIL with `Cannot find module './queries'`.

- [ ] **Step 3: Implement the queries**

`apps/web/lib/sales-orders/queries.ts`:

```ts
import { prisma } from "@elorae/db";
import type { SalesChannel, SalesOrderStatus } from "@/lib/constants/enums";

export type SalesOrderListFilter = {
  search?: string;
  channel?: SalesChannel;
  status?: SalesOrderStatus;
  dateFrom?: Date;
  dateTo?: Date;
};

export type Pagination = { page: number; pageSize: number };

export type SalesOrderListRow = {
  id: string;
  salesorderNo: string;
  channel: SalesChannel;
  status: SalesOrderStatus;
  customerName: string | null;
  grandTotal: string;
  transactionDate: Date;
};

export type SalesOrderDetail = {
  id: string;
  salesorderId: number;
  salesorderNo: string;
  channel: SalesChannel;
  sourceName: string;
  status: SalesOrderStatus;
  channelStatus: string | null;
  internalStatus: string | null;
  wmsStatus: string | null;
  isCanceled: boolean;
  isPaid: boolean;
  markedAsComplete: boolean;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  shippingProvince: string | null;
  shippingCity: string | null;
  shippingAddress: Record<string, string | null> | null;
  subTotal: string;
  totalDisc: string;
  totalTax: string;
  shippingCost: string;
  grandTotal: string;
  feeBreakdown: Record<string, string> | null;
  paymentMethod: string | null;
  paymentDate: Date | null;
  transactionDate: Date;
  createdDateJubelio: Date | null;
  completedDate: Date | null;
  cancelDate: Date | null;
  lastModifiedJubelio: Date | null;
  trackingNumber: string | null;
  courier: string | null;
};

export type SalesOrderItemRow = {
  id: string;
  salesorderDetailId: number;
  jubelioItemId: number;
  jubelioItemCode: string;
  itemId: string | null;
  productName: string;
  qty: string;
  qtyInBase: string;
  returnedQty: string;
  isCanceledItem: boolean;
  unitPrice: string;
  pricePaid: string;
  discAmount: string;
  taxAmount: string;
  lineTotal: string;
  discMarketplace: string;
  weightInGram: string;
};

function buildWhere(f: SalesOrderListFilter) {
  const where: Record<string, unknown> = {};
  if (f.channel) where.channel = f.channel;
  if (f.status) where.status = f.status;
  if (f.dateFrom || f.dateTo) {
    where.transactionDate = {
      ...(f.dateFrom ? { gte: f.dateFrom } : {}),
      ...(f.dateTo ? { lte: f.dateTo } : {}),
    };
  }
  if (f.search && f.search.trim().length > 0) {
    const s = f.search.trim();
    where.OR = [
      { salesorderNo: { contains: s } },
      { customerName: { contains: s } },
    ];
  }
  return where;
}

export async function listSalesOrders(
  filter: SalesOrderListFilter,
  pagination: Pagination,
): Promise<{ orders: SalesOrderListRow[]; totalCount: number }> {
  const where = buildWhere(filter);
  const [rows, totalCount] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      orderBy: { transactionDate: "desc" },
      select: {
        id: true,
        salesorderNo: true,
        channel: true,
        status: true,
        customerName: true,
        grandTotal: true,
        transactionDate: true,
      },
    }),
    prisma.salesOrder.count({ where }),
  ]);

  const orders: SalesOrderListRow[] = rows.map((r) => ({
    id: r.id,
    salesorderNo: r.salesorderNo,
    channel: r.channel as SalesChannel,
    status: r.status as SalesOrderStatus,
    customerName: r.customerName,
    grandTotal: r.grandTotal.toString(),
    transactionDate: r.transactionDate,
  }));

  return { orders, totalCount };
}

export async function getSalesOrderById(
  id: string,
): Promise<{ order: SalesOrderDetail; items: SalesOrderItemRow[] } | null> {
  const row = await prisma.salesOrder.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!row) return null;

  const order: SalesOrderDetail = {
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
  };

  const items: SalesOrderItemRow[] = row.items.map((it) => ({
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

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm -F @elorae/web test -- queries.test.ts
```

Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/sales-orders/queries.ts apps/web/lib/sales-orders/queries.test.ts
git commit -m "feat(web): query layer for sales-orders dashboard"
```

---

## Task 7: i18n keys (en + id)

All user-facing strings. Two files in lockstep.

**Files:**
- Modify: `apps/web/lib/i18n/messages/en.json`
- Modify: `apps/web/lib/i18n/messages/id.json`

- [ ] **Step 1: Locate the `navigation` block in `en.json` and add `salesOrders`**

Find the line in `apps/web/lib/i18n/messages/en.json`:

```json
    "items": "Items",
```

Add directly above (or near other top-level nav entries):

```json
    "salesOrders": "Sales Orders",
```

Same for `id.json` — use Indonesian translation `"Pesanan"`:

```json
    "salesOrders": "Pesanan",
```

- [ ] **Step 2: Add a new top-level `salesOrders` namespace at the end of `en.json` (before the closing brace)**

```json
  "salesOrders": {
    "pageTitle": "Sales Orders",
    "pageSubtitle": "Marketplace orders received via Jubelio",
    "empty": "No marketplace orders yet — orders appear here as Jubelio webhooks arrive.",
    "emptyFiltered": "No orders match these filters.",
    "filter": {
      "searchPlaceholder": "Search by order # or buyer name",
      "channel": "Channel",
      "status": "Status",
      "dateRange": "Date range",
      "reset": "Reset",
      "all": "All"
    },
    "table": {
      "orderNo": "Order #",
      "channel": "Channel",
      "buyer": "Buyer",
      "total": "Total",
      "status": "Status",
      "date": "Date"
    },
    "detail": {
      "back": "Back to list",
      "section": {
        "buyer": "Buyer",
        "orderMeta": "Order info",
        "lineItems": "Line items",
        "totals": "Totals",
        "rawStatus": "Status (raw)",
        "feeBreakdown": "Fee breakdown"
      },
      "field": {
        "customerName": "Name",
        "customerPhone": "Phone",
        "customerEmail": "Email",
        "shippingAddress": "Shipping address",
        "transactionDate": "Transaction date",
        "paymentMethod": "Payment method",
        "paymentDate": "Paid at",
        "courier": "Courier",
        "trackingNumber": "Tracking #",
        "channelStatus": "Channel status",
        "internalStatus": "Internal status",
        "wmsStatus": "WMS status",
        "isCanceled": "Canceled",
        "isPaid": "Paid",
        "markedAsComplete": "Marked complete",
        "subTotal": "Subtotal",
        "totalDisc": "Discount",
        "totalTax": "Tax",
        "shippingCost": "Shipping",
        "grandTotal": "Grand total"
      },
      "lineCol": {
        "sku": "SKU",
        "product": "Product",
        "qty": "Qty",
        "unitPrice": "Unit price",
        "discount": "Discount",
        "lineTotal": "Line total"
      }
    },
    "channel": {
      "shopee": "Shopee",
      "tokopedia": "Tokopedia",
      "tiktok": "TikTok",
      "other": "Other"
    },
    "status": {
      "NEW": "New",
      "PROCESSING": "Processing",
      "SHIPPED": "Shipped",
      "COMPLETED": "Completed",
      "CANCELLED": "Cancelled",
      "RETURNED": "Returned"
    },
    "fee": {
      "insurance_cost": "Insurance",
      "add_fee": "Additional fee",
      "add_disc": "Additional discount",
      "service_fee": "Service fee",
      "escrow_amount": "Escrow",
      "voucher_amount": "Voucher",
      "cod_fee": "COD fee",
      "order_processing_fee": "Order processing",
      "shipping_tax": "Shipping tax",
      "total_amount_mp": "Marketplace total"
    },
    "yes": "Yes",
    "no": "No"
  }
```

- [ ] **Step 3: Add the same namespace at the end of `id.json` with Indonesian translations**

```json
  "salesOrders": {
    "pageTitle": "Pesanan",
    "pageSubtitle": "Pesanan dari marketplace via Jubelio",
    "empty": "Belum ada pesanan marketplace — pesanan akan muncul di sini setelah webhook Jubelio diterima.",
    "emptyFiltered": "Tidak ada pesanan yang cocok dengan filter ini.",
    "filter": {
      "searchPlaceholder": "Cari berdasarkan nomor pesanan atau nama pembeli",
      "channel": "Channel",
      "status": "Status",
      "dateRange": "Rentang tanggal",
      "reset": "Reset",
      "all": "Semua"
    },
    "table": {
      "orderNo": "No. Pesanan",
      "channel": "Channel",
      "buyer": "Pembeli",
      "total": "Total",
      "status": "Status",
      "date": "Tanggal"
    },
    "detail": {
      "back": "Kembali ke daftar",
      "section": {
        "buyer": "Pembeli",
        "orderMeta": "Info Pesanan",
        "lineItems": "Item Pesanan",
        "totals": "Total",
        "rawStatus": "Status (mentah)",
        "feeBreakdown": "Rincian Biaya"
      },
      "field": {
        "customerName": "Nama",
        "customerPhone": "Telepon",
        "customerEmail": "Email",
        "shippingAddress": "Alamat pengiriman",
        "transactionDate": "Tanggal transaksi",
        "paymentMethod": "Metode pembayaran",
        "paymentDate": "Dibayar pada",
        "courier": "Kurir",
        "trackingNumber": "No. Resi",
        "channelStatus": "Status channel",
        "internalStatus": "Status internal",
        "wmsStatus": "Status WMS",
        "isCanceled": "Dibatalkan",
        "isPaid": "Lunas",
        "markedAsComplete": "Ditandai selesai",
        "subTotal": "Subtotal",
        "totalDisc": "Diskon",
        "totalTax": "Pajak",
        "shippingCost": "Ongkos kirim",
        "grandTotal": "Total"
      },
      "lineCol": {
        "sku": "SKU",
        "product": "Produk",
        "qty": "Jml",
        "unitPrice": "Harga satuan",
        "discount": "Diskon",
        "lineTotal": "Total baris"
      }
    },
    "channel": {
      "shopee": "Shopee",
      "tokopedia": "Tokopedia",
      "tiktok": "TikTok",
      "other": "Lainnya"
    },
    "status": {
      "NEW": "Baru",
      "PROCESSING": "Diproses",
      "SHIPPED": "Dikirim",
      "COMPLETED": "Selesai",
      "CANCELLED": "Dibatalkan",
      "RETURNED": "Dikembalikan"
    },
    "fee": {
      "insurance_cost": "Asuransi",
      "add_fee": "Biaya tambahan",
      "add_disc": "Diskon tambahan",
      "service_fee": "Biaya layanan",
      "escrow_amount": "Escrow",
      "voucher_amount": "Voucher",
      "cod_fee": "Biaya COD",
      "order_processing_fee": "Biaya pemrosesan",
      "shipping_tax": "Pajak pengiriman",
      "total_amount_mp": "Total marketplace"
    },
    "yes": "Ya",
    "no": "Tidak"
  }
```

- [ ] **Step 4: Verify both files still parse as JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/en.json'));"
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/id.json'));"
```

Expected: both exit 0.

- [ ] **Step 5: Type-check (next-intl validates message shape at compile)**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/i18n/messages/en.json apps/web/lib/i18n/messages/id.json
git commit -m "i18n: sales orders dashboard strings (en + id)"
```

---

## Task 8: List page (server + client)

Server: auth, RBAC, parse searchParams, run query, pass to client. Client: filter bar + table + pager.

**Files:**
- Create: `apps/web/app/backoffice/sales-orders/page.tsx`
- Create: `apps/web/app/backoffice/sales-orders/SalesOrdersPageClient.tsx`

- [ ] **Step 1: Write the server component**

`apps/web/app/backoffice/sales-orders/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { SALES_CHANNEL_VALUES, SALES_ORDER_STATUS_VALUES } from "@/lib/constants/enums";
import type { SalesChannel, SalesOrderStatus } from "@/lib/constants/enums";
import { listSalesOrders } from "@/lib/sales-orders/queries";
import { SalesOrdersPageClient } from "./SalesOrdersPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    channel?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: string;
  }>;
};

function parseChannel(raw: string | undefined): SalesChannel | undefined {
  if (!raw) return undefined;
  return (SALES_CHANNEL_VALUES as readonly string[]).includes(raw) ? (raw as SalesChannel) : undefined;
}

function parseStatus(raw: string | undefined): SalesOrderStatus | undefined {
  if (!raw) return undefined;
  return (SALES_ORDER_STATUS_VALUES as readonly string[]).includes(raw) ? (raw as SalesOrderStatus) : undefined;
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function SalesOrdersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  requirePermission(session.user.permissions ?? [], "sales_orders:view");

  const sp = await searchParams;
  const filter = {
    search: sp.search?.trim() || undefined,
    channel: parseChannel(sp.channel),
    status: parseStatus(sp.status),
    dateFrom: parseDate(sp.dateFrom),
    dateTo: parseDate(sp.dateTo),
  };
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const { orders, totalCount } = await listSalesOrders(filter, { page, pageSize: DEFAULT_PAGE_SIZE });

  return (
    <SalesOrdersPageClient
      orders={orders}
      totalCount={totalCount}
      search={filter.search ?? ""}
      channel={filter.channel ?? ""}
      status={filter.status ?? ""}
      dateFrom={sp.dateFrom ?? ""}
      dateTo={sp.dateTo ?? ""}
      page={page}
      pageSize={DEFAULT_PAGE_SIZE}
    />
  );
}
```

- [ ] **Step 2: Write the client component**

`apps/web/app/backoffice/sales-orders/SalesOrdersPageClient.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { SALES_CHANNEL_VALUES, SALES_ORDER_STATUS_VALUES } from "@/lib/constants/enums";
import type { SalesOrderListRow } from "@/lib/sales-orders/queries";
import { CHANNEL_BADGE, STATUS_BADGE } from "@/lib/sales-orders/badges";
import { formatIDR, formatDateTime } from "@/lib/sales-orders/format";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/Pager";

type Props = {
  orders: SalesOrderListRow[];
  totalCount: number;
  search: string;
  channel: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};

export function SalesOrdersPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("salesOrders");
  const locale = useLocale();
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(props.search);

  // Debounce search input → URL push
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== props.search) pushParam("search", searchInput);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    params.delete("page"); // reset to page 1 when any filter changes
    startTransition(() => router.push(`/backoffice/sales-orders?${params.toString()}`));
  }

  function reset() {
    setSearchInput("");
    startTransition(() => router.push("/backoffice/sales-orders"));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground">{t("pageSubtitle")}</p>
      </div>

      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <Input
            placeholder={t("filter.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select
          value={props.channel || "ALL"}
          onValueChange={(v) => pushParam("channel", v === "ALL" ? undefined : v)}
        >
          <SelectTrigger className="w-[160px]"><SelectValue placeholder={t("filter.channel")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("filter.all")}</SelectItem>
            {SALES_CHANNEL_VALUES.map((c) => (
              <SelectItem key={c} value={c}>{t(`channel.${CHANNEL_BADGE[c].labelKey}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={props.status || "ALL"}
          onValueChange={(v) => pushParam("status", v === "ALL" ? undefined : v)}
        >
          <SelectTrigger className="w-[160px]"><SelectValue placeholder={t("filter.status")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("filter.all")}</SelectItem>
            {SALES_ORDER_STATUS_VALUES.map((s) => (
              <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={props.dateFrom}
          onChange={(e) => pushParam("dateFrom", e.target.value || undefined)}
          className="w-[160px]"
        />
        <Input
          type="date"
          value={props.dateTo}
          onChange={(e) => pushParam("dateTo", e.target.value || undefined)}
          className="w-[160px]"
        />
        <Button variant="outline" onClick={reset}>{t("filter.reset")}</Button>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.orderNo")}</TableHead>
              <TableHead>{t("table.channel")}</TableHead>
              <TableHead>{t("table.buyer")}</TableHead>
              <TableHead className="text-right">{t("table.total")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.date")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {props.search || props.channel || props.status || props.dateFrom || props.dateTo
                    ? t("emptyFiltered")
                    : t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              props.orders.map((o) => (
                <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/backoffice/sales-orders/${o.id}`} className="font-mono text-sm">
                      {o.salesorderNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CHANNEL_BADGE[o.channel].tailwindClass}`}>
                      {t(`channel.${CHANNEL_BADGE[o.channel].labelKey}`)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{o.customerName ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatIDR(o.grandTotal)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[o.status].tailwindClass}`}>
                      {t(`status.${o.status}`)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(o.transactionDate, locale)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {props.totalCount > props.pageSize && (
        <Pager
          page={props.page}
          pageSize={props.pageSize}
          total={props.totalCount}
          onPageChange={(p) => {
            const params = new URLSearchParams(sp.toString());
            params.set("page", String(p));
            startTransition(() => router.push(`/backoffice/sales-orders?${params.toString()}`));
          }}
          onPageSizeChange={() => {}}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS. If `next-intl` complains about missing message keys, double-check Task 7 saved correctly.

- [ ] **Step 4: Start dev server and visually verify the page renders**

```bash
# user starts the dev server per feedback_service_control
# Once running: open http://localhost:3000/backoffice/sales-orders
```

If sub-A migration is deployed and orders exist (smoke from sub-A), they appear. Else empty state shows.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/backoffice/sales-orders/page.tsx apps/web/app/backoffice/sales-orders/SalesOrdersPageClient.tsx
git commit -m "feat(web): sales orders list page with filter + search"
```

---

## Task 9: Detail page (server + client)

**Files:**
- Create: `apps/web/app/backoffice/sales-orders/[id]/page.tsx`
- Create: `apps/web/app/backoffice/sales-orders/[id]/SalesOrderDetailClient.tsx`

- [ ] **Step 1: Write the server component**

`apps/web/app/backoffice/sales-orders/[id]/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/rbac";
import { getSalesOrderById } from "@/lib/sales-orders/queries";
import { SalesOrderDetailClient } from "./SalesOrderDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SalesOrderDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  requirePermission(session.user.permissions ?? [], "sales_orders:view");

  const { id } = await params;
  const data = await getSalesOrderById(id);
  if (!data) notFound();

  return <SalesOrderDetailClient order={data.order} items={data.items} />;
}
```

- [ ] **Step 2: Write the client component**

`apps/web/app/backoffice/sales-orders/[id]/SalesOrderDetailClient.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft } from "lucide-react";
import type { SalesOrderDetail, SalesOrderItemRow } from "@/lib/sales-orders/queries";
import { CHANNEL_BADGE, STATUS_BADGE } from "@/lib/sales-orders/badges";
import { formatIDR, formatDateTime } from "@/lib/sales-orders/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Props = { order: SalesOrderDetail; items: SalesOrderItemRow[] };

export function SalesOrderDetailClient({ order, items }: Props) {
  const t = useTranslations("salesOrders");
  const locale = useLocale();

  const feeEntries = order.feeBreakdown
    ? Object.entries(order.feeBreakdown).filter(([, v]) => v && v !== "0")
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/backoffice/sales-orders"><ArrowLeft className="h-4 w-4 mr-2" />{t("detail.back")}</Link>
        </Button>
        <h1 className="text-2xl font-semibold font-mono">{order.salesorderNo}</h1>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CHANNEL_BADGE[order.channel].tailwindClass}`}>
          {t(`channel.${CHANNEL_BADGE[order.channel].labelKey}`)}
        </span>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[order.status].tailwindClass}`}>
          {t(`status.${order.status}`)}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.section.buyer")}</h2>
          <Field label={t("detail.field.customerName")} value={order.customerName} />
          <Field label={t("detail.field.customerPhone")} value={order.customerPhone} />
          <Field label={t("detail.field.customerEmail")} value={order.customerEmail} />
          {order.shippingAddress && (
            <div className="pt-2 border-t">
              <div className="text-sm text-muted-foreground mb-1">{t("detail.field.shippingAddress")}</div>
              <ShippingBlock addr={order.shippingAddress} />
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.section.orderMeta")}</h2>
          <Field label={t("detail.field.transactionDate")} value={formatDateTime(order.transactionDate, locale)} />
          <Field label={t("detail.field.paymentMethod")} value={order.paymentMethod} />
          <Field label={t("detail.field.paymentDate")} value={order.paymentDate ? formatDateTime(order.paymentDate, locale) : null} />
          <Field label={t("detail.field.courier")} value={order.courier} />
          <Field label={t("detail.field.trackingNumber")} value={order.trackingNumber} />
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">{t("detail.section.lineItems")}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("detail.lineCol.sku")}</TableHead>
              <TableHead>{t("detail.lineCol.product")}</TableHead>
              <TableHead className="text-right">{t("detail.lineCol.qty")}</TableHead>
              <TableHead className="text-right">{t("detail.lineCol.unitPrice")}</TableHead>
              <TableHead className="text-right">{t("detail.lineCol.discount")}</TableHead>
              <TableHead className="text-right">{t("detail.lineCol.lineTotal")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <TableRow key={it.id}>
                <TableCell className="font-mono text-sm">
                  {it.itemId
                    ? <Link href={`/backoffice/items/${it.itemId}`} className="hover:underline">{it.jubelioItemCode}</Link>
                    : it.jubelioItemCode}
                </TableCell>
                <TableCell>{it.productName}</TableCell>
                <TableCell className="text-right">{it.qty}</TableCell>
                <TableCell className="text-right">{formatIDR(it.unitPrice)}</TableCell>
                <TableCell className="text-right">{formatIDR(it.discAmount)}</TableCell>
                <TableCell className="text-right">{formatIDR(it.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.section.totals")}</h2>
          <Field label={t("detail.field.subTotal")} value={formatIDR(order.subTotal)} />
          <Field label={t("detail.field.totalDisc")} value={formatIDR(order.totalDisc)} />
          <Field label={t("detail.field.totalTax")} value={formatIDR(order.totalTax)} />
          <Field label={t("detail.field.shippingCost")} value={formatIDR(order.shippingCost)} />
          <div className="pt-2 border-t flex justify-between font-semibold">
            <span>{t("detail.field.grandTotal")}</span>
            <span>{formatIDR(order.grandTotal)}</span>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.section.rawStatus")}</h2>
          <Field label={t("detail.field.channelStatus")} value={order.channelStatus} />
          <Field label={t("detail.field.internalStatus")} value={order.internalStatus} />
          <Field label={t("detail.field.wmsStatus")} value={order.wmsStatus} />
          <Field label={t("detail.field.isCanceled")} value={order.isCanceled ? t("yes") : t("no")} />
          <Field label={t("detail.field.isPaid")} value={order.isPaid ? t("yes") : t("no")} />
          <Field label={t("detail.field.markedAsComplete")} value={order.markedAsComplete ? t("yes") : t("no")} />
        </Card>
      </div>

      {feeEntries.length > 0 && (
        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.section.feeBreakdown")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            {feeEntries.map(([key, value]) => (
              <Field
                key={key}
                label={t.has(`fee.${key}`) ? t(`fee.${key}`) : key}
                value={formatIDR(value)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function ShippingBlock({ addr }: { addr: Record<string, string | null> }) {
  const lines: string[] = [];
  if (addr.full_name) lines.push(addr.full_name);
  if (addr.phone) lines.push(addr.phone);
  if (addr.address) lines.push(addr.address);
  const cityProvince = [addr.city, addr.province].filter(Boolean).join(", ");
  if (cityProvince) lines.push(cityProvince);
  if (addr.post_code) lines.push(addr.post_code);
  if (addr.country) lines.push(addr.country);
  return (
    <div className="text-sm whitespace-pre-line">
      {lines.join("\n")}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS. The `t.has()` call requires `next-intl` 3.x — verify with `grep '"next-intl"' apps/web/package.json` if the compiler complains; fall back to a static `KNOWN_FEE_KEYS` set if `t.has` isn't available.

- [ ] **Step 4: Manual verify in dev**

Open `/backoffice/sales-orders/<any-existing-order-id>`. All cards render. Line items table shows lines. Totals card adds up to grandTotal.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/backoffice/sales-orders/[id]/page.tsx apps/web/app/backoffice/sales-orders/[id]/SalesOrderDetailClient.tsx
git commit -m "feat(web): sales order detail page"
```

---

## Task 10: Nav entry + final type-check

Add the nav link in `BackofficeShell` so the page is discoverable.

**Files:**
- Modify: `apps/web/app/backoffice/BackofficeShell.tsx`

- [ ] **Step 1: Locate the navigation array in `BackofficeShell.tsx`**

```bash
grep -n "labelKey: 'workOrders'" apps/web/app/backoffice/BackofficeShell.tsx
```

This finds the work-orders nav entry. Sales orders inserts directly above it (alphabetical / workflow order — adjust if BackofficeShell uses a different grouping).

- [ ] **Step 2: Insert the entry**

Add (matching the surrounding entry shape — they use single quotes in this file, keep that style):

```ts
  {
    labelKey: 'salesOrders',
    href: '/backoffice/sales-orders',
  },
```

- [ ] **Step 3: Run final monorepo checks**

```bash
pnpm -F @elorae/web type-check
pnpm -F @elorae/web test
```

Expected: type-check clean, all vitest tests pass (`badges`, `format`, `queries`).

- [ ] **Step 4: Manual smoke (with user-started dev server)**

Tell the user the dev server start command and what to look for. User starts the dev server per `feedback_service_control`, you verify:
1. Nav shows "Sales Orders" entry.
2. Click → `/backoffice/sales-orders` loads, table renders (or empty state).
3. Filter by channel / status / date — URL updates, table refilters.
4. Search box debounces, filters after 300ms.
5. Click row → detail page loads.
6. Detail shows all cards.
7. Logged-in user WITHOUT `sales_orders:view` → 403 redirect (or whatever existing RBAC does).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/backoffice/BackofficeShell.tsx
git commit -m "feat(web): nav entry for sales orders dashboard"
```

---

## Smoke test path (post-merge, not a task)

1. User runs `pnpm -F @elorae/db seed` against prod TiDB to register `sales_orders:view` and grant it to non-admin roles.
2. User restarts apps/web (Vercel auto-deploys on master merge, or local `pnpm -F @elorae/web dev`).
3. Verify in browser:
   - List page renders with real Jubelio orders (sub-A is shipping these live).
   - Filter combinations narrow the result set.
   - Click-through to detail page works for every channel.
   - Empty state for filters with no matches.

No writes to Jubelio, no rollback needed.

---

## Out-of-scope (next sub-projects)

- Sub-C: KPI widgets on `/backoffice/dashboard` (Pending Fulfillment count, Today's Sales total).
- Sub-A-followup: `SalesReturnWebhookHandler` integration once live return webhook is captured.
- Future: column-click sorting, saved filter presets, CSV export, web-write paths for internal status notes.
