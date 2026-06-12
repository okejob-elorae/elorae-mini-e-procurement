# Jubelio Bulk Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-page admin tool at `/backoffice/jubelio/migration` that lets admin pick ERP-source `FINISHED_GOOD` items without a Jubelio mapping, bulk-enqueue `product_push` outbox rows, and watch a summary card of recent run outcomes.

**Architecture:** Pure apps/web feature. Server actions write directly to `JubelioOutbox`. Sub-3's `ProductPushHandler` (unchanged) processes each row. Sub-2's outbox dashboard is the live progress viewer. No new api code, no schema changes.

**Tech Stack:** Next.js 16 App Router (server actions + RSC), Prisma 7 (read Item / write JubelioOutbox), shadcn AlertDialog + Checkbox + Table, vitest for server action unit tests.

**Spec:** `docs/superpowers/specs/2026-06-10-jubelio-bulk-migration-design.md`

---

## File Structure

**New files:**

```
apps/web/app/actions/jubelio-bulk-migration.ts                     # 3 server actions
apps/web/app/actions/jubelio-bulk-migration.spec.ts                # vitest

apps/web/app/backoffice/jubelio/migration/page.tsx                 # server component
apps/web/app/backoffice/jubelio/migration/MigrationClient.tsx      # client UI
```

**Modified files:**

```
apps/web/app/backoffice/BackofficeShell.tsx                        # + "Migration" nav child
apps/web/lib/rbac.ts                                               # + ROUTE_PERMISSIONS entry
apps/web/lib/i18n/messages/en.json                                 # + navJubelioMigration + page strings
apps/web/lib/i18n/messages/id.json                                 # + same in Indonesian
```

**Reused (no modification):**

- Sub-2 `JubelioOutbox` table.
- Sub-2 outbox poller (5s tick) + processor.
- Sub-3 `ProductPushHandler` — does per-item Jubelio push.
- Sub-3 `JubelioCatalogDeleteService` — manual rollback path (admin uses sub-3 Test cleanup card).
- shadcn `AlertDialog`, `Checkbox`, `Table`, `Card`, `Button`, `Badge` — all present in `apps/web/components/ui/`.

---

## Task 1: Server actions + vitest tests (TDD)

