# Jubelio Category Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-page admin UI that lets an admin pull Jubelio's full category list, see Elorae `ItemCategory` rows, assign each to a Jubelio category via searchable breadcrumb-path dropdown, and bulk-save the mappings.

**Architecture:** apps/api exposes `POST /jubelio/categories/list` (paginates Jubelio, builds breadcrumb paths) + `POST /jubelio/categories/mappings` (batch upsert). apps/web has a new child page `/backoffice/settings/jubelio/categories` that reads existing mappings server-side, fetches the Jubelio list on demand via signed `apiFetch` (sub-2.5), and bulk-saves drafts.

**Tech Stack:** NestJS 11 (controller + service), Prisma 7 (schema + upsert), Next.js 16 App Router (server actions + client component), shadcn `searchable-combobox`, vitest for api + web unit tests.

**Spec:** `docs/superpowers/specs/2026-06-05-jubelio-category-sync-design.md`

---

## File Structure

**New files:**

```
packages/db/prisma/migrations/20260605120000_jubelio_category_mapping_unique_itemcategoryid/migration.sql

apps/api/src/jubelio/categories/categories.service.ts            # fetchAll + saveMappings
apps/api/src/jubelio/categories/categories.service.spec.ts
apps/api/src/jubelio/categories/categories.controller.ts         # POST list + POST mappings
apps/api/src/jubelio/categories/categories.module.ts             # Nest module

apps/web/app/actions/jubelio-categories.ts                       # 3 server actions
apps/web/app/backoffice/settings/jubelio/categories/page.tsx     # server component
apps/web/app/backoffice/settings/jubelio/categories/CategoryMappingsClient.tsx  # client UI
```

**Modified files:**

```
packages/db/prisma/schema.prisma                                 # + @@unique([itemCategoryId])

apps/api/src/app.module.ts                                       # + JubelioCategoriesModule import

apps/web/app/backoffice/settings/page.tsx                        # + "Jubelio Categories" card
apps/web/lib/rbac.ts                                             # + ROUTE_PERMISSIONS entry
apps/web/lib/i18n/messages/en.json                               # + jubelioCategories strings
apps/web/lib/i18n/messages/id.json                               # + jubelioCategories strings
```

**Reused (no modification):**

- `apps/api/src/jubelio/http.service.ts` — paginated GET with auth + 429 retry + logging.
- `apps/web/lib/internal-api.ts` `apiFetch` — signed sub-2.5 channel.
- `apps/web/components/ui/searchable-combobox.tsx` — `SearchableCombobox` with `{value, label}` options.
- `JubelioCategoryMapping` schema (existing; one constraint added).

---

## Task 1: Schema + migration — add `@@unique([itemCategoryId])`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260605120000_jubelio_category_mapping_unique_itemcategoryid/migration.sql`

- [ ] **Step 1: Edit schema.prisma**

Locate `model JubelioCategoryMapping` (around line 1178). Replace the trailing `@@index([itemCategoryId])` line with `@@unique([itemCategoryId])`. The full model after edit:

```prisma
model JubelioCategoryMapping {
  id                String       @id @default(cuid())
  jubelioCategoryId Int          @unique
  itemCategoryId    String
  itemCategory      ItemCategory @relation(fields: [itemCategoryId], references: [id], onDelete: Cascade)
  createdAt         DateTime     @default(now())

  @@unique([itemCategoryId])
}
```

- [ ] **Step 2: Author the migration SQL manually**

`pnpm prisma migrate dev` is forbidden against TiDB (CLAUDE.md). Create the file by hand:

`packages/db/prisma/migrations/20260605120000_jubelio_category_mapping_unique_itemcategoryid/migration.sql`:

```sql
-- DropIndex
DROP INDEX `JubelioCategoryMapping_itemCategoryId_idx` ON `JubelioCategoryMapping`;

-- CreateIndex
CREATE UNIQUE INDEX `JubelioCategoryMapping_itemCategoryId_key` ON `JubelioCategoryMapping`(`itemCategoryId`);
```

- [ ] **Step 3: Regenerate Prisma client + build the package + type-check both apps**

