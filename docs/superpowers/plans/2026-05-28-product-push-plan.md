# Product Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-push Elorae `FINISHED_GOOD` Items to Jubelio's catalog on create/update via a new `product_push` outbox entityType, backed by a `JubelioPushDefaults` settings table and a "Delete from Jubelio" admin action for safe test cleanup.

**Architecture:** apps/web server actions enqueue `product_push` rows after `Item.create`/`Item.update` (gated by a pushable-fields diff); apps/api handler reads current Item + mappings + defaults at process time, builds a single `POST /inventory/catalog/` body that covers create/edit/variant-add in one call, then calls `DELETE /inventory/items/item-variant/` for any variants removed locally. Idempotent: re-running the same row produces identical Jubelio output. Test rollback ships first.

**Tech Stack:** NestJS 11 outbox handler, Prisma 7 schema migration (TiDB via `migrate:deploy`), Next.js 16 server actions + UI, jest + ts-jest for handler/payload tests. Sub-2.5 signed `apiFetch` channel for direct-enqueue.

**Spec:** `docs/superpowers/specs/2026-05-28-product-push-design.md`

---

## File Structure

**New files:**

```
packages/db/prisma/migrations/20260528300000_add_jubelio_push_defaults/migration.sql

apps/api/src/jubelio/catalog/catalog-delete.service.ts        # DELETE one product + drop mappings
apps/api/src/jubelio/catalog/catalog-delete.service.spec.ts
apps/api/src/jubelio/catalog/catalog-delete.controller.ts     # POST /jubelio/catalog/delete-product

apps/api/src/jubelio/outbox/handlers/product-push.payload.ts          # pure body builder
apps/api/src/jubelio/outbox/handlers/product-push.payload.spec.ts
apps/api/src/jubelio/outbox/handlers/product-push.handler.ts          # outbox handler
apps/api/src/jubelio/outbox/handlers/product-push.handler.spec.ts

apps/web/lib/items/jubelio-push-diff.ts                       # hasPushableChange()

apps/web/app/actions/jubelio-product-push.ts                  # enqueueProductPushOnCreate / OnUpdate
apps/web/app/actions/jubelio-push-defaults.ts                 # get / save defaults
apps/web/app/actions/jubelio-catalog-cleanup.ts               # admin "Delete from Jubelio" action
```

**Modified files:**

```
packages/db/prisma/schema.prisma                              # + JubelioPushDefaults model

apps/api/src/jubelio/outbox/outbox-status.ts                  # + new skip reasons
apps/api/src/jubelio/outbox/outbox-router.ts                  # + "product_push" case
apps/api/src/jubelio/outbox/jubelio-outbox.module.ts          # + ProductPushHandler provider
apps/api/src/jubelio/catalog/catalog.module.ts                # + delete service/controller

apps/web/lib/items/mutations.ts                               # updateItem returns pre/post snapshot
apps/web/app/actions/items.ts                                 # call enqueue after create/update
apps/web/app/backoffice/settings/jubelio/page.tsx             # + "Push defaults" + "Test cleanup" sections
```

**Reused from earlier branches (no modification):**

- `apps/api/src/jubelio/http.service.ts` — `JubelioHttpService` with `delete()` method (sub-1)
- `apps/api/src/jubelio/outbox/outbox-status.ts` `OUTBOX_STATUS` + `TERMINAL_OUTBOX_STATUSES` (sub-2)
- `apps/api/src/jubelio/outbox/outbox-poller.service.ts` + `outbox-processor.service.ts` (sub-2)
- `apps/web/lib/internal-api.ts` `apiFetch` (sub-2.5)
- `JubelioCategoryMapping` + ingest path that seeds it (sub-1)

---

## Task 1: Schema + migration for JubelioPushDefaults

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260528300000_add_jubelio_push_defaults/migration.sql`

- [ ] **Step 1: Append `JubelioPushDefaults` model to `schema.prisma`**

Add this model after the existing `JubelioOutbox` block (no `//` comments per project convention):

```prisma
model JubelioPushDefaults {
  id                       String   @id @default("singleton")
  sellTaxId                Int      @default(-1)
  buyTaxId                 Int      @default(-1)
  salesAcctId              Int      @default(28)
  cogsAcctId               Int      @default(30)
  invtAcctId               Int      @default(4)
  purchAcctId              Int?
  uomId                    Int      @default(-1)
  brandId                  String?
  brandName                String?
  sellThis                 Boolean  @default(true)
  buyThis                  Boolean  @default(true)
  stockThis                Boolean  @default(true)
  dropshipThis             Boolean  @default(false)
  isActive                 Boolean  @default(true)
  sellUnit                 String   @default("Buah")
  buyUnit                  String   @default("Buah")
  packageWeight            Int      @default(1000)
  storePriorityQtyTreshold Int      @default(0)
  rop                      Int      @default(0)
  useSingleImageSet        Boolean  @default(false)
  useSerialNumber          Boolean  @default(false)
  buyPrice                 Decimal  @default(0) @db.Decimal(15,2)
  updatedAt                DateTime @updatedAt
  updatedById              String?
  updatedBy                User?    @relation("JubelioPushDefaultsUpdater", fields: [updatedById], references: [id], onDelete: SetNull, onUpdate: NoAction)
}
```

Then add the inverse relation to the `User` model. Locate `model User {` and add a single relation field inside it:

```prisma
  jubelioPushDefaultsUpdates JubelioPushDefaults[] @relation("JubelioPushDefaultsUpdater")
```

- [ ] **Step 2: Author migration SQL manually**

`pnpm prisma migrate dev` is forbidden against TiDB (CLAUDE.md). Create the file by hand:

`packages/db/prisma/migrations/20260528300000_add_jubelio_push_defaults/migration.sql`:

```sql
-- CreateTable
CREATE TABLE `JubelioPushDefaults` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `sellTaxId` INTEGER NOT NULL DEFAULT -1,
    `buyTaxId` INTEGER NOT NULL DEFAULT -1,
    `salesAcctId` INTEGER NOT NULL DEFAULT 28,
    `cogsAcctId` INTEGER NOT NULL DEFAULT 30,
    `invtAcctId` INTEGER NOT NULL DEFAULT 4,
    `purchAcctId` INTEGER NULL,
    `uomId` INTEGER NOT NULL DEFAULT -1,
    `brandId` VARCHAR(191) NULL,
    `brandName` VARCHAR(191) NULL,
    `sellThis` BOOLEAN NOT NULL DEFAULT true,
    `buyThis` BOOLEAN NOT NULL DEFAULT true,
    `stockThis` BOOLEAN NOT NULL DEFAULT true,
    `dropshipThis` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sellUnit` VARCHAR(191) NOT NULL DEFAULT 'Buah',
    `buyUnit` VARCHAR(191) NOT NULL DEFAULT 'Buah',
    `packageWeight` INTEGER NOT NULL DEFAULT 1000,
    `storePriorityQtyTreshold` INTEGER NOT NULL DEFAULT 0,
    `rop` INTEGER NOT NULL DEFAULT 0,
    `useSingleImageSet` BOOLEAN NOT NULL DEFAULT false,
    `useSerialNumber` BOOLEAN NOT NULL DEFAULT false,
    `buyPrice` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed singleton
INSERT INTO `JubelioPushDefaults` (`id`, `updatedAt`) VALUES ('singleton', CURRENT_TIMESTAMP(3));
```

- [ ] **Step 3: Regenerate client + type-check**

```bash
pnpm -F @elorae/db generate 2>&1 | tail -5
pnpm -F @elorae/api type-check 2>&1 | tail -5
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: all three silent. Client generation prints "Generated Prisma Client" once.

- [ ] **Step 4: Apply migration**

User runs (Claude only states command per `feedback_service_control`):

```bash
pnpm -F @elorae/db migrate:deploy
```