**Files:**
- Create: `apps/web/app/actions/jubelio-bulk-migration.spec.ts`
- Create: `apps/web/app/actions/jubelio-bulk-migration.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/app/actions/jubelio-bulk-migration.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    item: { findMany: vi.fn() },
    jubelioCategoryMapping: { findMany: vi.fn() },
    jubelioOutbox: { createMany: vi.fn(), groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import {
  getEligibleItems,
  enqueueBulkMigration,
  getMigrationSummary,
} from "./jubelio-bulk-migration";

describe("jubelio-bulk-migration server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getEligibleItems", () => {
    it("throws Unauthorized when session is null", async () => {
      (auth as any).mockResolvedValue(null);
      await expect(getEligibleItems()).rejects.toThrow("Unauthorized");
    });

    it("returns ERP-source FG items without mapping, with category status flag", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.item.findMany as any).mockResolvedValue([
        {
          id: "i1", sku: "TEST-1", nameId: "T1", nameEn: "Tee 1",
          categoryId: "c1", category: { name: "T-SHIRT" },
          variants: [{ sku: "TEST-1-RED" }, { sku: "TEST-1-BLU" }],
        },
        {
          id: "i2", sku: "TEST-2", nameId: "T2", nameEn: "Tee 2",
          categoryId: null, category: null,
          variants: null,
        },
      ]);
      (prisma.jubelioCategoryMapping.findMany as any).mockResolvedValue([
        { itemCategoryId: "c1" },
      ]);

      const rows = await getEligibleItems();

      expect(prisma.item.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          type: "FINISHED_GOOD",
          source: "ERP",
          jubelioProductMappings: { none: {} },
        }),
      }));
      expect(rows).toEqual([
        expect.objectContaining({
          id: "i1",
          sku: "TEST-1",
          categoryName: "T-SHIRT",
          variantCount: 2,
          hasJubelioCategoryMapping: true,
        }),
        expect.objectContaining({
          id: "i2",
          sku: "TEST-2",
          categoryName: null,
          variantCount: 0,
          hasJubelioCategoryMapping: false,
        }),
      ]);
    });
  });

  describe("enqueueBulkMigration", () => {
    it("throws Unauthorized when session is null", async () => {
      (auth as any).mockResolvedValue(null);
      await expect(enqueueBulkMigration(["i1"])).rejects.toThrow("Unauthorized");
    });

    it("rejects empty array", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      await expect(enqueueBulkMigration([])).rejects.toThrow(/no items/i);
      expect(prisma.jubelioOutbox.createMany).not.toHaveBeenCalled();
    });

    it("rejects ids not in the eligible set", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.item.findMany as any).mockResolvedValue([{ id: "i1" }]);
      (prisma.jubelioCategoryMapping.findMany as any).mockResolvedValue([]);
      await expect(enqueueBulkMigration(["i1", "ghost"])).rejects.toThrow(/not eligible/i);
      expect(prisma.jubelioOutbox.createMany).not.toHaveBeenCalled();
    });

    it("creates one outbox row per eligible itemId", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.item.findMany as any).mockResolvedValue([{ id: "i1" }, { id: "i2" }]);
      (prisma.jubelioCategoryMapping.findMany as any).mockResolvedValue([]);
      (prisma.jubelioOutbox.createMany as any).mockResolvedValue({ count: 2 });

      const result = await enqueueBulkMigration(["i1", "i2"]);

      expect(prisma.jubelioOutbox.createMany).toHaveBeenCalledWith({
        data: [
          { entityType: "product_push", entityId: "i1", payload: {}, enqueuedById: "u1" },
          { entityType: "product_push", entityId: "i2", payload: {}, enqueuedById: "u1" },
        ],
      });
      expect(result).toEqual({ enqueued: 2 });
    });
  });

  describe("getMigrationSummary", () => {
    it("aggregates outbox rows by status for the admin's last 24h", async () => {
      (auth as any).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      (prisma.jubelioOutbox.groupBy as any).mockResolvedValue([
        { status: "DONE", _count: { _all: 12 } },
        { status: "DEAD", _count: { _all: 1 } },
        { status: "SKIPPED", _count: { _all: 2 } },
        { status: "PENDING", _count: { _all: 3 } },
      ]);

      const summary = await getMigrationSummary();

      expect(prisma.jubelioOutbox.groupBy).toHaveBeenCalledWith(expect.objectContaining({
        by: ["status"],
        where: expect.objectContaining({
          entityType: "product_push",
          enqueuedById: "u1",
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }));
      expect(summary).toEqual(expect.objectContaining({
        done: 12,
        dead: 1,
        skipped: 2,
        pending: 3,
        processing: 0,
        total: 18,
      }));
    });
  });
});
```

- [ ] **Step 2: Confirm tests fail**

```bash
pnpm -F @elorae/web test -- jubelio-bulk-migration --run 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module './jubelio-bulk-migration'".

- [ ] **Step 3: Implement the actions**

`apps/web/app/actions/jubelio-bulk-migration.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";

export type EligibleItem = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  categoryId: string | null;
  categoryName: string | null;
  variantCount: number;
  hasJubelioCategoryMapping: boolean;
};