```bash
pnpm -F @elorae/db generate 2>&1 | tail -3
pnpm -F @elorae/db build 2>&1 | tail -3
pnpm -F @elorae/api type-check 2>&1 | tail -3
pnpm -F @elorae/web type-check 2>&1 | tail -3
```

Expected: all silent. (Per `feedback_db_build` memory, schema changes need both `generate` AND `build`.)

- [ ] **Step 4: Apply migration**

User runs (per `feedback_service_control`):

```bash
pnpm -F @elorae/db migrate:deploy
```

Expected: `Applying migration 20260605120000_jubelio_category_mapping_unique_itemcategoryid` + `All migrations have been successfully applied`. Pre-existing data has only one mapping row (T-SHIRT → 7278), no duplicates on `itemCategoryId` → constraint safe to add.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260605120000_jubelio_category_mapping_unique_itemcategoryid/
git commit -m "feat(db): unique constraint on JubelioCategoryMapping.itemCategoryId"
```

---

## Task 2: `JubelioCategoriesService` + tests (TDD)

**Files:**
- Create: `apps/api/src/jubelio/categories/categories.service.spec.ts`
- Create: `apps/api/src/jubelio/categories/categories.service.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/jubelio/categories/categories.service.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { JubelioCategoriesService } from "./categories.service";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