Expected: `Applying migration 20260528300000_add_jubelio_push_defaults` + `All migrations have been successfully applied.`

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260528300000_add_jubelio_push_defaults/
git commit -m "feat(db): JubelioPushDefaults singleton table + seed row"
```

---

## Task 2: New outbox skip reasons

**Files:**
- Modify: `apps/api/src/jubelio/outbox/outbox-status.ts`

- [ ] **Step 1: Extend `OUTBOX_SKIP_REASONS`**

Read the current file. Add five new keys to the existing object literal (preserve existing keys):

```ts
export const OUTBOX_SKIP_REASONS = {
  MISSING_MAPPING: "missing_mapping",
  NO_INVENTORY: "no_inventory",
  UNKNOWN_ENTITY_TYPE: "unknown_entity_type",
  ORPHAN_ITEM: "orphan_item",
  WRONG_TYPE: "wrong_type",
  DEFAULTS_MISSING: "defaults_missing",
  CATEGORY_UNMAPPED: "category_unmapped",
  CANNOT_CREATE_FROM_INGESTED: "cannot_create_from_ingested",
} as const;
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
```

Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jubelio/outbox/outbox-status.ts
git commit -m "feat(api): outbox skip reasons for product push branches"
```

---

## Task 3: Catalog delete service (rollback core, api side)

**Files:**
- Create: `apps/api/src/jubelio/catalog/catalog-delete.service.ts`
- Create: `apps/api/src/jubelio/catalog/catalog-delete.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/jubelio/catalog/catalog-delete.service.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { JubelioCatalogDeleteService } from "./catalog-delete.service";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

describe("JubelioCatalogDeleteService", () => {
  let svc: JubelioCatalogDeleteService;
  let prisma: any;
  let http: { delete: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioProductMapping: { deleteMany: jest.fn() },
    };
    http = { delete: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        JubelioCatalogDeleteService,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    svc = mod.get(JubelioCatalogDeleteService);
  });

  it("calls Jubelio DELETE with the group id list and drops local mappings", async () => {
    prisma.jubelioProductMapping.deleteMany.mockResolvedValue({ count: 2 });
    http.delete.mockResolvedValue({ status: "ok" });

    const result = await svc.deleteByGroupId(42);

    expect(http.delete).toHaveBeenCalledWith("/inventory/items/", expect.objectContaining({
      body: JSON.stringify({ ids: [42] }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(prisma.jubelioProductMapping.deleteMany).toHaveBeenCalledWith({
      where: { jubelioItemGroupId: 42 },
    });
    expect(result).toEqual({ deletedMappings: 2, jubelioGroupId: 42 });
  });

  it("returns 0 mappings when Jubelio delete succeeded but no local mappings existed", async () => {
    prisma.jubelioProductMapping.deleteMany.mockResolvedValue({ count: 0 });
    http.delete.mockResolvedValue({ status: "ok" });

    const result = await svc.deleteByGroupId(99);

    expect(http.delete).toHaveBeenCalled();
    expect(result).toEqual({ deletedMappings: 0, jubelioGroupId: 99 });
  });

  it("does NOT drop local mappings when Jubelio call throws", async () => {
    http.delete.mockRejectedValue(new Error("503 Service Unavailable"));

    await expect(svc.deleteByGroupId(7)).rejects.toThrow("503");
    expect(prisma.jubelioProductMapping.deleteMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @elorae/api test -- catalog-delete.service.spec.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './catalog-delete.service'".

- [ ] **Step 3: Implement the service**

`apps/api/src/jubelio/catalog/catalog-delete.service.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

export type CatalogDeleteResult = {
  jubelioGroupId: number;
  deletedMappings: number;
};