export type MigrationSummary = {
  done: number;
  pending: number;
  processing: number;
  dead: number;
  skipped: number;
  total: number;
  windowStart: string;
};

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function getEligibleItems(): Promise<EligibleItem[]> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const items = await prisma.item.findMany({
    where: {
      type: "FINISHED_GOOD",
      source: "ERP",
      jubelioProductMappings: { none: {} },
    },
    select: {
      id: true,
      sku: true,
      nameId: true,
      nameEn: true,
      categoryId: true,
      variants: true,
      category: { select: { name: true } },
    },
    orderBy: { sku: "asc" },
  });

  const mappedCategoryIds = await prisma.jubelioCategoryMapping.findMany({
    select: { itemCategoryId: true },
  });
  const mappedCatSet = new Set(mappedCategoryIds.map((m) => m.itemCategoryId));

  return items.map((it) => {
    const variants = Array.isArray(it.variants) ? (it.variants as Array<unknown>) : [];
    return {
      id: it.id,
      sku: it.sku,
      nameId: it.nameId,
      nameEn: it.nameEn,
      categoryId: it.categoryId,
      categoryName: it.category?.name ?? null,
      variantCount: variants.length,
      hasJubelioCategoryMapping: it.categoryId ? mappedCatSet.has(it.categoryId) : false,
    };
  });
}

export async function enqueueBulkMigration(itemIds: string[]): Promise<{ enqueued: number }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  if (itemIds.length === 0) {
    throw new Error("No items selected");
  }

  const eligibleIds = new Set(
    (await prisma.item.findMany({
      where: {
        id: { in: itemIds },
        type: "FINISHED_GOOD",
        source: "ERP",
        jubelioProductMappings: { none: {} },
      },
      select: { id: true },
    })).map((it) => it.id),
  );

  const invalid = itemIds.filter((id) => !eligibleIds.has(id));
  if (invalid.length > 0) {
    throw new Error(`${invalid.length} item(s) not eligible (already mapped or wrong type)`);
  }

  await prisma.jubelioOutbox.createMany({
    data: itemIds.map((id) => ({
      entityType: "product_push",
      entityId: id,
      payload: {},
      enqueuedById: session.user.id,
    })),
  });

  revalidatePath("/backoffice/jubelio/migration");
  return { enqueued: itemIds.length };
}