describe("JubelioCategoriesService", () => {
  let svc: JubelioCategoriesService;
  let prisma: any;
  let http: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioCategoryMapping: { upsert: jest.fn() },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    http = { get: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        JubelioCategoriesService,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    svc = mod.get(JubelioCategoriesService);
  });

  describe("fetchAll", () => {
    it("paginates until response length < pageSize", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({ category_id: i + 1, category_name: `C${i + 1}`, parent_id: null, has_children: false }));
      const page2 = Array.from({ length: 47 }, (_, i) => ({ category_id: 200 + i, category_name: `D${i}`, parent_id: null, has_children: false }));
      http.get.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

      const result = await svc.fetchAll();

      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.get).toHaveBeenNthCalledWith(1, "/inventory/categories/item-categories/", expect.objectContaining({ query: expect.objectContaining({ page: 1, pageSize: 100 }) }));
      expect(http.get).toHaveBeenNthCalledWith(2, "/inventory/categories/item-categories/", expect.objectContaining({ query: expect.objectContaining({ page: 2, pageSize: 100 }) }));
      expect(result).toHaveLength(147);
    });

    it("computes breadcrumb path by walking parent_id chain", async () => {
      http.get.mockResolvedValueOnce([
        { category_id: 1, category_name: "Pakaian", parent_id: null, has_children: true },
        { category_id: 2, category_name: "Pria", parent_id: 1, has_children: true },
        { category_id: 3, category_name: "Kaos", parent_id: 2, has_children: false },
      ]);

      const result = await svc.fetchAll();

      const leaf = result.find((c) => c.id === 3);
      expect(leaf?.path).toBe("Pakaian > Pria > Kaos");
      expect(leaf?.isLeaf).toBe(true);
      expect(result.find((c) => c.id === 1)?.path).toBe("Pakaian");
    });

    it("orphan parent (parent_id not in set) → path = name only", async () => {
      http.get.mockResolvedValueOnce([
        { category_id: 5, category_name: "Stray", parent_id: 99, has_children: false },
      ]);
      const result = await svc.fetchAll();
      expect(result[0].path).toBe("Stray");
    });

    it("propagates http error", async () => {
      http.get.mockRejectedValueOnce(new Error("Jubelio 503"));
      await expect(svc.fetchAll()).rejects.toThrow("Jubelio 503");
    });
  });

  describe("saveMappings", () => {
    it("upserts each row in a single transaction", async () => {
      prisma.jubelioCategoryMapping.upsert.mockResolvedValue({});
      const result = await svc.saveMappings([
        { itemCategoryId: "cat_a", jubelioCategoryId: 7278 },
        { itemCategoryId: "cat_b", jubelioCategoryId: 7286 },
      ]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.jubelioCategoryMapping.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.jubelioCategoryMapping.upsert).toHaveBeenNthCalledWith(1, {
        where: { itemCategoryId: "cat_a" },
        create: { itemCategoryId: "cat_a", jubelioCategoryId: 7278 },
        update: { jubelioCategoryId: 7278 },
      });
      expect(result).toEqual({ saved: 2 });
    });

    it("rejects duplicate Jubelio ids within input", async () => {
      await expect(
        svc.saveMappings([
          { itemCategoryId: "cat_a", jubelioCategoryId: 7278 },
          { itemCategoryId: "cat_b", jubelioCategoryId: 7278 },
        ]),
      ).rejects.toThrow(/duplicate.*jubelio/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rethrows on prisma P2002", async () => {
      prisma.jubelioCategoryMapping.upsert.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint"), { code: "P2002" }),
      );
      await expect(
        svc.saveMappings([{ itemCategoryId: "cat_a", jubelioCategoryId: 7278 }]),
      ).rejects.toThrow(/Unique constraint/);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @elorae/api test -- categories.service.spec.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './categories.service'".

- [ ] **Step 3: Implement the service**

`apps/api/src/jubelio/categories/categories.service.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

const PAGE_SIZE = 100;

type JubelioCategoryRaw = {
  category_id: number;
  category_name: string;
  parent_id: number | null;
  has_children: boolean;
};

export type JubelioCategoryFlat = {
  id: number;
  name: string;
  path: string;
  isLeaf: boolean;
};

export type SaveMappingInput = {
  itemCategoryId: string;
  jubelioCategoryId: number;
};

@Injectable()
export class JubelioCategoriesService {
  private readonly logger = new Logger(JubelioCategoriesService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async fetchAll(): Promise<JubelioCategoryFlat[]> {
    const all: JubelioCategoryRaw[] = [];
    let page = 1;
    while (true) {
      const batch = await this.http.get<JubelioCategoryRaw[]>(
        "/inventory/categories/item-categories/",
        { query: { page, pageSize: PAGE_SIZE } },
      );
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      page++;
    }

    const byId = new Map<number, JubelioCategoryRaw>(all.map((c) => [c.category_id, c]));
    const pathCache = new Map<number, string>();

    const computePath = (id: number): string => {
      const cached = pathCache.get(id);
      if (cached !== undefined) return cached;
      const node = byId.get(id);
      if (!node) return "";
      if (node.parent_id == null || !byId.has(node.parent_id)) {
        if (node.parent_id != null && !byId.has(node.parent_id)) {
          this.logger.warn(`Orphan parent_id=${node.parent_id} for category ${id}`);
        }
        pathCache.set(id, node.category_name);
        return node.category_name;
      }
      const parentPath = computePath(node.parent_id);
      const path = `${parentPath} > ${node.category_name}`;
      pathCache.set(id, path);
      return path;
    };

    return all
      .map((c) => ({
        id: c.category_id,
        name: c.category_name,
        path: computePath(c.category_id),
        isLeaf: !c.has_children,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async saveMappings(rows: SaveMappingInput[]): Promise<{ saved: number }> {
    const seen = new Set<number>();
    for (const r of rows) {
      if (seen.has(r.jubelioCategoryId)) {
        throw new Error(`Duplicate jubelioCategoryId in input: ${r.jubelioCategoryId}`);
      }
      seen.add(r.jubelioCategoryId);
    }

    const ops = rows.map((r) =>
      this.prisma.jubelioCategoryMapping.upsert({
        where: { itemCategoryId: r.itemCategoryId },
        create: { itemCategoryId: r.itemCategoryId, jubelioCategoryId: r.jubelioCategoryId },
        update: { jubelioCategoryId: r.jubelioCategoryId },
      }),
    );
    await this.prisma.$transaction(ops);

    return { saved: rows.length };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @elorae/api test -- categories.service.spec.ts 2>&1 | tail -10
```

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/categories/categories.service.ts apps/api/src/jubelio/categories/categories.service.spec.ts
git commit -m "feat(api): Jubelio categories service (fetch + batch upsert mappings)"
```

---

## Task 3: Controller + module + wire into `app.module.ts`

**Files:**
- Create: `apps/api/src/jubelio/categories/categories.controller.ts`
- Create: `apps/api/src/jubelio/categories/categories.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the controller**

`apps/api/src/jubelio/categories/categories.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JubelioCategoriesService, type JubelioCategoryFlat, type SaveMappingInput } from "./categories.service";

class SaveMappingsBody {
  mappings!: SaveMappingInput[];
}

@ApiTags("jubelio-categories")
@Controller("jubelio/categories")
export class JubelioCategoriesController {
  constructor(private readonly svc: JubelioCategoriesService) {}

  @Post("list")
  @HttpCode(200)
  @ApiOperation({
    summary: "Fetch full Jubelio category list",
    description:
      "Paginates Jubelio /inventory/categories/item-categories/, computes breadcrumb paths, " +
      "returns flat array sorted by path. Used by the category mapping admin UI.",
  })
  @ApiOkResponse({ description: "Array of JubelioCategoryFlat" })
  list(): Promise<JubelioCategoryFlat[]> {
    return this.svc.fetchAll();
  }

  @Post("mappings")
  @HttpCode(200)
  @ApiOperation({
    summary: "Batch upsert JubelioCategoryMapping rows",
    description:
      "Upserts one mapping per Elorae ItemCategory. Atomic via Prisma $transaction. " +
      "Rejects duplicate jubelio ids within the input.",
  })
  saveMappings(@Body() body: SaveMappingsBody): Promise<{ saved: number }> {
    return this.svc.saveMappings(body.mappings);
  }
}
```

- [ ] **Step 2: Write the module**

`apps/api/src/jubelio/categories/categories.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { JubelioCategoriesController } from "./categories.controller";
import { JubelioCategoriesService } from "./categories.service";

@Module({
  imports: [JubelioModule],
  controllers: [JubelioCategoriesController],
  providers: [JubelioCategoriesService],
  exports: [JubelioCategoriesService],
})
export class JubelioCategoriesModule {}
```

- [ ] **Step 3: Wire into `app.module.ts`**

Read the current file. Add the import alongside existing Jubelio modules:

```ts
import { JubelioCategoriesModule } from "./jubelio/categories/categories.module";
```

Add `JubelioCategoriesModule` to the `imports: [...]` array (any position; near `JubelioCatalogModule` is natural):

```ts
imports: [
  // ... existing entries
  JubelioCatalogModule,
  JubelioCategoriesModule,
  JubelioModule,
  JubelioOutboxModule,
  JubelioWebhooksModule,
],
```

- [ ] **Step 4: Type-check + build + full test suite**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -3
pnpm -F @elorae/api build 2>&1 | tail -3
pnpm -F @elorae/api test 2>&1 | tail -10
```

Expected: all silent / green. Full suite + 7 new categories tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/categories/ apps/api/src/app.module.ts
git commit -m "feat(api): POST /jubelio/categories/list + /mappings endpoints"
```

---

## Task 4: Web server actions

**Files:**
- Create: `apps/web/app/actions/jubelio-categories.ts`

- [ ] **Step 1: Write the server actions**

`apps/web/app/actions/jubelio-categories.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { apiFetch } from '@/lib/internal-api';

export type CategoryMappingRow = {
  erpCategoryId: string;
  erpName: string;
  erpCode: string | null;
  jubelioId: number | null;
  createdAt: string | null;
};

export type JubelioCategoryFlat = {
  id: number;
  name: string;
  path: string;
  isLeaf: boolean;
};

export async function getJubelioCategoryMappings(): Promise<CategoryMappingRow[]> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const cats = await prisma.itemCategory.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      jubelioCategoryMappings: {
        select: { jubelioCategoryId: true, createdAt: true },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  });

  return cats.map((c) => ({
    erpCategoryId: c.id,
    erpName: c.name,
    erpCode: c.code,
    jubelioId: c.jubelioCategoryMappings[0]?.jubelioCategoryId ?? null,
    createdAt: c.jubelioCategoryMappings[0]?.createdAt?.toISOString() ?? null,
  }));
}

export async function fetchJubelioCategoryList(): Promise<JubelioCategoryFlat[]> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const r = await apiFetch<JubelioCategoryFlat[]>('POST', '/jubelio/categories/list', {
    userId: session.user.id,
  });
  if (!r.ok) {
    throw new Error(`Failed to load Jubelio categories (${r.status}): ${(r.error ?? '').slice(0, 200)}`);
  }
  return r.data ?? [];
}

export async function saveJubelioCategoryMappings(
  mappings: Array<{ itemCategoryId: string; jubelioCategoryId: number }>,
): Promise<{ saved: number }> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const r = await apiFetch<{ saved: number }>('POST', '/jubelio/categories/mappings', {
    userId: session.user.id,
    body: { mappings },
  });
  if (!r.ok) {
    throw new Error(`Save failed (${r.status}): ${(r.error ?? '').slice(0, 300)}`);
  }
  revalidatePath('/backoffice/settings/jubelio/categories');
  return r.data ?? { saved: 0 };
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent. If `.next/dev/types/validator.ts` reports TS1128, `rm -rf apps/web/.next/dev` and retry.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/actions/jubelio-categories.ts
git commit -m "feat(web): server actions for Jubelio category mappings"
```

---

## Task 5: Web client component `CategoryMappingsClient.tsx`

**Files:**
- Create: `apps/web/app/backoffice/settings/jubelio/categories/CategoryMappingsClient.tsx`

- [ ] **Step 1: Write the client component**

```tsx
"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Loader2, RefreshCw, Save } from "lucide-react";
import {
  fetchJubelioCategoryList,
  saveJubelioCategoryMappings,
  type CategoryMappingRow,
  type JubelioCategoryFlat,
} from "@/app/actions/jubelio-categories";

type Props = {
  initialRows: CategoryMappingRow[];
};

export function CategoryMappingsClient({ initialRows }: Props) {
  const [rows, setRows] = useState<CategoryMappingRow[]>(initialRows);
  const [jubelioList, setJubelioList] = useState<JubelioCategoryFlat[]>([]);
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const options = useMemo(
    () => jubelioList.map((c) => ({ value: String(c.id), label: c.path })),
    [jubelioList],
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const list = await fetchJubelioCategoryList();
      setJubelioList(list);
      toast.success(`Loaded ${list.length} categories from Jubelio`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelect = (erpCategoryId: string, jubelioIdStr: string) => {
    const jubelioId = jubelioIdStr ? Number(jubelioIdStr) : null;
    setDraft((prev) => ({ ...prev, [erpCategoryId]: jubelioId }));
  };

  const dirtyEntries = Object.entries(draft).filter(([erpId, jubelioId]) => {
    const current = rows.find((r) => r.erpCategoryId === erpId)?.jubelioId ?? null;
    return jubelioId !== current && jubelioId !== null;
  });

  const handleSave = async () => {
    if (dirtyEntries.length === 0) return;
    setIsSaving(true);
    try {
      const mappings = dirtyEntries.map(([erpId, jubelioId]) => ({
        itemCategoryId: erpId,
        jubelioCategoryId: jubelioId as number,
      }));
      const result = await saveJubelioCategoryMappings(mappings);
      toast.success(`Saved ${result.saved} mapping${result.saved === 1 ? "" : "s"}`);
      setRows((prev) =>
        prev.map((r) => {
          const newId = draft[r.erpCategoryId];
          return newId !== undefined ? { ...r, jubelioId: newId } : r;
        }),
      );
      setDraft({});
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const pathForId = (id: number | null): string => {
    if (id == null) return "";
    return jubelioList.find((c) => c.id === id)?.path ?? `#${id}`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Jubelio category mappings</CardTitle>
              <CardDescription>
                Map each Elorae ItemCategory to a Jubelio category. Click Refresh to load
                the latest list from Jubelio (~1000 categories).
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => void handleRefresh()} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh categories
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ERP category</TableHead>
                  <TableHead>Jubelio category</TableHead>
                  <TableHead>Current path</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      No ERP categories. Create one first.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const draftId = draft[row.erpCategoryId];
                    const effectiveId = draftId !== undefined ? draftId : row.jubelioId;
                    return (
                      <TableRow key={row.erpCategoryId}>
                        <TableCell className="font-medium">
                          {row.erpCode ? `${row.erpCode} — ${row.erpName}` : row.erpName}
                        </TableCell>
                        <TableCell>
                          <SearchableCombobox
                            options={options}
                            value={effectiveId != null ? String(effectiveId) : ""}
                            onValueChange={(v) => handleSelect(row.erpCategoryId, v)}
                            placeholder={options.length === 0 ? "Click Refresh first" : "Select Jubelio category"}
                            searchPlaceholder="Search by path..."
                            emptyMessage="No matches"
                            disabled={options.length === 0}
                            triggerClassName="w-full"
                          />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {pathForId(effectiveId)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        <CardContent className="flex items-center justify-between border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {dirtyEntries.length === 0 ? "No unsaved changes" : `${dirtyEntries.length} unsaved change(s)`}
          </p>
          <Button onClick={() => void handleSave()} disabled={isSaving || dirtyEntries.length === 0}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save mappings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/backoffice/settings/jubelio/categories/CategoryMappingsClient.tsx
git commit -m "feat(web): category mappings client with searchable combobox"
```

---

## Task 6: Server page + settings hub card + route permission + i18n

**Files:**
- Create: `apps/web/app/backoffice/settings/jubelio/categories/page.tsx`
- Modify: `apps/web/lib/rbac.ts`
- Modify: `apps/web/app/backoffice/settings/page.tsx`
- Modify: `apps/web/lib/i18n/messages/en.json`
- Modify: `apps/web/lib/i18n/messages/id.json`

- [ ] **Step 1: Write the server page**

`apps/web/app/backoffice/settings/jubelio/categories/page.tsx`:

```tsx
import { getJubelioCategoryMappings } from "@/app/actions/jubelio-categories";
import { CategoryMappingsClient } from "./CategoryMappingsClient";

export default async function JubelioCategoriesPage() {
  const rows = await getJubelioCategoryMappings();
  return <CategoryMappingsClient initialRows={rows} />;
}
```

- [ ] **Step 2: Add route permission**

In `apps/web/lib/rbac.ts`, locate `ROUTE_PERMISSIONS` and add:

```ts
'/backoffice/settings/jubelio/categories': 'settings_security:view',
```

Place it right after the existing `/backoffice/settings/jubelio` entry. Also add the route to `BACKOFFICE_ROUTES_ORDER` after `/backoffice/settings/jubelio`:

```ts
'/backoffice/settings/jubelio/categories',
```

- [ ] **Step 3: Add settings hub card**

Read `apps/web/app/backoffice/settings/page.tsx`. Locate the items array (around line 58). Append a new entry after the `jubelio` entry:

```ts
{ titleKey: 'jubelioCategories.title' as const, descriptionKey: 'jubelioCategories.description' as const, href: '/backoffice/settings/jubelio/categories', icon: Tags },
```

Add `Tags` to the lucide-react import at the top of the file:

```ts
import { ... existing ..., Tags } from 'lucide-react';
```

- [ ] **Step 4: i18n keys (en + id)**

Read `apps/web/lib/i18n/messages/en.json`. Find the `settings` block (where `jubelio.title` lives). Add a sibling block:

```json
"jubelioCategories": {
  "title": "Jubelio Categories",
  "description": "Map Elorae item categories to Jubelio categories for product push."
}
```

Repeat in `apps/web/lib/i18n/messages/id.json` with Indonesian copy:

```json
"jubelioCategories": {
  "title": "Kategori Jubelio",
  "description": "Petakan kategori item Elorae ke kategori Jubelio untuk push produk."
}
```

Match the surrounding indentation + comma placement of the existing JSON.

- [ ] **Step 5: Type-check + build**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -10
```

Expected: silent.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/backoffice/settings/jubelio/categories/page.tsx apps/web/app/backoffice/settings/page.tsx apps/web/lib/rbac.ts apps/web/lib/i18n/messages/en.json apps/web/lib/i18n/messages/id.json
git commit -m "feat(web): category mapping page + settings hub card + i18n"
```

---

## Task 7: Full verification + manual smoke + push + PR

No code changes. Final integration check + user-driven smoke (no prod write risk — writes are local Elorae table only; Jubelio side is read-only).

- [ ] **Step 1: Full verification**

```bash
pnpm -F @elorae/db generate 2>&1 | tail -3
pnpm -F @elorae/db build 2>&1 | tail -3
pnpm -F @elorae/api type-check 2>&1 | tail -3
pnpm -F @elorae/api build 2>&1 | tail -3
pnpm -F @elorae/api test 2>&1 | tail -10
pnpm -F @elorae/web type-check 2>&1 | tail -3
```

Expected: all silent / green.

- [ ] **Step 2: Start services (user runs)**

```bash
docker start elorae-dev-redis
pnpm prod:api
# new terminal:
pnpm -F @elorae/web dev
```

Boot log should show `JubelioCategoriesController` mapped at `POST /jubelio/categories/list` + `POST /jubelio/categories/mappings`.

- [ ] **Step 3: Smoke checklist**

Open `http://localhost:3000/backoffice/settings`:
- "Jubelio Categories" card visible (between Jubelio and the rest).

Click it → `/backoffice/settings/jubelio/categories`:
- 3 ERP rows visible (T-SHIRT, PANTS, FABRIC).
- T-SHIRT already shows `jubelioId=7278` from earlier manual seed.
- Combobox disabled with "Click Refresh first" placeholder.

Click "Refresh categories":
- Toast: "Loaded N categories from Jubelio" (N ≈ 1000+).
- Comboboxes become enabled.
- T-SHIRT's current path shows "...Kaos" (or whatever 7278's path resolves to).

For PANTS: open combobox → search "celana bahan" → select → footer shows "1 unsaved change(s)".

Click "Save mappings":
- Toast: "Saved 1 mapping".
- Footer back to "No unsaved changes".
- Refresh page (F5) → PANTS mapping persists.

Try to map FABRIC to T-SHIRT's existing jubelio id (7278) → save:
- Toast error: surfaces P2002 unique violation (offending pair visible in message).
- Footer still shows unsaved (draft not cleared on error).

Verify in DB:
```bash
set -a && source apps/web/.env && set +a && pnpm -F @elorae/db exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const m = await prisma.jubelioCategoryMapping.findMany({ include: { itemCategory: { select: { name: true } } } });
  console.log(JSON.stringify(m, null, 2));
  await prisma.\$disconnect();
})();
" 2>&1 | tail -20
```

Expected: T-SHIRT + PANTS mapped, FABRIC unmapped (since conflict save failed).

- [ ] **Step 4: Stop services**

```bash
# Ctrl-C in api + web terminals
docker stop elorae-dev-redis
```

- [ ] **Step 5: Push branch + open PR**

```bash
git push -u origin feat/jubelio-category-sync
gh pr create --base master --head feat/jubelio-category-sync --title "feat: Jubelio category mapping admin UI" --body "..."
```

PR body covers: spec link, what ships, smoke pass, no prod write risk, migration step.

---

## After all tasks

- Branch `feat/jubelio-category-sync` carries: schema constraint, api service+controller+module, web server actions + page + client component, settings hub card, RBAC route, i18n strings.
- Full api test suite: 12+ suites with 7 new tests = ~83 total.
- Apps/web type-check + build clean.
- Manual smoke shows mapping persists + unique constraint surfaces correctly.
- After PR merge: admin can manage mappings without tsx scripts. Product push handler's `category_unmapped` SKIP becomes rare.

## Self-Review checklist (already run; documenting)

- **Spec coverage:**
  - §3 architecture → Tasks 2–6 build the components.
  - §4 schema → Task 1.
  - §5 api → Tasks 2 (service) + 3 (controller/module).
  - §6 web → Tasks 4 (actions) + 5 (client) + 6 (page/hub/rbac/i18n).
  - §7 data flow → exercised in Task 7 smoke.
  - §8 boundary respect → api owns writes (Task 3 controller); web reads directly (Task 4 `getJubelioCategoryMappings`).
  - §9 error handling → service test covers duplicate input + P2002; client toasts.
  - §10 testing → Task 2 unit tests; Task 7 manual smoke.
  - §11 open questions resolved: combobox API confirmed; `>` separator; 100 page size; no rate-limit delay (Jubelio's 429 handler is enough); empty state in Task 5; nav placement = settings hub card (Task 6).
  - §12 decisions → all implemented.
- **No placeholders:** every step has full code. Task 7 PR body intentionally `"..."` since the user composes the final body — that's a fill-during-execution step, not a placeholder for missing logic.
- **Type consistency:** `JubelioCategoryFlat`, `SaveMappingInput`, `CategoryMappingRow`, `JubelioCategoriesService`, `JubelioCategoriesController`, `JubelioCategoriesModule`, `getJubelioCategoryMappings`, `fetchJubelioCategoryList`, `saveJubelioCategoryMappings` all consistent across tasks.