@Injectable()
export class JubelioCatalogDeleteService {
  private readonly logger = new Logger(JubelioCatalogDeleteService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async deleteByGroupId(jubelioGroupId: number): Promise<CatalogDeleteResult> {
    await this.http.delete("/inventory/items/", {
      body: JSON.stringify({ ids: [jubelioGroupId] }),
      headers: { "Content-Type": "application/json" },
    });

    const result = await this.prisma.jubelioProductMapping.deleteMany({
      where: { jubelioItemGroupId: jubelioGroupId },
    });

    this.logger.log(`Deleted Jubelio group ${jubelioGroupId} + ${result.count} local mappings`);
    return { jubelioGroupId, deletedMappings: result.count };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @elorae/api test -- catalog-delete.service.spec.ts 2>&1 | tail -10
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/catalog/catalog-delete.service.ts apps/api/src/jubelio/catalog/catalog-delete.service.spec.ts
git commit -m "feat(api): Jubelio catalog delete service (test rollback core)"
```

---

## Task 4: Catalog delete controller + module wiring

**Files:**
- Create: `apps/api/src/jubelio/catalog/catalog-delete.controller.ts`
- Modify: `apps/api/src/jubelio/catalog/catalog.module.ts`

- [ ] **Step 1: Write the controller**

`apps/api/src/jubelio/catalog/catalog-delete.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JubelioCatalogDeleteService, type CatalogDeleteResult } from "./catalog-delete.service";

class CatalogDeleteBody {
  jubelioGroupId!: number;
}

@ApiTags("jubelio-catalog")
@Controller("jubelio/catalog")
export class JubelioCatalogDeleteController {
  constructor(private readonly svc: JubelioCatalogDeleteService) {}

  @Post("delete-product")
  @HttpCode(200)
  @ApiOperation({
    summary: "Delete a Jubelio product (whole item_group) + drop local mappings",
    description:
      "Used for test cleanup. Calls Jubelio DELETE /inventory/items/ then removes " +
      "every JubelioProductMapping row pointing at the deleted group_id.",
  })
  @ApiOkResponse({ description: "CatalogDeleteResult" })
  delete(@Body() body: CatalogDeleteBody): Promise<CatalogDeleteResult> {
    return this.svc.deleteByGroupId(body.jubelioGroupId);
  }
}
```

- [ ] **Step 2: Register in `catalog.module.ts`**

Read the file first. Add the imports + register provider + controller:

```ts
import { Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { JubelioCatalogController } from "./catalog.controller";
import { JubelioCatalogDeleteController } from "./catalog-delete.controller";
import { JubelioCatalogSyncService } from "./catalog-sync.service";
import { JubelioCatalogDeleteService } from "./catalog-delete.service";

@Module({
  imports: [JubelioModule],
  controllers: [JubelioCatalogController, JubelioCatalogDeleteController],
  providers: [JubelioCatalogSyncService, JubelioCatalogDeleteService],
  exports: [JubelioCatalogSyncService, JubelioCatalogDeleteService],
})
export class JubelioCatalogModule {}
```

- [ ] **Step 3: Type-check + run all tests**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
pnpm -F @elorae/api test 2>&1 | tail -10
```

Expected: silent type-check + full suite green (existing 55 tests + 3 new = 58).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/jubelio/catalog/catalog-delete.controller.ts apps/api/src/jubelio/catalog/catalog.module.ts
git commit -m "feat(api): POST /jubelio/catalog/delete-product endpoint"
```

---

## Task 5: Cleanup admin server action + button UI (web side)

**Files:**
- Create: `apps/web/app/actions/jubelio-catalog-cleanup.ts`
- Modify: `apps/web/app/backoffice/settings/jubelio/page.tsx`

- [ ] **Step 1: Write the server action**

`apps/web/app/actions/jubelio-catalog-cleanup.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { apiFetch } from '@/lib/internal-api';

export type CatalogDeleteResult = {
  jubelioGroupId: number;
  deletedMappings: number;
};

export async function deleteJubelioProduct(
  jubelioGroupId: number,
): Promise<CatalogDeleteResult> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const r = await apiFetch<CatalogDeleteResult>('POST', '/jubelio/catalog/delete-product', {
    userId: session.user.id,
    body: { jubelioGroupId },
  });
  if (!r.ok) {
    throw new Error(`Delete failed (${r.status}): ${(r.error ?? '').slice(0, 200)}`);
  }
  revalidatePath('/backoffice/settings/jubelio');
  return r.data as CatalogDeleteResult;
}
```

- [ ] **Step 2: Add "Test cleanup" card to settings page**

Read `apps/web/app/backoffice/settings/jubelio/page.tsx`. Add this import (single quotes — match this file's style):

```ts
import { deleteJubelioProduct } from '@/app/actions/jubelio-catalog-cleanup';
```

Add state + handler inside the component body:

```tsx
const [groupIdInput, setGroupIdInput] = useState('');
const [isDeleting, setIsDeleting] = useState(false);

const handleDeleteProduct = async () => {
  const n = Number(groupIdInput.trim());
  if (!Number.isFinite(n) || n <= 0) {
    toast.error('Enter a valid Jubelio item_group_id');
    return;
  }
  if (!confirm(`Delete Jubelio product with group_id ${n}? This removes the live marketplace listing.`)) return;
  setIsDeleting(true);
  try {
    const r = await deleteJubelioProduct(n);
    toast.success(`Deleted group ${r.jubelioGroupId} + ${r.deletedMappings} local mapping(s)`);
    setGroupIdInput('');
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    setIsDeleting(false);
  }
};
```

Append the card at the bottom of the page's returned JSX (after existing cards):

```tsx
<Card>
  <CardHeader>
    <CardTitle>Test cleanup</CardTitle>
    <CardDescription>
      Delete a Jubelio product (whole item_group) for testing. This removes the live
      marketplace listing AND drops local JubelioProductMapping rows pointing at the group.
    </CardDescription>
  </CardHeader>
  <CardContent className="flex items-end gap-3">
    <div className="flex-1">
      <label className="mb-1 block text-sm font-medium">Jubelio item_group_id</label>
      <input
        type="number"
        min="1"
        value={groupIdInput}
        onChange={(e) => setGroupIdInput(e.target.value)}
        placeholder="e.g. 12345"
        className="block w-full rounded border bg-background px-3 py-2 text-sm"
      />
    </div>
    <Button variant="destructive" onClick={() => void handleDeleteProduct()} disabled={isDeleting}>
      {isDeleting ? 'Deleting…' : 'Delete from Jubelio'}
    </Button>
  </CardContent>
</Card>
```

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent. If `.next/dev/types/validator.ts` reports TS1128, `rm -rf apps/web/.next/dev` and retry.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/actions/jubelio-catalog-cleanup.ts apps/web/app/backoffice/settings/jubelio/page.tsx
git commit -m "feat(web): admin Delete-from-Jubelio button on settings page"
```

---

## Task 6: Defaults get/save server actions

**Files:**
- Create: `apps/web/app/actions/jubelio-push-defaults.ts`

- [ ] **Step 1: Write the server actions**

`apps/web/app/actions/jubelio-push-defaults.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';

export type JubelioPushDefaultsState = {
  id: string;
  sellTaxId: number;
  buyTaxId: number;
  salesAcctId: number;
  cogsAcctId: number;
  invtAcctId: number;
  purchAcctId: number | null;
  uomId: number;
  brandId: string | null;
  brandName: string | null;
  sellThis: boolean;
  buyThis: boolean;
  stockThis: boolean;
  dropshipThis: boolean;
  isActive: boolean;
  sellUnit: string;
  buyUnit: string;
  packageWeight: number;
  storePriorityQtyTreshold: number;
  rop: number;
  useSingleImageSet: boolean;
  useSerialNumber: boolean;
  buyPrice: number;
  updatedAt: string;
  updatedById: string | null;
};

export type JubelioPushDefaultsInput = Omit<
  JubelioPushDefaultsState,
  'id' | 'updatedAt' | 'updatedById'
>;

function serialize(row: Awaited<ReturnType<typeof prisma.jubelioPushDefaults.findFirst>>): JubelioPushDefaultsState {
  if (!row) throw new Error('JubelioPushDefaults singleton row missing — re-run migrations');
  return {
    ...row,
    buyPrice: Number(row.buyPrice),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getJubelioPushDefaults(): Promise<JubelioPushDefaultsState> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const row = await prisma.jubelioPushDefaults.findFirst();
  return serialize(row);
}

export async function saveJubelioPushDefaults(
  input: JubelioPushDefaultsInput,
): Promise<JubelioPushDefaultsState> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const row = await prisma.jubelioPushDefaults.update({
    where: { id: 'singleton' },
    data: {
      ...input,
      updatedById: session.user.id,
    },
  });
  revalidatePath('/backoffice/settings/jubelio');
  return serialize(row);
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/actions/jubelio-push-defaults.ts
git commit -m "feat(web): get/save server actions for JubelioPushDefaults"
```

---

## Task 7: Defaults settings UI section

**Files:**
- Modify: `apps/web/app/backoffice/settings/jubelio/page.tsx`

- [ ] **Step 1: Add imports + state + loader + save handler**

Add imports near the existing ones:

```ts
import {
  getJubelioPushDefaults,
  saveJubelioPushDefaults,
  type JubelioPushDefaultsInput,
  type JubelioPushDefaultsState,
} from '@/app/actions/jubelio-push-defaults';
```

Add state declarations near the existing ones inside the component:

```tsx
const [defaults, setDefaults] = useState<JubelioPushDefaultsState | null>(null);
const [defaultsDraft, setDefaultsDraft] = useState<JubelioPushDefaultsInput | null>(null);
const [isLoadingDefaults, setIsLoadingDefaults] = useState(true);
const [isSavingDefaults, setIsSavingDefaults] = useState(false);
```

Add the loader effect alongside the existing token-state loader:

```tsx
useEffect(() => {
  if (status !== 'authenticated') return;
  getJubelioPushDefaults()
    .then((d) => {
      setDefaults(d);
      const { id: _id, updatedAt: _u, updatedById: _b, ...input } = d;
      void _id; void _u; void _b;
      setDefaultsDraft(input);
    })
    .catch((err: Error) => toast.error(`Failed to load defaults: ${err.message}`))
    .finally(() => setIsLoadingDefaults(false));
}, [status]);
```

Add the save handler:

```tsx
const handleSaveDefaults = async () => {
  if (!defaultsDraft) return;
  setIsSavingDefaults(true);
  try {
    const saved = await saveJubelioPushDefaults(defaultsDraft);
    setDefaults(saved);
    toast.success('Push defaults saved');
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    setIsSavingDefaults(false);
  }
};
```

- [ ] **Step 2: Add the form card + small input components**

Insert this card in the page's JSX between the catalog sync card and the test-cleanup card (added in Task 5):

```tsx
<Card>
  <CardHeader>
    <CardTitle>Push defaults</CardTitle>
    <CardDescription>
      Tax, account, brand, UOM, and package defaults applied to every product push.
      Match these to your Jubelio tenant configuration.
    </CardDescription>
  </CardHeader>
  <CardContent>
    {isLoadingDefaults || !defaultsDraft ? (
      <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NumField label="Sell Tax ID" value={defaultsDraft.sellTaxId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellTaxId: v ?? 0 })} />
        <NumField label="Buy Tax ID" value={defaultsDraft.buyTaxId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyTaxId: v ?? 0 })} />
        <NumField label="Sales Acct ID" value={defaultsDraft.salesAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, salesAcctId: v ?? 0 })} />
        <NumField label="COGS Acct ID" value={defaultsDraft.cogsAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, cogsAcctId: v ?? 0 })} />
        <NumField label="Inventory Acct ID" value={defaultsDraft.invtAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, invtAcctId: v ?? 0 })} />
        <NumField label="Purchase Acct ID (nullable)" value={defaultsDraft.purchAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, purchAcctId: v })} nullable />
        <NumField label="UOM ID" value={defaultsDraft.uomId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, uomId: v ?? 0 })} />
        <StrField label="Brand ID (nullable)" value={defaultsDraft.brandId ?? ''} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, brandId: v || null })} />
        <StrField label="Brand Name (nullable)" value={defaultsDraft.brandName ?? ''} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, brandName: v || null })} />
        <StrField label="Sell Unit" value={defaultsDraft.sellUnit} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellUnit: v })} />
        <StrField label="Buy Unit" value={defaultsDraft.buyUnit} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyUnit: v })} />
        <NumField label="Package Weight (g)" value={defaultsDraft.packageWeight} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, packageWeight: v ?? 0 })} />
        <NumField label="Buy Price (default)" value={defaultsDraft.buyPrice} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyPrice: v ?? 0 })} />
        <NumField label="Re-order Point" value={defaultsDraft.rop} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, rop: v ?? 0 })} />
        <NumField label="Store Priority Treshold" value={defaultsDraft.storePriorityQtyTreshold} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, storePriorityQtyTreshold: v ?? 0 })} />
        <BoolField label="Sell This" value={defaultsDraft.sellThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellThis: v })} />
        <BoolField label="Buy This" value={defaultsDraft.buyThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyThis: v })} />
        <BoolField label="Stock This" value={defaultsDraft.stockThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, stockThis: v })} />
        <BoolField label="Dropship This" value={defaultsDraft.dropshipThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, dropshipThis: v })} />
        <BoolField label="Is Active (default)" value={defaultsDraft.isActive} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, isActive: v })} />
        <BoolField label="Use Single Image Set" value={defaultsDraft.useSingleImageSet} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, useSingleImageSet: v })} />
        <BoolField label="Use Serial Number" value={defaultsDraft.useSerialNumber} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, useSerialNumber: v })} />
      </div>
    )}
  </CardContent>
  <CardContent className="flex items-center justify-between border-t pt-4">
    <p className="text-xs text-muted-foreground">
      {defaults ? `Last saved ${new Date(defaults.updatedAt).toLocaleString()}` : '—'}
    </p>
    <Button onClick={() => void handleSaveDefaults()} disabled={isSavingDefaults || !defaultsDraft}>
      {isSavingDefaults ? 'Saving…' : 'Save defaults'}
    </Button>
  </CardContent>
</Card>
```

Add helper components at the bottom of the file (outside the page component):

```tsx
function NumField({ label, value, onChange, nullable }: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  nullable?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') { if (nullable) onChange(null); else onChange(0); return; }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="block w-full rounded border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

function StrField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

function BoolField({ label, value, onChange }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
```

- [ ] **Step 3: Type-check + visual smoke**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent.

User opens `/backoffice/settings/jubelio`, verifies the new "Push defaults" card renders with seeded values, edits `brandName` to "Elorae Test", saves, refreshes to confirm persistence.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/backoffice/settings/jubelio/page.tsx
git commit -m "feat(web): push defaults editor on Jubelio settings page"
```

---

## Task 8: Payload builder (pure function, TDD)

**Files:**
- Create: `apps/api/src/jubelio/outbox/handlers/product-push.payload.ts`
- Create: `apps/api/src/jubelio/outbox/handlers/product-push.payload.spec.ts`

- [ ] **Step 1: Write failing tests**

`apps/api/src/jubelio/outbox/handlers/product-push.payload.spec.ts`:

```ts
import { buildCreateProductRequest } from "./product-push.payload";

const defaults = {
  sellTaxId: -1, buyTaxId: -1, salesAcctId: 28, cogsAcctId: 30, invtAcctId: 4,
  purchAcctId: null, uomId: -1, brandId: null, brandName: null,
  sellThis: true, buyThis: true, stockThis: true, dropshipThis: false, isActive: true,
  sellUnit: "Buah", buyUnit: "Buah", packageWeight: 1000,
  storePriorityQtyTreshold: 0, rop: 0,
  useSingleImageSet: false, useSerialNumber: false, buyPrice: 0,
};

function item(overrides: Partial<any> = {}) {
  return {
    id: "item_1",
    sku: "SKU-1",
    nameId: "Kemeja",
    nameEn: "Shirt",
    description: "long enough description that passes the 30-char minimum threshold",
    variants: null,
    sellingPrice: 100000,
    isActive: true,
    ...overrides,
  };
}

describe("buildCreateProductRequest", () => {
  it("creates body for variantless new product", () => {
    const body = buildCreateProductRequest({
      item: item(),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
    });
    expect(body.item_group_id).toBe(0);
    expect(body.item_group_name).toBe("Shirt");
    expect(body.item_category_id).toBe(454);
    expect(body.sell_price).toBe(100000);
    expect(body.product_skus).toHaveLength(1);
    expect(body.product_skus[0]).toMatchObject({ item_id: 0, item_code: "SKU-1" });
    expect(body.sell_tax_id).toBe(-1);
    expect(body.sales_acct_id).toBe(28);
  });

  it("creates body for variants new product", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }] }),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
    });
    expect(body.product_skus).toHaveLength(2);
    expect(body.product_skus.map((s) => s.item_code)).toEqual(["SKU-1-RED", "SKU-1-BLU"]);
    expect(body.product_skus.every((s) => s.item_id === 0)).toBe(true);
  });

  it("edits an existing product (item_group_id reused, existing variants carry item_id from mappings)", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }] }),
      defaults,
      categoryJubelioId: 454,
      mappings: [
        { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7 },
        { id: "m2", erpVariantSku: "SKU-1-BLU", jubelioItemId: 12, jubelioItemGroupId: 7 },
      ],
    });
    expect(body.item_group_id).toBe(7);
    expect(body.product_skus.find((s) => s.item_code === "SKU-1-RED")?.item_id).toBe(11);
    expect(body.product_skus.find((s) => s.item_code === "SKU-1-BLU")?.item_id).toBe(12);
  });

  it("treats added variant as item_id=0 while keeping existing ones", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }, { sku: "SKU-1-GRN" }] }),
      defaults,
      categoryJubelioId: 454,
      mappings: [
        { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7 },
        { id: "m2", erpVariantSku: "SKU-1-BLU", jubelioItemId: 12, jubelioItemGroupId: 7 },
      ],
    });
    expect(body.product_skus.find((s) => s.item_code === "SKU-1-GRN")?.item_id).toBe(0);
    expect(body.product_skus.find((s) => s.item_code === "SKU-1-RED")?.item_id).toBe(11);
  });

  it("respects the variantless mapping (erpVariantSku='' carries jubelioItemId)", () => {
    const body = buildCreateProductRequest({
      item: item(),
      defaults,
      categoryJubelioId: 454,
      mappings: [
        { id: "m1", erpVariantSku: "", jubelioItemId: 99, jubelioItemGroupId: 7 },
      ],
    });
    expect(body.product_skus).toHaveLength(1);
    expect(body.product_skus[0]).toMatchObject({ item_id: 99, item_code: "SKU-1" });
  });

  it("uses brand_name from defaults when brand_id is null", () => {
    const body = buildCreateProductRequest({
      item: item(),
      defaults: { ...defaults, brandId: null, brandName: "Elorae" },
      categoryJubelioId: 454,
      mappings: [],
    });
    expect(body.brand_id).toBeNull();
    expect(body.brand_name).toBe("Elorae");
  });

  it("falls sell_price to 0 when sellingPrice null", () => {
    const body = buildCreateProductRequest({
      item: item({ sellingPrice: null }),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
    });
    expect(body.sell_price).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @elorae/api test -- product-push.payload.spec.ts 2>&1 | tail -10
```

Expected: FAIL "Cannot find module './product-push.payload'".

- [ ] **Step 3: Implement the builder**

`apps/api/src/jubelio/outbox/handlers/product-push.payload.ts`:

```ts
import type { JubelioProductMapping } from "@elorae/db";

export type PushDefaultsSlice = {
  sellTaxId: number;
  buyTaxId: number;
  salesAcctId: number;
  cogsAcctId: number;
  invtAcctId: number;
  purchAcctId: number | null;
  uomId: number;
  brandId: string | null;
  brandName: string | null;
  sellThis: boolean;
  buyThis: boolean;
  stockThis: boolean;
  dropshipThis: boolean;
  isActive: boolean;
  sellUnit: string;
  buyUnit: string;
  packageWeight: number;
  storePriorityQtyTreshold: number;
  rop: number;
  useSingleImageSet: boolean;
  useSerialNumber: boolean;
  buyPrice: number;
};

export type ItemSlice = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  description: string | null;
  variants: Array<{ sku: string }> | null;
  sellingPrice: number | null;
  isActive: boolean;
};

export type MappingSlice = Pick<
  JubelioProductMapping,
  "id" | "erpVariantSku" | "jubelioItemId" | "jubelioItemGroupId"
>;

export type ProductSkuEntry = {
  item_id: number;
  item_code: string;
  variation_values: Array<unknown>;
  sell_price: number;
  buy_price: number;
  barcode: string | null;
  is_consignment: boolean;
};

export type CreateProductRequestBody = {
  item_group_id: number;
  item_group_name: string;
  uom_id: number;
  description: string;
  sell_this: boolean;
  sell_tax_id: number;
  buy_tax_id: number;
  sales_acct_id: number;
  cogs_acct_id: number;
  invt_acct_id: number;
  buy_this: boolean;
  stock_this: boolean;
  dropship_this: boolean;
  sell_unit: string;
  buy_unit: string;
  is_active: boolean;
  purch_acct_id: number | null;
  item_category_id: number;
  store_priority_qty_treshold: number;
  package_weight: number;
  sell_price: number;
  buy_price: number;
  brand_id: string | null;
  brand_name: string | null;
  rop: number;
  use_single_image_set: boolean;
  use_serial_number: boolean;
  product_skus: ProductSkuEntry[];
};

const MIN_DESCRIPTION_LEN = 30;

function padDescription(input: string | null): string {
  const base = (input ?? "").trim();
  if (base.length >= MIN_DESCRIPTION_LEN) return base;
  return base.padEnd(MIN_DESCRIPTION_LEN, ".");
}

export function buildCreateProductRequest(opts: {
  item: ItemSlice;
  defaults: PushDefaultsSlice;
  categoryJubelioId: number;
  mappings: MappingSlice[];
}): CreateProductRequestBody {
  const { item, defaults: d, categoryJubelioId, mappings } = opts;

  const groupId = mappings[0]?.jubelioItemGroupId ?? 0;
  const sellPrice = item.sellingPrice ?? 0;
  const mappingBySku = new Map(mappings.map((m) => [m.erpVariantSku, m]));

  const hasVariants = item.variants !== null && item.variants.length > 0;
  const desiredVariants: Array<{ sku: string }> =
    hasVariants ? item.variants!.map((v) => ({ sku: v.sku })) : [{ sku: item.sku }];

  const product_skus: ProductSkuEntry[] = desiredVariants.map((v) => {
    const mappingKey = hasVariants ? v.sku : "";
    const mapping = mappingBySku.get(mappingKey);
    return {
      item_id: mapping?.jubelioItemId ?? 0,
      item_code: v.sku,
      variation_values: [],
      sell_price: sellPrice,
      buy_price: d.buyPrice,
      barcode: null,
      is_consignment: false,
    };
  });

  return {
    item_group_id: groupId,
    item_group_name: item.nameEn || item.nameId || item.sku,
    uom_id: d.uomId,
    description: padDescription(item.description),
    sell_this: d.sellThis,
    sell_tax_id: d.sellTaxId,
    buy_tax_id: d.buyTaxId,
    sales_acct_id: d.salesAcctId,
    cogs_acct_id: d.cogsAcctId,
    invt_acct_id: d.invtAcctId,
    buy_this: d.buyThis,
    stock_this: d.stockThis,
    dropship_this: d.dropshipThis,
    sell_unit: d.sellUnit,
    buy_unit: d.buyUnit,
    is_active: item.isActive,
    purch_acct_id: d.purchAcctId,
    item_category_id: categoryJubelioId,
    store_priority_qty_treshold: d.storePriorityQtyTreshold,
    package_weight: d.packageWeight,
    sell_price: sellPrice,
    buy_price: d.buyPrice,
    brand_id: d.brandId,
    brand_name: d.brandName,
    rop: d.rop,
    use_single_image_set: d.useSingleImageSet,
    use_serial_number: d.useSerialNumber,
    product_skus,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @elorae/api test -- product-push.payload.spec.ts 2>&1 | tail -10
```

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/outbox/handlers/product-push.payload.ts apps/api/src/jubelio/outbox/handlers/product-push.payload.spec.ts
git commit -m "feat(api): product push payload builder + tests"
```

---

## Task 9: Product push handler (TDD, all branches)

**Files:**
- Create: `apps/api/src/jubelio/outbox/handlers/product-push.handler.ts`
- Create: `apps/api/src/jubelio/outbox/handlers/product-push.handler.spec.ts`

- [ ] **Step 1: Write failing tests**

`apps/api/src/jubelio/outbox/handlers/product-push.handler.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { ProductPushHandler } from "./product-push.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

function row(overrides: any = {}) {
  return {
    id: "out_1",
    entityType: "product_push",
    entityId: "item_1",
    payload: {},
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    skipReason: null,
    enqueuedById: "user_1",
    createdAt: new Date(),
    lastEnqueuedAt: new Date(),
    processedAt: null,
    deadAt: null,
    ...overrides,
  };
}

const baseItem = {
  id: "item_1",
  sku: "SKU-1",
  nameId: "Kemeja",
  nameEn: "Shirt",
  description: "long enough description for the thirty character minimum required",
  type: "FINISHED_GOOD",
  source: "ERP",
  categoryId: "cat_1",
  variants: null,
  sellingPrice: 100000,
  isActive: true,
};

const baseDefaults = {
  sellTaxId: -1, buyTaxId: -1, salesAcctId: 28, cogsAcctId: 30, invtAcctId: 4,
  purchAcctId: null, uomId: -1, brandId: null, brandName: null,
  sellThis: true, buyThis: true, stockThis: true, dropshipThis: false, isActive: true,
  sellUnit: "Buah", buyUnit: "Buah", packageWeight: 1000,
  storePriorityQtyTreshold: 0, rop: 0,
  useSingleImageSet: false, useSerialNumber: false, buyPrice: 0,
};

describe("ProductPushHandler", () => {
  let handler: ProductPushHandler;
  let prisma: any;
  let http: { post: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    prisma = {
      item: { findUnique: jest.fn() },
      jubelioProductMapping: { findMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
      jubelioPushDefaults: { findFirst: jest.fn() },
      jubelioCategoryMapping: { findUnique: jest.fn() },
    };
    http = { post: jest.fn(), delete: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        ProductPushHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    handler = mod.get(ProductPushHandler);
  });

  it("SKIPs orphan_item when Item missing", async () => {
    prisma.item.findUnique.mockResolvedValue(null);
    const r = await handler.handle(row() as any);
    expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.ORPHAN_ITEM });
  });

  it("SKIPs wrong_type for non-FINISHED_GOOD", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, type: "FABRIC" });
    const r = await handler.handle(row() as any);
    expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.WRONG_TYPE });
  });

  it("SKIPs defaults_missing when no JubelioPushDefaults row", async () => {
    prisma.item.findUnique.mockResolvedValue(baseItem);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(null);
    const r = await handler.handle(row() as any);
    expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.DEFAULTS_MISSING });
  });

  it("SKIPs category_unmapped when JubelioCategoryMapping missing", async () => {
    prisma.item.findUnique.mockResolvedValue(baseItem);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findUnique.mockResolvedValue(null);
    const r = await handler.handle(row() as any);
    expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.CATEGORY_UNMAPPED });
  });

  it("SKIPs cannot_create_from_ingested when no mappings and source=JUBELIO_INGEST", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, source: "JUBELIO_INGEST" });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findUnique.mockResolvedValue({ jubelioCategoryId: 454 });
    const r = await handler.handle(row() as any);
    expect(r).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.CANNOT_CREATE_FROM_INGESTED });
  });

  it("CREATES variantless: POST with item_group_id=0, inserts 1 mapping", async () => {
    prisma.item.findUnique.mockResolvedValue(baseItem);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findUnique.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });

    const r = await handler.handle(row() as any);

    expect(http.post).toHaveBeenCalledWith("/inventory/catalog/", expect.objectContaining({
      item_group_id: 0,
    }));
    expect(prisma.jubelioProductMapping.createMany).toHaveBeenCalledWith({
      data: [{
        itemId: "item_1",
        jubelioItemGroupId: 7,
        jubelioItemId: 11,
        jubelioItemCode: "SKU-1",
        erpVariantSku: "",
      }],
    });
    expect(http.delete).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "processed" });
  });

  it("CREATES variants: POST + inserts 2 mappings", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }] });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findUnique.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11, 12] });

    await handler.handle(row() as any);

    expect(prisma.jubelioProductMapping.createMany).toHaveBeenCalledWith({
      data: [
        { itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 11, jubelioItemCode: "SKU-1-RED", erpVariantSku: "SKU-1-RED" },
        { itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 12, jubelioItemCode: "SKU-1-BLU", erpVariantSku: "SKU-1-BLU" },
      ],
    });
  });

  it("EDITS existing: reuses item_group_id, no new mappings, no DELETE", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }] });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7 },
    ]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findUnique.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });

    await handler.handle(row() as any);

    expect(http.post).toHaveBeenCalledWith("/inventory/catalog/", expect.objectContaining({
      item_group_id: 7,
    }));
    expect(prisma.jubelioProductMapping.createMany).not.toHaveBeenCalled();
    expect(prisma.jubelioProductMapping.deleteMany).not.toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it("ADDS a variant: mapping inserted for new sku only", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-GRN" }] });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7 },
    ]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findUnique.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11, 13] });

    await handler.handle(row() as any);

    expect(prisma.jubelioProductMapping.createMany).toHaveBeenCalledWith({
      data: [{ itemId: "item_1", jubelioItemGroupId: 7, jubelioItemId: 13, jubelioItemCode: "SKU-1-GRN", erpVariantSku: "SKU-1-GRN" }],
    });
    expect(http.delete).not.toHaveBeenCalled();
  });

  it("REMOVES a variant: POST without removed sku + DELETE call + mapping dropped", async () => {
    prisma.item.findUnique.mockResolvedValue({ ...baseItem, variants: [{ sku: "SKU-1-RED" }] });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7 },
      { id: "m2", erpVariantSku: "SKU-1-BLU", jubelioItemId: 12, jubelioItemGroupId: 7 },
    ]);
    prisma.jubelioPushDefaults.findFirst.mockResolvedValue(baseDefaults);
    prisma.jubelioCategoryMapping.findUnique.mockResolvedValue({ jubelioCategoryId: 454 });
    http.post.mockResolvedValue({ status: "ok", id: 7, item_ids: [11] });

    await handler.handle(row() as any);

    expect(http.delete).toHaveBeenCalledWith("/inventory/items/item-variant/", expect.objectContaining({
      body: JSON.stringify([12]),
    }));
    expect(prisma.jubelioProductMapping.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["m2"] } },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @elorae/api test -- product-push.handler.spec.ts 2>&1 | tail -10
```

Expected: FAIL "Cannot find module './product-push.handler'".

- [ ] **Step 3: Implement the handler**

`apps/api/src/jubelio/outbox/handlers/product-push.handler.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";
import {
  buildCreateProductRequest,
  type MappingSlice,
} from "./product-push.payload";

type CatalogPostResponse = {
  status: string;
  id: number;
  item_ids: number[];
};

@Injectable()
export class ProductPushHandler implements OutboxHandler {
  private readonly logger = new Logger(ProductPushHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const item = await this.prisma.item.findUnique({ where: { id: row.entityId } });
    if (!item) return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.ORPHAN_ITEM };
    if (item.type !== "FINISHED_GOOD") {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.WRONG_TYPE };
    }

    const mappings = (await this.prisma.jubelioProductMapping.findMany({
      where: { itemId: item.id },
    })) as MappingSlice[];

    const defaults = await this.prisma.jubelioPushDefaults.findFirst();
    if (!defaults) return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.DEFAULTS_MISSING };

    if (mappings.length === 0 && item.source !== "ERP") {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.CANNOT_CREATE_FROM_INGESTED };
    }

    if (!item.categoryId) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.CATEGORY_UNMAPPED };
    }
    const categoryMap = await this.prisma.jubelioCategoryMapping.findUnique({
      where: { itemCategoryId: item.categoryId },
    });
    if (!categoryMap) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.CATEGORY_UNMAPPED };
    }

    const variantsArr = Array.isArray(item.variants) ? (item.variants as Array<{ sku: string }>) : null;
    const hasVariants = variantsArr !== null && variantsArr.length > 0;

    const body = buildCreateProductRequest({
      item: {
        id: item.id,
        sku: item.sku,
        nameId: item.nameId,
        nameEn: item.nameEn,
        description: item.description,
        variants: variantsArr,
        sellingPrice: item.sellingPrice == null ? null : Number(item.sellingPrice),
        isActive: item.isActive,
      },
      defaults: {
        sellTaxId: defaults.sellTaxId, buyTaxId: defaults.buyTaxId,
        salesAcctId: defaults.salesAcctId, cogsAcctId: defaults.cogsAcctId,
        invtAcctId: defaults.invtAcctId, purchAcctId: defaults.purchAcctId,
        uomId: defaults.uomId, brandId: defaults.brandId, brandName: defaults.brandName,
        sellThis: defaults.sellThis, buyThis: defaults.buyThis, stockThis: defaults.stockThis,
        dropshipThis: defaults.dropshipThis, isActive: defaults.isActive,
        sellUnit: defaults.sellUnit, buyUnit: defaults.buyUnit,
        packageWeight: defaults.packageWeight,
        storePriorityQtyTreshold: defaults.storePriorityQtyTreshold,
        rop: defaults.rop,
        useSingleImageSet: defaults.useSingleImageSet,
        useSerialNumber: defaults.useSerialNumber,
        buyPrice: Number(defaults.buyPrice),
      },
      categoryJubelioId: categoryMap.jubelioCategoryId,
      mappings,
    });

    const response = await this.http.post<CatalogPostResponse>("/inventory/catalog/", body);

    const existingSkus = new Set(mappings.map((m) => m.erpVariantSku));
    const newMappings: Array<{
      itemId: string;
      jubelioItemGroupId: number;
      jubelioItemId: number;
      jubelioItemCode: string;
      erpVariantSku: string;
    }> = [];

    for (let i = 0; i < body.product_skus.length; i++) {
      const sku = body.product_skus[i];
      const jubelioItemId = response.item_ids[i];
      const erpVariantSku = hasVariants ? sku.item_code : "";
      if (!existingSkus.has(erpVariantSku)) {
        newMappings.push({
          itemId: item.id,
          jubelioItemGroupId: response.id,
          jubelioItemId,
          jubelioItemCode: sku.item_code,
          erpVariantSku,
        });
      }
    }
    if (newMappings.length > 0) {
      await this.prisma.jubelioProductMapping.createMany({ data: newMappings });
    }

    const desiredSkuSet = new Set(
      hasVariants ? variantsArr!.map((v) => v.sku) : [""],
    );
    const removed = mappings.filter((m) => !desiredSkuSet.has(m.erpVariantSku));
    if (removed.length > 0) {
      await this.http.delete("/inventory/items/item-variant/", {
        body: JSON.stringify(removed.map((m) => m.jubelioItemId)),
        headers: { "Content-Type": "application/json" },
      });
      await this.prisma.jubelioProductMapping.deleteMany({
        where: { id: { in: removed.map((m) => m.id) } },
      });
    }

    this.logger.log(
      `Pushed item ${item.id} (group=${response.id}, +${newMappings.length} mappings, -${removed.length})`,
    );
    return { kind: "processed" };
  }
}
```

- [ ] **Step 4: Run tests + full suite**

```bash
pnpm -F @elorae/api test -- product-push 2>&1 | tail -15
pnpm -F @elorae/api test 2>&1 | tail -10
```

Expected: 10 tests in product-push suite pass; full suite still green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/outbox/handlers/product-push.handler.ts apps/api/src/jubelio/outbox/handlers/product-push.handler.spec.ts
git commit -m "feat(api): product push handler with full variant lifecycle"
```

---

## Task 10: Wire ProductPushHandler into router + module

**Files:**
- Modify: `apps/api/src/jubelio/outbox/outbox-router.ts`
- Modify: `apps/api/src/jubelio/outbox/outbox-router.spec.ts`
- Modify: `apps/api/src/jubelio/outbox/jubelio-outbox.module.ts`

- [ ] **Step 1: Add `product_push` case to router**

Replace `apps/api/src/jubelio/outbox/outbox-router.ts` content with:

```ts
import { Injectable } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { StockPushHandler } from "./handlers/stock-push.handler";
import { ProductPushHandler } from "./handlers/product-push.handler";
import type { HandlerOutcome } from "./handlers/handler.types";
import { OUTBOX_SKIP_REASONS } from "./outbox-status";

@Injectable()
export class OutboxRouter {
  constructor(
    private readonly stockPush: StockPushHandler,
    private readonly productPush: ProductPushHandler,
  ) {}

  async route(row: JubelioOutbox): Promise<HandlerOutcome> {
    switch (row.entityType) {
      case "stock_push":
        return this.stockPush.handle(row);
      case "product_push":
        return this.productPush.handle(row);
      default:
        return {
          kind: "skipped",
          reason: `${OUTBOX_SKIP_REASONS.UNKNOWN_ENTITY_TYPE}:${row.entityType}`,
        };
    }
  }
}
```

- [ ] **Step 2: Update `outbox-router.spec.ts`**

Read the file. Two changes:

1. Constructor invocation now takes a second arg. Find all `new OutboxRouter(...)` calls (or whatever instantiation pattern the spec uses) and pass a productPush mock.

2. Add a new test case asserting product_push routing:

```ts
it("routes product_push to ProductPushHandler", async () => {
  const productPush = { handle: jest.fn().mockResolvedValue({ kind: "processed" }) };
  const stockPush = { handle: jest.fn() };
  const router = new OutboxRouter(stockPush as any, productPush as any);
  const result = await router.route({ entityType: "product_push" } as any);
  expect(productPush.handle).toHaveBeenCalled();
  expect(result).toEqual({ kind: "processed" });
});
```

- [ ] **Step 3: Register provider in `jubelio-outbox.module.ts`**

Add import:

```ts
import { ProductPushHandler } from "./handlers/product-push.handler";
```

Update the providers array:

```ts
providers: [OutboxPoller, OutboxProcessor, OutboxRouter, StockPushHandler, ProductPushHandler],
```

- [ ] **Step 4: Run full suite + build**

```bash
pnpm -F @elorae/api test 2>&1 | tail -10
pnpm -F @elorae/api build 2>&1 | tail -5
```

Expected: green + clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jubelio/outbox/outbox-router.ts apps/api/src/jubelio/outbox/outbox-router.spec.ts apps/api/src/jubelio/outbox/jubelio-outbox.module.ts
git commit -m "feat(api): route product_push entityType to handler"
```

---

## Task 11: Pushable-fields diff function (web)

**Files:**
- Create: `apps/web/lib/items/jubelio-push-diff.ts`

- [ ] **Step 1: Write the diff function**

`apps/web/lib/items/jubelio-push-diff.ts`:

```ts
export type PushableSnapshot = {
  nameId: string;
  nameEn: string;
  description: string | null;
  sellingPrice: number | null;
  variants: Array<Record<string, string>> | null;
  isActive: boolean;
};

function normalizeVariants(input: PushableSnapshot['variants']): string {
  if (!input || input.length === 0) return '[]';
  const sorted = [...input]
    .map((v) => {
      const sku = (v as Record<string, string>).sku ?? '';
      const entries = Object.entries(v as Record<string, string>)
        .filter(([k]) => k !== 'sku')
        .sort(([a], [b]) => a.localeCompare(b));
      return JSON.stringify({ sku, attrs: entries });
    })
    .sort();
  return JSON.stringify(sorted);
}

export function hasPushableChange(before: PushableSnapshot, after: PushableSnapshot): boolean {
  if (before.nameId !== after.nameId) return true;
  if (before.nameEn !== after.nameEn) return true;
  if ((before.description ?? '') !== (after.description ?? '')) return true;
  if ((before.sellingPrice ?? null) !== (after.sellingPrice ?? null)) return true;
  if (before.isActive !== after.isActive) return true;
  if (normalizeVariants(before.variants) !== normalizeVariants(after.variants)) return true;
  return false;
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent. (No automated tests in apps/web; correctness verified via manual smoke in Task 14.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/items/jubelio-push-diff.ts
git commit -m "feat(web): pushable-fields diff for product push trigger"
```

---

## Task 12: Web enqueue server actions

**Files:**
- Create: `apps/web/app/actions/jubelio-product-push.ts`

- [ ] **Step 1: Write the enqueue helpers**

`apps/web/app/actions/jubelio-product-push.ts`:

```ts
'use server';

import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/internal-api';
import { hasPushableChange, type PushableSnapshot } from '@/lib/items/jubelio-push-diff';

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function fireDirectEnqueue(rowId: string, userId: string): Promise<void> {
  void apiFetch('POST', `/jubelio/outbox/enqueue/${rowId}`, { userId }).catch(() => {
    // poller picks it up within ~5s if this fails
  });
}

export async function enqueueProductPushOnCreate(itemId: string): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, type: true, source: true },
  });
  if (!item) return;
  if (item.type !== 'FINISHED_GOOD') return;
  if (item.source !== 'ERP') return;

  const userId = await currentUserId();
  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: 'product_push',
      entityId: itemId,
      payload: {},
      enqueuedById: userId,
    },
    select: { id: true },
  });
  void fireDirectEnqueue(row.id, userId ?? '');
}

export async function enqueueProductPushOnUpdate(
  itemId: string,
  before: PushableSnapshot,
  after: PushableSnapshot,
): Promise<void> {
  if (!hasPushableChange(before, after)) return;

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, type: true, source: true },
  });
  if (!item) return;
  if (item.type !== 'FINISHED_GOOD') return;

  const hasMapping = (await prisma.jubelioProductMapping.count({ where: { itemId } })) > 0;
  if (!hasMapping && item.source !== 'ERP') return;

  const userId = await currentUserId();
  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: 'product_push',
      entityId: itemId,
      payload: {},
      enqueuedById: userId,
    },
    select: { id: true },
  });
  void fireDirectEnqueue(row.id, userId ?? '');
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/actions/jubelio-product-push.ts
git commit -m "feat(web): server actions to enqueue product_push outbox rows"
```

---

## Task 13: Wire enqueue into Item create/update flow

**Files:**
- Modify: `apps/web/lib/items/mutations.ts`
- Modify: `apps/web/app/actions/items.ts`

- [ ] **Step 1: Make `updateItem` return pre + post snapshots**

In `apps/web/lib/items/mutations.ts`, replace the `updateItem` function body. The new version loads the pre-update snapshot before the mutation and returns both alongside the existing serialized result:

```ts
export async function updateItem(id: string, data: ItemFormData) {
  const normalized = normalizeItemPayload(data);
  validateItemPayload(normalized);
  const { sku, ...rest } = normalized;
  void sku;

  const existing = await prisma.item.findUnique({
    where: { id },
    select: {
      sku: true,
      categoryId: true,
      nameId: true,
      nameEn: true,
      description: true,
      sellingPrice: true,
      variants: true,
      isActive: true,
    },
  });
  if (!existing) throw new Error('Item not found');
  const effectiveCategoryId =
    rest.categoryId !== undefined ? rest.categoryId || null : existing.categoryId;
  const categoryCode = await resolveCategoryCode(effectiveCategoryId);
  const normalizedVariants = validateAndNormalizeVariants(existing.sku, rest.variants, {
    categoryCode,
  });

  const item = await prisma.item.update({
    where: { id },
    data: {
      ...rest,
      categoryId: rest.categoryId ?? null,
      variants: normalizedVariants.length ? normalizedVariants : [],
      reorderPoint: rest.reorderPoint ?? null,
      overReceiveThreshold: rest.overReceiveThreshold ?? null,
      sellingPrice: rest.sellingPrice ?? null,
    },
  });

  return {
    item,
    serialized: serializeSingleItem(item),
    before: {
      nameId: existing.nameId,
      nameEn: existing.nameEn,
      description: existing.description,
      sellingPrice: existing.sellingPrice == null ? null : Number(existing.sellingPrice),
      variants: (existing.variants as Array<Record<string, string>> | null) ?? null,
      isActive: existing.isActive,
    },
    after: {
      nameId: item.nameId,
      nameEn: item.nameEn,
      description: item.description,
      sellingPrice: item.sellingPrice == null ? null : Number(item.sellingPrice),
      variants: (item.variants as Array<Record<string, string>> | null) ?? null,
      isActive: item.isActive,
    },
  };
}
```

This changes the return shape from a plain serialized item to an object containing `serialized` + `before` + `after`. Search for other callers:

```bash
grep -rn "updateItemLib\|from.*items/mutations" apps/web --include="*.ts" --include="*.tsx" | grep -v "\.next"
```

Update any caller that previously destructured the plain return to use `result.serialized` instead. If there is only one caller (`apps/web/app/actions/items.ts`, handled in Step 2), no further change.

- [ ] **Step 2: Wire enqueue into `apps/web/app/actions/items.ts`**

Add import near the existing ones:

```ts
import {
  enqueueProductPushOnCreate,
  enqueueProductPushOnUpdate,
} from '@/app/actions/jubelio-product-push';
```

Update `createItem` to fire enqueue (fire-and-forget, after the existing notify call):

```ts
export async function createItem(data: ItemFormData) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_CREATE);

  const { item, serialized } = await createItemLib(data);

  getActorName(session.user.id)
    .then((triggeredByName) =>
      notifyItemCreated(item.id, item.nameEn || item.nameId || item.sku, triggeredByName)
    )
    .catch(() => {});

  enqueueProductPushOnCreate(item.id).catch(() => {});

  revalidatePath('/backoffice/items');
  return serialized;
}
```

Update `updateItem` to consume the new return shape and fire enqueue:

```ts
export async function updateItem(id: string, data: ItemFormData) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);

  const result = await updateItemLib(id, data);

  enqueueProductPushOnUpdate(id, result.before, result.after).catch(() => {});

  revalidatePath('/backoffice/items');
  revalidatePath(`/backoffice/items/${id}`);
  return result.serialized;
}
```

- [ ] **Step 3: Type-check + build**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -10
pnpm -F @elorae/api type-check 2>&1 | tail -5
pnpm -F @elorae/api build 2>&1 | tail -5
```

Expected: all silent. If `.next/dev/types/validator.ts` reports TS1128, `rm -rf apps/web/.next/dev` and retry.

- [ ] **Step 4: Run all api tests**

```bash
pnpm -F @elorae/api test 2>&1 | tail -10
```

Expected: 9+ suites green, no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/items/mutations.ts apps/web/app/actions/items.ts
git commit -m "feat(web): trigger product_push on Item create + update"
```

---

## Task 14: End-to-end manual smoke (user-driven)

No file changes. User-driven verification, executed only after Tasks 1-13 are committed.

- [ ] **Step 1: Start support services**

User runs:

```bash
docker start elorae-dev-redis
pnpm -F @elorae/api build && cd apps/api && NODE_ENV=production node dist/main.js
# new terminal:
pnpm -F @elorae/web dev
```

Boot log should show `ProductPushHandler dependencies initialized` and `JubelioCatalogDeleteController` mapped.

- [ ] **Step 2: Confirm push defaults are populated**

Open `http://localhost:3000/backoffice/settings/jubelio`. The "Push defaults" card should show seeded values (sellTaxId=-1, salesAcctId=28, etc). Edit `brandName` to "Elorae Test" + Save. Toast confirms.

- [ ] **Step 3: Verify category mapping exists for test item**

```bash
cd packages/db && set -a && source ../../apps/web/.env && set +a && pnpm exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const m = await prisma.jubelioCategoryMapping.findMany({ include: { itemCategory: true } });
  console.log(m.map(r => ({ erp: r.itemCategory?.code ?? r.itemCategoryId, jubelio: r.jubelioCategoryId })));
  await prisma.\$disconnect();
})();
" 2>&1 | tail -5
```

If empty, run catalog ingest (`POST /jubelio/catalog/sync`) once to seed category mappings, or insert one manually with a known-valid Jubelio category id.

- [ ] **Step 4: Create a new test item with variants**

In the items UI, create a `FINISHED_GOOD`:
- SKU prefix: `TEST-PUSH-001` (recognizable test prefix)
- nameId/nameEn populated
- description ≥ 30 chars
- categoryId = one with a Jubelio mapping
- sellingPrice = 50000
- variants = [{ sku: "TEST-PUSH-001-RED" }, { sku: "TEST-PUSH-001-BLU" }]

Submit. The outbox dashboard should show a `product_push` row reaching DONE within ~2 seconds.

Verify mappings inserted:

```bash
cd packages/db && set -a && source ../../apps/web/.env && set +a && pnpm exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const m = await prisma.jubelioProductMapping.findMany({ where: { item: { sku: { startsWith: 'TEST-PUSH-001' } } } });
  console.log(m);
  await prisma.\$disconnect();
})();
" 2>&1 | tail -10
```

Expected: 2 mapping rows, same `jubelioItemGroupId`, different `jubelioItemId`.

- [ ] **Step 5: Verify the listing on Jubelio**

Open Jubelio admin → Inventory → Items. Find by `item_code` `TEST-PUSH-001-RED`. Confirm:
- Group exists
- Both variants present
- `sell_price` = 50000
- `brand_name` = "Elorae Test"

- [ ] **Step 6: Edit the item (price change)**

In Elorae UI, open the test item, change `sellingPrice` to 60000, save. Outbox row → DONE. Jubelio admin: price updated.

- [ ] **Step 7: Add a variant**

Edit the test item, add variant `TEST-PUSH-001-GRN`. Save. Outbox row → DONE. Mapping table now has 3 rows. Jubelio admin shows the new variant.

- [ ] **Step 8: Remove a variant**

Edit, drop the BLU variant. Save. Outbox row → DONE. Mapping table down to 2 rows. Jubelio admin no longer shows BLU. api log should show `DELETE /inventory/items/item-variant/`.

- [ ] **Step 9: Cleanup**

Note the `jubelioItemGroupId` from a mapping row. On `/backoffice/settings/jubelio`, scroll to "Test cleanup", enter the group_id, confirm deletion. Toast confirms. Verify Jubelio admin: listing gone. Verify mapping rows gone:

```bash
cd packages/db && set -a && source ../../apps/web/.env && set +a && pnpm exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const m = await prisma.jubelioProductMapping.findMany({ where: { item: { sku: { startsWith: 'TEST-PUSH-001' } } } });
  console.log('remaining mappings:', m.length);
  await prisma.\$disconnect();
})();
" 2>&1 | tail -3
```

Expected: `remaining mappings: 0`.

- [ ] **Step 10: Delete the local test Item**

In Elorae UI, delete the test item (sub-3 doesn't auto-clean Jubelio on Item delete — that's a separate feature). No outbox row created.

- [ ] **Step 11: Stop services**

User runs Ctrl-C on api + web terminals, then:

```bash
docker stop elorae-dev-redis
```

- [ ] **Step 12: Push branch**

```bash
git push -u origin feat/product-push
```

Open PR `feat/product-push → master` once smoke is green.

---

## After all tasks

- Branch `feat/product-push` carries: defaults table + UI, delete-for-rollback endpoint + button, product push handler with full variant lifecycle, web trigger wiring.
- Full api test suite: ~75+ tests (55 baseline + 3 catalog-delete + 7 payload + 10 handler + 1 router = +21).
- Next slice: **sub-4** (remaining inbound webhook handlers — salesorder, salesreturn, product) or **sub-5** (bulk migration tool) depending on priority.

## Self-Review checklist (already run; documenting)

- **Spec coverage:**
  - §3 architecture → Tasks 1, 3-13 build the components.
  - §4 data model → Task 1.
  - §5 trigger flow → Tasks 11, 12, 13.
  - §6 handler logic → Tasks 8, 9, 10.
  - §7 defaults + UI → Tasks 5, 6, 7.
  - §8 boundary respect → preserved (api owns mapping; web owns outbox + defaults).
  - §9 error/idempotency → handler design (Task 9) + tests (Task 9 step 1).
  - §10 testing → Tasks 3 (delete svc), 8 (payload), 9 (handler), 10 (router).
  - §11 open questions → addressed inline: `variation_values=[]`; pre/post snapshot returned from updateItem; settings UI inline on existing page; per-variant `sell_price` mirrors top-level; reconcile uses createMany not transaction (acceptable per §9 partial-failure analysis).
  - §12 test rollback → Tasks 3, 4, 5 land BEFORE handler/triggers (Tasks 9-13), enabling safe smoke.
  - §13 decisions log → all locked.
- **No placeholders:** every code-changing step has complete code. Smoke steps reference real SKU prefix `TEST-PUSH-001` and real env paths.
- **Type consistency:** `PushableSnapshot`, `JubelioPushDefaultsInput/State`, `MappingSlice`, `CreateProductRequestBody`, `enqueueProductPushOnCreate/OnUpdate`, `deleteJubelioProduct`, `OUTBOX_SKIP_REASONS.*` consistent across tasks.
