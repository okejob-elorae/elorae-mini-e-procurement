# Marketplace KPI Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two marketplace KPI cards ("Pending Fulfillment", "Today's Sales") to `/backoffice/dashboard` (beranda), backed by `SalesOrder` (sub-A). Each card carries an info tooltip explaining its inclusion/exclusion rules.

**Architecture:** Pure `apps/web` change. New `getMarketplaceKpi()` query in `lib/sales-orders/queries.ts` runs in parallel with the existing dashboard `Promise.all`. Server page passes a new `marketplaceKpi` prop to the dashboard client, which renders a new "Marketplace" section above the existing 5-col stats grid. shadcn `<Tooltip>` shows metric criteria on hover/focus of an info icon.

**Tech Stack:** Next.js 16 App Router (RSC + client islands), Prisma 7 read-only, shadcn Tooltip/Card, `next-intl` i18n, vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-marketplace-kpi-widgets-design.md`

---

## File Structure

**Modified files:**

```
apps/web/lib/sales-orders/queries.ts                  # + getMarketplaceKpi + MarketplaceKpi type
apps/web/lib/sales-orders/queries.test.ts             # + 4 new test cases
apps/web/app/backoffice/dashboard/page.tsx            # + parallel fetch + new prop
apps/web/app/backoffice/dashboard/DashboardPageClient.tsx  # + Marketplace section
apps/web/lib/i18n/messages/en.json                    # + 7 keys
apps/web/lib/i18n/messages/id.json                    # + same 7 keys
```

**No new files.** All additions land in existing modules.

---

## Task 1: `getMarketplaceKpi` query (TDD)

Add the data layer first. Pure query against `SalesOrder` with two parallel sub-queries.

**Files:**
- Modify: `apps/web/lib/sales-orders/queries.ts`
- Modify: `apps/web/lib/sales-orders/queries.test.ts`

- [ ] **Step 1: Inspect current test file shape**

```bash
head -20 apps/web/lib/sales-orders/queries.test.ts
```

Note the existing `vi.mock("@elorae/db", ...)` block and `prisma.salesOrder` mock surface (`findMany`, `count`, `findUnique`). For this task we add `prisma.salesOrder.aggregate` to the mock.

- [ ] **Step 2: Extend the `vi.mock` for `@elorae/db` to include `aggregate`**

In `queries.test.ts`, locate the mock declaration:

```ts
vi.mock("@elorae/db", () => ({
  prisma: {
    salesOrder: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));
```

Replace with:

```ts
vi.mock("@elorae/db", () => ({
  prisma: {
    salesOrder: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));
```

- [ ] **Step 3: Write the failing tests**

Append to `queries.test.ts` (after the existing `describe` blocks):

```ts
import { getMarketplaceKpi } from "./queries";

describe("getMarketplaceKpi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros when no orders exist", async () => {
    (prisma.salesOrder.count as any).mockResolvedValue(0);
    (prisma.salesOrder.aggregate as any).mockResolvedValue({
      _count: { _all: 0 },
      _sum: { grandTotal: null },
    });

    const r = await getMarketplaceKpi();

    expect(r).toEqual({
      pendingFulfillmentCount: 0,
      todaySalesCount: 0,
      todaySalesTotal: "0",
    });
  });

  it("queries pending with status IN [NEW, PROCESSING]", async () => {
    (prisma.salesOrder.count as any).mockResolvedValue(7);
    (prisma.salesOrder.aggregate as any).mockResolvedValue({
      _count: { _all: 0 },
      _sum: { grandTotal: null },
    });

    await getMarketplaceKpi();

    const countArgs = (prisma.salesOrder.count as any).mock.calls[0][0];
    expect(countArgs.where.status).toEqual({ in: ["NEW", "PROCESSING"] });
  });

  it("queries today's sales between local-day boundaries excluding cancelled/returned", async () => {
    (prisma.salesOrder.count as any).mockResolvedValue(0);
    (prisma.salesOrder.aggregate as any).mockResolvedValue({
      _count: { _all: 3 },
      _sum: { grandTotal: { toString: () => "250000" } },
    });

    await getMarketplaceKpi();

    const aggArgs = (prisma.salesOrder.aggregate as any).mock.calls[0][0];
    expect(aggArgs.where.status).toEqual({ notIn: ["CANCELLED", "RETURNED"] });
    expect(aggArgs.where.transactionDate.gte).toBeInstanceOf(Date);
    expect(aggArgs.where.transactionDate.lte).toBeInstanceOf(Date);
    const gte = aggArgs.where.transactionDate.gte as Date;
    const lte = aggArgs.where.transactionDate.lte as Date;
    expect(gte.getHours()).toBe(0);
    expect(gte.getMinutes()).toBe(0);
    expect(gte.getSeconds()).toBe(0);
    expect(lte.getHours()).toBe(23);
    expect(lte.getMinutes()).toBe(59);
    expect(lte.getSeconds()).toBe(59);
    expect(gte.getFullYear()).toBe(lte.getFullYear());
    expect(gte.getMonth()).toBe(lte.getMonth());
    expect(gte.getDate()).toBe(lte.getDate());
  });

  it("serialises grandTotal Decimal to string", async () => {
    (prisma.salesOrder.count as any).mockResolvedValue(2);
    (prisma.salesOrder.aggregate as any).mockResolvedValue({
      _count: { _all: 3 },
      _sum: { grandTotal: { toString: () => "12345600" } },
    });

    const r = await getMarketplaceKpi();

    expect(r).toEqual({
      pendingFulfillmentCount: 2,
      todaySalesCount: 3,
      todaySalesTotal: "12345600",
    });
  });
});
```

- [ ] **Step 4: Run tests, expect FAIL**

```bash
pnpm -F @elorae/web test -- queries.test.ts
```

Expected: FAIL on the 4 new cases with `getMarketplaceKpi is not a function` or `getMarketplaceKpi is undefined`.

- [ ] **Step 5: Implement the query**

In `apps/web/lib/sales-orders/queries.ts`, append at the end of the file:

```ts
export type MarketplaceKpi = {
  pendingFulfillmentCount: number;
  todaySalesCount: number;
  todaySalesTotal: string;
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export async function getMarketplaceKpi(): Promise<MarketplaceKpi> {
  const [pendingCount, todayAgg] = await Promise.all([
    prisma.salesOrder.count({
      where: { status: { in: ["NEW", "PROCESSING"] } },
    }),
    prisma.salesOrder.aggregate({
      where: {
        transactionDate: { gte: startOfToday(), lte: endOfToday() },
        status: { notIn: ["CANCELLED", "RETURNED"] },
      },
      _count: { _all: true },
      _sum: { grandTotal: true },
    }),
  ]);

  const sum = todayAgg._sum?.grandTotal;
  return {
    pendingFulfillmentCount: pendingCount,
    todaySalesCount: todayAgg._count._all,
    todaySalesTotal: sum ? sum.toString() : "0",
  };
}
```

- [ ] **Step 6: Run tests, expect PASS**

```bash
pnpm -F @elorae/web test -- queries.test.ts
```

Expected: PASS, all original tests + 4 new ones.

- [ ] **Step 7: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/sales-orders/queries.ts apps/web/lib/sales-orders/queries.test.ts
git commit -m "feat(web): getMarketplaceKpi query for beranda widgets"
```

---

## Task 2: i18n keys (en + id)

Add 7 new keys per locale under the existing `dashboard` namespace.

**Files:**
- Modify: `apps/web/lib/i18n/messages/en.json`
- Modify: `apps/web/lib/i18n/messages/id.json`

- [ ] **Step 1: Find the `dashboard` namespace in `en.json`**

```bash
grep -n "\"dashboard\": {" apps/web/lib/i18n/messages/en.json
```

The `dashboard.*` keys live under that top-level block. Pick a logical spot near other beranda KPI labels (search for `inventoryValue` to locate the kpi-label cluster).

- [ ] **Step 2: Add the 7 keys to `en.json`**

Inside the `dashboard` namespace, append:

```json
    "marketplaceSection": "Marketplace",
    "pendingFulfillmentTitle": "Pending Fulfillment",
    "pendingFulfillmentDesc": "Orders awaiting pack/ship",
    "pendingFulfillmentTooltip": "Orders with status New or Processing. Excludes shipped, completed, cancelled, and returned.",
    "todaySalesTitle": "Today's Sales",
    "todaySalesCount": "{count, plural, one {# order today} other {# orders today}}",
    "todaySalesTooltip": "Orders placed today (by transaction date). Excludes cancelled and returned. Includes pending, processing, shipped, and completed."
```

Use a trailing comma if these are not the final keys in the namespace.

- [ ] **Step 3: Add the same 7 keys to `id.json`**

```json
    "marketplaceSection": "Marketplace",
    "pendingFulfillmentTitle": "Belum Dikirim",
    "pendingFulfillmentDesc": "Pesanan menunggu pengepakan/pengiriman",
    "pendingFulfillmentTooltip": "Pesanan dengan status Baru atau Diproses. Tidak termasuk yang sudah dikirim, selesai, dibatalkan, atau dikembalikan.",
    "todaySalesTitle": "Penjualan Hari Ini",
    "todaySalesCount": "{count, plural, other {# pesanan hari ini}}",
    "todaySalesTooltip": "Pesanan yang dibuat hari ini (berdasarkan tanggal transaksi). Tidak termasuk yang dibatalkan atau dikembalikan. Termasuk baru, diproses, dikirim, dan selesai."
```

- [ ] **Step 4: Verify both files parse as JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/en.json'));"
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/id.json'));"
```

Both must exit 0.

- [ ] **Step 5: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS (`next-intl` validates en/id key parity).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/i18n/messages/en.json apps/web/lib/i18n/messages/id.json
git commit -m "i18n: marketplace KPI widget strings (en + id)"
```

---

## Task 3: Server page — fetch KPI in parallel + pass prop

Wire `getMarketplaceKpi` into the existing dashboard `Promise.all` block and pass it as a new prop.

**Files:**
- Modify: `apps/web/app/backoffice/dashboard/page.tsx`

- [ ] **Step 1: Add the import**

In `apps/web/app/backoffice/dashboard/page.tsx`, add to the imports near the top (next to other `@/lib/...` imports):

```ts
import { getMarketplaceKpi } from '@/lib/sales-orders/queries';
```

(The file uses single quotes; keep that style for this file.)

- [ ] **Step 2: Extend the `Promise.all` destructuring**

Locate the existing block:

```ts
  const [stats, overduePOs, suppliers, cogsRawVsFinished, rawMaterialShortage, woStatusCounts] =
    await Promise.all([
      getDashboardStats(),
      getOverduePOs(),
      getSuppliersForReportFilter(),
      getCOGSRawVsFinished(),
      getRawMaterialShortage(),
      getWorkOrderCountByStatus(),
    ]);
```

Replace with:

```ts
  const [stats, overduePOs, suppliers, cogsRawVsFinished, rawMaterialShortage, woStatusCounts, marketplaceKpi] =
    await Promise.all([
      getDashboardStats(),
      getOverduePOs(),
      getSuppliersForReportFilter(),
      getCOGSRawVsFinished(),
      getRawMaterialShortage(),
      getWorkOrderCountByStatus(),
      getMarketplaceKpi(),
    ]);
```

- [ ] **Step 3: Pass the new prop to the client**

Locate the JSX that renders `<DashboardPageClient ...>`. Add a new prop:

```tsx
      initialWoStatusCounts={woStatusCounts}
      marketplaceKpi={marketplaceKpi}
```

(Place `marketplaceKpi` as the last prop, before the closing `/>`.)

- [ ] **Step 4: Type-check (will fail until Task 4 adds the prop type)**

```bash
pnpm -F @elorae/web type-check
```

Expected: FAIL with `Property 'marketplaceKpi' does not exist on type 'DashboardPageClientProps'`. This is fine — Task 4 fixes it. The commit at the end of this task ships the server change; Task 4 fixes the client to consume it (TDD-on-multi-file: red here, green after Task 4).

If you want to keep type-check green between commits, defer this commit until after Task 4. Otherwise commit now and proceed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/backoffice/dashboard/page.tsx
git commit -m "feat(web): fetch marketplace KPI on dashboard page"
```

---

## Task 4: Client — render Marketplace section with tooltips

Accept the new prop on `DashboardPageClient` and render the new section above the existing "Stats Grid" with two cards. Each card has an `<Info>` icon with shadcn `<Tooltip>`.

**Files:**
- Modify: `apps/web/app/backoffice/dashboard/DashboardPageClient.tsx`

- [ ] **Step 1: Add imports**

Open the file. Locate the existing `lucide-react` import block. Add `Info` and `Store`:

```ts
import {
  ShoppingCart,
  Package,
  ClipboardList,
  Users,
  TrendingUp,
  Clock,
  Loader2,
  AlertTriangle,
  Wallet,
  Calendar,
  Download,
  ChevronDown,
  Info,
  Store,
} from 'lucide-react';
```

(Exact existing import list may differ — only ADD `Info` and `Store`; preserve every existing icon.)

Add tooltip import below the existing `@/components/ui/...` imports:

```ts
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
```

Add the type import next to other `@/lib/...` type imports:

```ts
import type { MarketplaceKpi } from '@/lib/sales-orders/queries';
```

- [ ] **Step 2: Add a currency formatter import**

Locate the existing imports cluster (after the lucide block). Add:

```ts
import { formatIDR } from '@/lib/sales-orders/format';
```

- [ ] **Step 3: Extend the props type**

Locate `type DashboardPageClientProps = { ... };` (around line 146). Add the new field:

```ts
type DashboardPageClientProps = {
  initialStats: SerializedDashboardStats;
  initialOverduePOs: OverduePORow[];
  initialSuppliers: { id: string; name: string; code: string }[];
  initialCogsRawVsFinished: {
    rawValue: number;
    finishedValue: number;
    rawCount: number;
    finishedCount: number;
  };
  initialRawMaterialShortage: RawMaterialShortageRow[];
  initialWoStatusCounts: WorkOrderStatusCount[];
  marketplaceKpi: MarketplaceKpi;
};
```

- [ ] **Step 4: Destructure the new prop**

Locate the function signature and destructure:

```tsx
export function DashboardPageClient({
  initialStats,
  initialOverduePOs,
  initialSuppliers,
  initialCogsRawVsFinished,
  initialRawMaterialShortage,
  initialWoStatusCounts,
  marketplaceKpi,
}: DashboardPageClientProps) {
```

- [ ] **Step 5: Insert the Marketplace section**

Locate the `{/* Stats Grid */}` comment (around line 486). Insert a new section block DIRECTLY ABOVE it:

```tsx
      {/* Marketplace Section */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{tDashboard('marketplaceSection')}</h2>
        <TooltipProvider>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-1">
                  {tDashboard('pendingFulfillmentTitle')}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {tDashboard('pendingFulfillmentTooltip')}
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{marketplaceKpi.pendingFulfillmentCount}</div>
                <p className="text-xs text-muted-foreground">{tDashboard('pendingFulfillmentDesc')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-1">
                  {tDashboard('todaySalesTitle')}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {tDashboard('todaySalesTooltip')}
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <Store className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatIDR(marketplaceKpi.todaySalesTotal)}</div>
                <p className="text-xs text-muted-foreground">
                  {tDashboard('todaySalesCount', { count: marketplaceKpi.todaySalesCount })}
                </p>
              </CardContent>
            </Card>
          </div>
        </TooltipProvider>
      </div>
```

(If `tDashboard` is not the actual translator name in this file, locate the `useTranslations('dashboard')` line near the top of the component — the variable it assigns to is the name to use. Adjust accordingly.)

- [ ] **Step 6: Type-check (should now pass)**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS. Task 3's red is now green because `marketplaceKpi` is part of `DashboardPageClientProps`.

- [ ] **Step 7: Run full vitest suite**

```bash
pnpm -F @elorae/web test
```

Expected: all green (no test changes; Task 1 added 4, all others unchanged).

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/backoffice/dashboard/DashboardPageClient.tsx
git commit -m "feat(web): marketplace KPI cards on beranda with tooltips"
```

---

## Task 5: Manual smoke (post-merge handoff)

This is not an automated task — it's a checklist to hand back to the user before merging.

- [ ] **User restarts the dev server** (`pnpm -F @elorae/web dev`) so the new Prisma query path warms up.

- [ ] **Verify on `/backoffice/dashboard`:**
  - "Marketplace" section appears above the existing Stats Grid.
  - "Pending Fulfillment" card shows a sensible integer (≥ 0). Sub-A's existing rows in DB drive this count.
  - "Today's Sales" card shows `Rp 0` and "0 orders today" if no orders have a `transactionDate` matching today; otherwise the right IDR total.
  - Hovering the small `(i)` icon on each card shows the criteria tooltip.
  - Indonesian locale renders Indonesian labels and tooltips.

- [ ] **Optional smoke**: trigger a new Jubelio test salesorder webhook → reload beranda → Pending count increments.

If everything matches, the branch is ready to push + open a PR.

---

## Out-of-scope follow-ups

- Live polling for KPI cards (auto-refresh).
- Click-through to filtered list (`/backoffice/sales-orders?status=NEW` etc).
- Per-channel breakdown inside each card.
- Comparison vs yesterday / vs last week.
- Replacing the dashboard-wide `setHours` timezone pattern with a proper `Asia/Jakarta` tz helper (would touch every dashboard query — separate effort).