export async function getMigrationSummary(): Promise<MigrationSummary> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const windowStart = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);

  const grouped = await prisma.jubelioOutbox.groupBy({
    by: ["status"],
    where: {
      entityType: "product_push",
      enqueuedById: session.user.id,
      createdAt: { gte: windowStart },
    },
    _count: { _all: true },
  });

  const counts: Record<string, number> = { DONE: 0, PENDING: 0, PROCESSING: 0, DEAD: 0, SKIPPED: 0 };
  for (const row of grouped) {
    counts[row.status] = row._count._all;
  }

  return {
    done: counts.DONE,
    pending: counts.PENDING,
    processing: counts.PROCESSING,
    dead: counts.DEAD,
    skipped: counts.SKIPPED,
    total: counts.DONE + counts.PENDING + counts.PROCESSING + counts.DEAD + counts.SKIPPED,
    windowStart: windowStart.toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -F @elorae/web test -- jubelio-bulk-migration --run 2>&1 | tail -15
```

Expected: 8 tests pass.

- [ ] **Step 5: Type-check**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -3
```

Expected: silent.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/actions/jubelio-bulk-migration.ts apps/web/app/actions/jubelio-bulk-migration.spec.ts
git commit -m "feat(web): server actions for Jubelio bulk migration"
```

---

## Task 2: Server page + client component

**Files:**
- Create: `apps/web/app/backoffice/jubelio/migration/page.tsx`
- Create: `apps/web/app/backoffice/jubelio/migration/MigrationClient.tsx`

- [ ] **Step 1: Write the server page**

`apps/web/app/backoffice/jubelio/migration/page.tsx`:

```tsx
import { getEligibleItems, getMigrationSummary } from "@/app/actions/jubelio-bulk-migration";
import { MigrationClient } from "./MigrationClient";

export default async function MigrationPage() {
  const [items, summary] = await Promise.all([
    getEligibleItems(),
    getMigrationSummary(),
  ]);
  return <MigrationClient initialItems={items} initialSummary={summary} />;
}
```

- [ ] **Step 2: Write the client component**

`apps/web/app/backoffice/jubelio/migration/MigrationClient.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { ExternalLink, Loader2, UploadCloud } from "lucide-react";
import {
  enqueueBulkMigration,
  type EligibleItem,
  type MigrationSummary,
} from "@/app/actions/jubelio-bulk-migration";

type Props = {
  initialItems: EligibleItem[];
  initialSummary: MigrationSummary;
};

export function MigrationClient({ initialItems, initialSummary }: Props) {
  const [items, setItems] = useState<EligibleItem[]>(initialItems);
  const [summary, setSummary] = useState<MigrationSummary>(initialSummary);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((it) => it.id)));
    }
  };

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        const ids = Array.from(selected);
        const result = await enqueueBulkMigration(ids);
        toast.success(`Queued ${result.enqueued} item(s). Worker drains over ~5 min.`);
        setItems((prev) => prev.filter((it) => !selected.has(it.id)));
        setSelected(new Set());
        setConfirmOpen(false);
      } catch (err) {
        toast.error((err as Error).message);
        setConfirmOpen(false);
      }
    });
  };

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bulk migration</CardTitle>
          <CardDescription>
            Push ERP-source FINISHED_GOOD items to Jubelio in bulk. Only items without an
            existing Jubelio mapping are shown. Worker drains queued rows over time —
            watch progress on the{" "}
            <Link href="/backoffice/jubelio/admin" className="underline">
              outbox dashboard
            </Link>
            .
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryStat label="Done (24h)" value={summary.done} />
        <SummaryStat label="Pending" value={summary.pending} />
        <SummaryStat label="Processing" value={summary.processing} />
        <SummaryStat label="Skipped" value={summary.skipped} />
        <SummaryStat label="Dead" value={summary.dead} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Eligible items</CardTitle>
              <CardDescription>{items.length} candidate(s)</CardDescription>
            </div>
            <Button
              variant="destructive"
              disabled={selected.size === 0 || isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <UploadCloud className="mr-2 h-4 w-4" />
              Migrate {selected.size} selected
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No items to migrate. All ERP-source finished goods are already mapped.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                    </TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Variants</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(it.id)}
                          onCheckedChange={() => toggle(it.id)}
                          aria-label={`Select ${it.sku}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{it.sku}</TableCell>
                      <TableCell>{it.nameEn || it.nameId}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {it.categoryName ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">{it.variantCount}</TableCell>
                      <TableCell>
                        {it.hasJubelioCategoryMapping ? (
                          <Badge variant="default">Ready</Badge>
                        ) : (
                          <Badge variant="secondary" title="Category lacks Jubelio mapping — will SKIP">
                            Category unmapped
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        <CardContent className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
          <span>
            Window since {new Date(summary.windowStart).toLocaleString()} — total {summary.total}
          </span>
          <Link href="/backoffice/jubelio/admin" className="inline-flex items-center gap-1 underline">
            Open outbox dashboard
            <ExternalLink className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Push {selected.size} item(s) to Jubelio?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates real product listings on the production Jubelio account. Items
              with unmapped categories will SKIP — fix them on{" "}
              <Link href="/backoffice/jubelio/categories" className="underline">
                /backoffice/jubelio/categories
              </Link>{" "}
              first to avoid SKIP rows. Rollback for individual items is available on the{" "}
              <Link href="/backoffice/jubelio/settings" className="underline">
                Jubelio settings
              </Link>{" "}
              page (Test cleanup card).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm migrate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent. If `.next/dev/types/validator.ts` reports TS1128, `rm -rf apps/web/.next/dev` and retry.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/backoffice/jubelio/migration/page.tsx apps/web/app/backoffice/jubelio/migration/MigrationClient.tsx
git commit -m "feat(web): bulk migration page with checkboxes + summary card"
```

---

## Task 3: Nav + RBAC + i18n

**Files:**
- Modify: `apps/web/app/backoffice/BackofficeShell.tsx`
- Modify: `apps/web/lib/rbac.ts`
- Modify: `apps/web/lib/i18n/messages/en.json`
- Modify: `apps/web/lib/i18n/messages/id.json`

- [ ] **Step 1: Add nav child to Jubelio group**

Read `apps/web/app/backoffice/BackofficeShell.tsx`. Locate the Jubelio nav children array (around line 178–181 per recon — `navJubelioAdmin`, `navJubelioSettings`, `navJubelioCategories`). Add a new child after Categories:

```ts
{ labelKey: 'navJubelioMigration', href: '/backoffice/jubelio/migration', permission: PERMISSIONS.SETTINGS_SECURITY_VIEW },
```

The full Jubelio children array should now contain four entries: Admin, Settings, Categories, Migration.

- [ ] **Step 2: Add route permission**

In `apps/web/lib/rbac.ts`, find `ROUTE_PERMISSIONS` and add after `'/backoffice/jubelio/categories'`:

```ts
'/backoffice/jubelio/migration': 'settings_security:view',
```

Add to `BACKOFFICE_ROUTES_ORDER` after `/backoffice/jubelio/categories`:

```ts
'/backoffice/jubelio/migration',
```

- [ ] **Step 3: Add i18n strings**

Read `apps/web/lib/i18n/messages/en.json`. Find the `navigation` block (where other `navJubelio*` keys live). Add:

```json
"navJubelioMigration": "Migration"
```

Match the existing JSON style (comma placement, indentation).

Repeat in `apps/web/lib/i18n/messages/id.json`:

```json
"navJubelioMigration": "Migrasi"
```

- [ ] **Step 4: Type-check**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/backoffice/BackofficeShell.tsx apps/web/lib/rbac.ts apps/web/lib/i18n/messages/en.json apps/web/lib/i18n/messages/id.json
git commit -m "feat(web): nav + rbac + i18n for Jubelio bulk migration page"
```

---

## Task 4: Push + open draft PR (smoke deferred until client greenlight)

No file changes. Smoke against production Jubelio requires client greenlight per `feedback_prod_test_rollback` (sub-3 set the precedent).

- [ ] **Step 1: Verify final state**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -3
pnpm -F @elorae/web test -- jubelio-bulk-migration --run 2>&1 | tail -10
```

Expected: type-check silent. 8 tests pass.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/jubelio-bulk-migration
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --base master --head feat/jubelio-bulk-migration --title "feat: sub-5 Jubelio bulk migration tool (closes EPIC-02)" --body "$(cat <<'EOF'
## Summary

Closes EPIC-02-05 (Initial Data Migration) — the last story in EPIC-02. New admin page at `/backoffice/jubelio/migration` lets admin pick ERP-source FINISHED_GOOD items without a Jubelio mapping, bulk-enqueue \`product_push\` outbox rows, and watch a summary card of recent run outcomes.

Pure apps/web feature. Zero new api code. Sub-3's `ProductPushHandler` (unchanged) does the per-item work. Sub-2's outbox dashboard is the live progress viewer.

## Spec / Plan

- Spec: \`docs/superpowers/specs/2026-06-10-jubelio-bulk-migration-design.md\`
- Plan: \`docs/superpowers/plans/2026-06-10-jubelio-bulk-migration-plan.md\`

## Test Plan

- [x] \`pnpm -F @elorae/web type-check\` clean.
- [x] vitest 8 cases green (3 actions × multiple branches).
- [ ] **Manual smoke deferred** — requires real Jubelio push from production catalog; client greenlight gate per \`feedback_prod_test_rollback\`. Smoke checklist in spec §10 + plan T4.

## Notes

- Eligible-items query auto-excludes already-mapped items, so re-running after partial failures only shows still-unmapped items.
- Items with unmapped Jubelio categories show an amber "Category unmapped" badge; sub-3 handler will SKIP them. Admin fixes via \`/backoffice/jubelio/categories\` first.
- Bulk rollback is OUT OF SCOPE. Per-item rollback uses sub-3's Test cleanup card at \`/backoffice/jubelio/settings\`.
EOF
)"
```

PR opens as Ready (no smoke prerequisite blocking the code merge, since the smoke is on production data and the code itself is independently testable).

---

## Task 5: Manual smoke (user-driven, deferred until client greenlight)

No file changes. Per \`feedback_prod_test_rollback\` and spec §9.

- [ ] **Step 1: Apply migration (none — schema unchanged, but verify all prior migrations applied)**

```bash
pnpm -F @elorae/db migrate:deploy
```

Expected: "No pending migrations to apply" (this PR adds none).

- [ ] **Step 2: Start services (user runs)**

```bash
docker start elorae-dev-redis
pnpm prod:api
# new terminal:
pnpm -F @elorae/web dev
```

- [ ] **Step 3: Smoke checklist**

Open `http://localhost:3000/backoffice/jubelio/migration`:
1. Table renders with current ERP-source unmapped FG items (3 expected per earlier explore).
2. Each row's status badge correct: "Ready" if `hasJubelioCategoryMapping`, "Category unmapped" otherwise.
3. Select 1 item with "Ready" badge → "Migrate 1 selected" button enables.
4. Click button → confirm dialog appears with item count + warning text.
5. Click "Confirm migrate" → toast "Queued 1 item(s)" → selected row disappears from table (no longer eligible after outbox creation).
6. Outbox dashboard at \`/backoffice/jubelio/admin\` shows new row with \`entityType: product_push\` reaching DONE within ~5–10s.
7. Verify on Jubelio admin: new product appeared.
8. Refresh migration page. Summary card shows \`done: 1\`.

DB cross-check:
```bash
set -a && source apps/web/.env && set +a && pnpm -F @elorae/db exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const recent = await prisma.jubelioOutbox.findMany({
    where: { entityType: 'product_push' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, entityId: true, status: true, attempts: true, processedAt: true },
  });
  console.log(recent);
  await prisma.\$disconnect();
})();
" 2>&1 | tail -10
```

Expected: most recent row has \`status=DONE\` and \`processedAt\` set.

- [ ] **Step 4: Cleanup**

For each migrated test item: open \`/backoffice/jubelio/settings\` → Test cleanup card → enter the \`jubelioItemGroupId\` → confirm. Repeat per item. Bulk delete is out of scope.

- [ ] **Step 5: Stop services**

```bash
# Ctrl-C in api + web
docker stop elorae-dev-redis
```

---

## After all tasks

- Branch \`feat/jubelio-bulk-migration\` carries: 3 server actions + tests, server page + client component, nav + RBAC + i18n.
- ~8 new vitest cases.
- EPIC-02 fully closed once this PR merges (EPIC-02-01/02/03/04/05 all done).
- Next slice: EPIC-03 (Sales Orders — order ingestion + dashboard) or any other epic.

## Self-Review checklist (already run; documenting)

- **Spec coverage:**
  - §3 architecture → Tasks 1 (actions) + 2 (page/client).
  - §4 no schema → confirmed.
  - §5 components → Tasks 1 (actions), 2 (page/client), 3 (nav/rbac/i18n).
  - §6 data flow → exercised in Task 5 smoke.
  - §7 boundary respect → preserved (web writes outbox via Prisma; reads Item).
  - §8 error handling → Tasks 1 (empty array + invalid id + permission gates).
  - §9 prod-test-rollback → Task 5 documents per-item cleanup; spec §9 captures bulk-delete deferral.
  - §10 testing → Task 1 (8 vitest cases) + Task 5 (smoke).
  - §11 open questions resolved: shadcn AlertDialog; summary card at top; no pagination (≤100 items); no force re-push; empty state in client.
  - §12 decisions → all implemented.
- **No placeholders:** every code-changing step has complete code. Task 5 \`<jubelioItemGroupId>\` is a runtime value not a placeholder.
- **Type consistency:** \`EligibleItem\`, \`MigrationSummary\`, \`getEligibleItems\`, \`enqueueBulkMigration\`, \`getMigrationSummary\` consistent across tasks.
