# HPP → Selling Price Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-recalculate `Item.sellingPrice` from `avgCost * (1 + margin) + extras` on every FG receipt and margin change, audit each change, and propagate to Jubelio.

**Architecture:** New helper `recalcItemSellingPrice` in `@elorae/db` is the single entry point. Three server-action paths (FG receipt, margin edit, push-defaults edit) call it inside their respective transactions. Helper updates the Item, writes an `ItemPriceChangeLog` row, and enqueues a `product_push` outbox row when the item has a Jubelio mapping. Existing `ProductPushHandler` consumes the outbox row — no change needed downstream.

**Tech Stack:** Prisma 7 + TiDB (MariaDB-compatible) · TypeScript · `@elorae/db` writer-helper pattern · NestJS handler stays untouched · next-intl for UI strings.

**Spec reference:** `docs/superpowers/specs/2026-06-14-hpp-price-sync-design.md`.

---

## CRITICAL operating constraints (for executing subagents)

These memories OVERRIDE default execution behavior:

- **NEVER run `pnpm -F @elorae/web type-check`, `test`, or `build`.** Saturates the user's WSL disk and crashes their IDE. apps/api jest is fine. Web verification is the user's job.
- **User owns all service start/stop ops.** Do not run `pnpm dev`, `pnpm prod`, `docker compose`, `pkill`, or `ngrok`. Tell the user when a restart is needed; don't do it for them.
- **No auto-push.** After completing a task and committing, STOP. Wait for explicit "push" from user before `git push` or PR creation.
- **After schema changes (Task 1), run BOTH `pnpm -F @elorae/db generate` AND `pnpm -F @elorae/db build`.** The package's subpath exports point at `dist/`, not `src/` — skipping the build breaks imports.
- **`prisma migrate dev` is FORBIDDEN against the shared TiDB.** Use `pnpm -F @elorae/db migrate:deploy` only. Migration SQL is hand-written under `packages/db/prisma/migrations/<timestamp>_<name>/migration.sql`.
- **Double quotes** for all TypeScript/JavaScript string literals. **No Prisma model comments.** **No EPIC-XX labels** in commits / branch / spec docs.
- **One-liner commit messages**, no body, no `Co-Authored-By` trailer.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/prisma/schema.prisma` | Add `Item.targetMarginPercent`, `Item.additionalCost`; add `JubelioPushDefaults.defaultMarginPercent` + `defaultAdditionalCost`; add `ItemPriceChangeLog` model + `PriceChangeTrigger` enum | Modify |
| `packages/db/prisma/migrations/<timestamp>_add_item_target_margin_and_price_log/migration.sql` | Migration | Create |
| `packages/db/src/item-price-writer.ts` | `recalcItemSellingPrice(tx, input)` helper + types + skip-reason enum | Create |
| `packages/db/src/index.ts` | Re-export helper + types | Modify |
| `apps/api/src/jubelio/queue/item-price-writer.spec.ts` | Helper unit tests (run via api jest harness — db has no test runner) | Create |
| `apps/web/lib/items/jubelio-push-diff.ts` | Extend `PushableSnapshot` with `targetMarginPercent` + `additionalCost`; extend `hasPushableChange` | Modify |
| `apps/web/lib/items/mutations.ts` | Add new fields to `ItemFormData` + validators | Modify |
| `apps/web/app/actions/production.ts:1008-1188` (`receiveFG`) | Call helper inside TX; post-commit `apiFetch` | Modify |
| `apps/web/app/actions/items.ts` (`updateItem`) | Detect margin/extras change → call helper. Detect manual `sellingPrice` change → audit log row. | Modify |
| `apps/web/app/actions/jubelio-push-defaults.ts` (`saveJubelioPushDefaults`) | Fan-out across margin-null items; batch above threshold. | Modify |
| `apps/web/components/forms/ItemForm.tsx` | Add Pricing section: `targetMarginPercent`, `additionalCost`, computed sellingPrice preview | Modify |
| `apps/web/app/backoffice/jubelio/settings/page.tsx` | Add `defaultMarginPercent`, `defaultAdditionalCost` inputs to push-defaults card; fan-out confirmation dialog | Modify |
| `apps/web/app/backoffice/items/[id]/ItemDetailClient.tsx` | New Price History tab + table | Modify |
| `apps/web/app/actions/item-price-history.ts` | New server action `getItemPriceHistory(itemId, pagination)` | Create |
| `apps/web/lib/i18n/messages/en.json` + `id.json` | New keys under `items.pricing.*` and `items.priceHistory.*` | Modify |

---

## Task 1: Schema + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_item_target_margin_and_price_log/migration.sql`

- [ ] **Step 1: Locate Item, JubelioPushDefaults, and FGReceipt models in schema.prisma**

```bash
grep -n "^model Item\b\|^model JubelioPushDefaults\b\|^model FGReceipt\b\|^model User\b" packages/db/prisma/schema.prisma
```

Note the line numbers for use in subsequent edits.

- [ ] **Step 2: Add fields to Item model**

Inside `model Item { ... }`, after the existing `sellingPrice` field, add:

```prisma
  targetMarginPercent  Decimal? @db.Decimal(5,2)
  additionalCost       Decimal? @db.Decimal(15,2)
```

And before the closing `}`, add the back-relation (alphabetical with other relations is fine):

```prisma
  priceChangeLogs      ItemPriceChangeLog[]
```

- [ ] **Step 3: Add fields to JubelioPushDefaults model**

Inside `model JubelioPushDefaults { ... }`, after the existing `buyPrice` field, add:

```prisma
  defaultMarginPercent     Decimal? @db.Decimal(5,2)
  defaultAdditionalCost    Decimal? @db.Decimal(15,2)
```

- [ ] **Step 4: Add ItemPriceChangeLog model + PriceChangeTrigger enum**

Append to the end of `schema.prisma`:

```prisma
model ItemPriceChangeLog {
  id                  String   @id @default(cuid())
  itemId              String
  item                Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  oldSellingPrice     Decimal? @db.Decimal(14,2)
  newSellingPrice     Decimal? @db.Decimal(14,2)
  oldAvgCost          Decimal? @db.Decimal(15,2)
  newAvgCost          Decimal? @db.Decimal(15,2)
  marginPercentUsed   Decimal? @db.Decimal(5,2)
  additionalCostUsed  Decimal? @db.Decimal(15,2)
  triggerReason       PriceChangeTrigger
  fgReceiptId         String?
  fgReceipt           FGReceipt? @relation(fields: [fgReceiptId], references: [id], onDelete: SetNull)
  changedAt           DateTime @default(now())
  changedById         String?
  changedBy           User?    @relation(fields: [changedById], references: [id])

  @@index([itemId, changedAt])
  @@index([fgReceiptId])
}

enum PriceChangeTrigger {
  FG_RECEIPT
  MARGIN_CHANGE
  DEFAULTS_CHANGE
  MANUAL_EDIT
}
```

- [ ] **Step 5: Add back-relations to FGReceipt and User**

Inside `model FGReceipt { ... }` before its closing `}`, add:

```prisma
  priceChangeLogs ItemPriceChangeLog[]
```

Inside `model User { ... }` before its closing `}`, add:

```prisma
  priceChangeLogs ItemPriceChangeLog[]
```

(If `User` already has many relations, place it grouped with other audit-style back-relations.)

- [ ] **Step 6: Generate Prisma client + build @elorae/db**

```bash
pnpm -F @elorae/db generate
pnpm -F @elorae/db build
```

Expected: `tsc` exits 0. Prisma client now has `prisma.itemPriceChangeLog`, `Item.targetMarginPercent`, etc.

- [ ] **Step 7: Create migration directory + SQL**

```bash
TIMESTAMP=$(date -u +%Y%m%d%H%M%S)
mkdir -p packages/db/prisma/migrations/${TIMESTAMP}_add_item_target_margin_and_price_log
```

Create `packages/db/prisma/migrations/${TIMESTAMP}_add_item_target_margin_and_price_log/migration.sql`:

```sql
-- Item: target margin and additional cost
ALTER TABLE `Item`
  ADD COLUMN `targetMarginPercent` DECIMAL(5,2) NULL,
  ADD COLUMN `additionalCost` DECIMAL(15,2) NULL;

-- JubelioPushDefaults: default margin and additional cost
ALTER TABLE `JubelioPushDefaults`
  ADD COLUMN `defaultMarginPercent` DECIMAL(5,2) NULL,
  ADD COLUMN `defaultAdditionalCost` DECIMAL(15,2) NULL;

-- ItemPriceChangeLog
CREATE TABLE `ItemPriceChangeLog` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `oldSellingPrice` DECIMAL(14,2) NULL,
  `newSellingPrice` DECIMAL(14,2) NULL,
  `oldAvgCost` DECIMAL(15,2) NULL,
  `newAvgCost` DECIMAL(15,2) NULL,
  `marginPercentUsed` DECIMAL(5,2) NULL,
  `additionalCostUsed` DECIMAL(15,2) NULL,
  `triggerReason` ENUM('FG_RECEIPT','MARGIN_CHANGE','DEFAULTS_CHANGE','MANUAL_EDIT') NOT NULL,
  `fgReceiptId` VARCHAR(191) NULL,
  `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `changedById` VARCHAR(191) NULL,

  PRIMARY KEY (`id`),
  INDEX `ItemPriceChangeLog_itemId_changedAt_idx` (`itemId`, `changedAt`),
  INDEX `ItemPriceChangeLog_fgReceiptId_idx` (`fgReceiptId`),
  CONSTRAINT `ItemPriceChangeLog_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ItemPriceChangeLog_fgReceiptId_fkey` FOREIGN KEY (`fgReceiptId`) REFERENCES `FGReceipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ItemPriceChangeLog_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
);
```

- [ ] **Step 8: Apply migration to TiDB**

```bash
pnpm -F @elorae/db migrate:deploy
```

Expected output: `1 migration found in prisma/migrations. The migration <name> has been applied successfully.`

If the migration fails, investigate the error (do NOT `migrate dev` to "fix" — that would create throwaway migrations). Fix the SQL inline, then re-run `migrate:deploy`.

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): item target margin + ItemPriceChangeLog schema"
```

---

## Task 2: `recalcItemSellingPrice` helper (TDD)

**Files:**
- Create: `packages/db/src/item-price-writer.ts`
- Create: `apps/api/src/jubelio/queue/item-price-writer.spec.ts` (apps/api hosts the jest harness for `@elorae/db` helpers)
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing test — resolves item-level margin over defaults**

Create `apps/api/src/jubelio/queue/item-price-writer.spec.ts`:

```ts
import { recalcItemSellingPrice } from "@elorae/db";

describe("recalcItemSellingPrice", () => {
  function createTx(overrides: Partial<any> = {}): any {
    return {
      item: { findUnique: jest.fn(), update: jest.fn() },
      jubelioPushDefaults: { findFirst: jest.fn() },
      inventoryValue: { findUnique: jest.fn() },
      itemPriceChangeLog: { create: jest.fn() },
      jubelioProductMapping: { count: jest.fn() },
      jubelioOutbox: { create: jest.fn() },
      ...overrides,
    };
  }

  it("uses Item.targetMarginPercent when set, ignoring defaults", async () => {
    const tx = createTx();
    tx.item.findUnique.mockResolvedValue({
      id: "i1",
      type: "FINISHED_GOOD",
      source: "ERP",
      sellingPrice: 100,
      targetMarginPercent: 30,
      additionalCost: null,
    });
    tx.jubelioPushDefaults.findFirst.mockResolvedValue({
      defaultMarginPercent: 50, // should NOT be used
      defaultAdditionalCost: null,
    });
    tx.jubelioProductMapping.count.mockResolvedValue(0);
    tx.item.update.mockResolvedValue({});
    tx.itemPriceChangeLog.create.mockResolvedValue({});

    const result = await recalcItemSellingPrice(tx, {
      itemId: "i1",
      trigger: "FG_RECEIPT",
      newAvgCost: 200,
      fgReceiptId: "r1",
      changedById: "u1",
    });

    expect(result).toEqual(expect.objectContaining({
      applied: true,
      newSellingPrice: 260, // 200 * 1.30 + 0
    }));
    expect(tx.item.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "i1" },
      data: { sellingPrice: 260 },
    }));
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd apps/api && npx jest --runInBand --testPathPattern=item-price-writer
```

Expected: FAIL — `Cannot find module '@elorae/db'`-flavored error or `recalcItemSellingPrice is not a function`.

- [ ] **Step 3: Implement helper minimal version**

Create `packages/db/src/item-price-writer.ts`:

```ts
import type { Prisma } from "../generated/prisma/client";
import type { JubelioOutboxEntityType } from "./jubelio-outbox";

export type PriceChangeTrigger = "FG_RECEIPT" | "MARGIN_CHANGE" | "DEFAULTS_CHANGE";

export type RecalcItemSellingPriceInput = {
  itemId: string;
  trigger: PriceChangeTrigger;
  newAvgCost?: number;
  fgReceiptId?: string;
  changedById: string | null;
};

export type RecalcSkipReason =
  | "no_change"
  | "no_margin_configured"
  | "ingested_item"
  | "non_finished_good";

export type RecalcItemSellingPriceResult =
  | {
      applied: true;
      oldSellingPrice: number | null;
      newSellingPrice: number;
      outboxRowId: string | null;
    }
  | { applied: false; skipped: RecalcSkipReason };

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

export async function recalcItemSellingPrice(
  tx: Prisma.TransactionClient,
  input: RecalcItemSellingPriceInput,
): Promise<RecalcItemSellingPriceResult> {
  const item = await tx.item.findUnique({
    where: { id: input.itemId },
    select: {
      id: true,
      type: true,
      source: true,
      sellingPrice: true,
      targetMarginPercent: true,
      additionalCost: true,
    },
  });
  if (!item) return { applied: false, skipped: "non_finished_good" };
  if (item.type !== "FINISHED_GOOD") return { applied: false, skipped: "non_finished_good" };
  if (item.source === "JUBELIO_INGEST") return { applied: false, skipped: "ingested_item" };

  const defaults = await tx.jubelioPushDefaults.findFirst({
    select: { defaultMarginPercent: true, defaultAdditionalCost: true },
  });

  const effectiveMargin =
    item.targetMarginPercent != null
      ? toNum(item.targetMarginPercent)
      : defaults?.defaultMarginPercent != null
        ? toNum(defaults.defaultMarginPercent)
        : null;

  if (effectiveMargin === null) {
    return { applied: false, skipped: "no_margin_configured" };
  }

  const effectiveExtras =
    item.additionalCost != null
      ? toNum(item.additionalCost)
      : defaults?.defaultAdditionalCost != null
        ? toNum(defaults.defaultAdditionalCost)
        : 0;

  const newAvgCost =
    input.newAvgCost != null
      ? input.newAvgCost
      : await (async () => {
          const inv = await tx.inventoryValue.findUnique({
            where: { itemId_variantSku: { itemId: input.itemId, variantSku: "" } },
            select: { avgCost: true },
          });
          return inv ? toNum(inv.avgCost) : 0;
        })();

  const newSellingPriceRaw = newAvgCost * (1 + effectiveMargin / 100) + effectiveExtras;
  const newSellingPrice = Math.round(newSellingPriceRaw * 100) / 100;
  const oldSellingPrice = item.sellingPrice != null ? toNum(item.sellingPrice) : null;

  if (oldSellingPrice === newSellingPrice) {
    return { applied: false, skipped: "no_change" };
  }

  await tx.item.update({
    where: { id: input.itemId },
    data: { sellingPrice: newSellingPrice },
  });

  await tx.itemPriceChangeLog.create({
    data: {
      itemId: input.itemId,
      oldSellingPrice,
      newSellingPrice,
      oldAvgCost: null,
      newAvgCost,
      marginPercentUsed: effectiveMargin,
      additionalCostUsed: effectiveExtras,
      triggerReason: input.trigger,
      fgReceiptId: input.fgReceiptId ?? null,
      changedById: input.changedById,
    },
  });

  const mappingCount = await tx.jubelioProductMapping.count({
    where: { itemId: input.itemId },
  });

  let outboxRowId: string | null = null;
  if (mappingCount > 0) {
    const row = await tx.jubelioOutbox.create({
      data: {
        entityType: "product_push" satisfies JubelioOutboxEntityType,
        entityId: input.itemId,
        payload: {},
        enqueuedById: input.changedById,
      },
      select: { id: true },
    });
    outboxRowId = row.id;
  }

  return {
    applied: true,
    oldSellingPrice,
    newSellingPrice,
    outboxRowId,
  };
}
```

- [ ] **Step 4: Re-export helper from index**

Edit `packages/db/src/index.ts` — add to the export block alongside other writer helpers:

```ts
export {
  recalcItemSellingPrice,
  type RecalcItemSellingPriceInput,
  type RecalcItemSellingPriceResult,
  type RecalcSkipReason,
  type PriceChangeTrigger,
} from "./item-price-writer";
```

- [ ] **Step 5: Rebuild @elorae/db**

```bash
pnpm -F @elorae/db build
```

Expected: `tsc` exits 0.

- [ ] **Step 6: Re-run test, confirm pass**

```bash
cd apps/api && npx jest --runInBand --testPathPattern=item-price-writer
```

Expected: 1 test passes.

- [ ] **Step 7: Add remaining test cases**

Append to the describe block:

```ts
it("falls back to defaults.defaultMarginPercent when item margin is null", async () => {
  const tx = createTx();
  tx.item.findUnique.mockResolvedValue({
    id: "i1", type: "FINISHED_GOOD", source: "ERP",
    sellingPrice: null, targetMarginPercent: null, additionalCost: null,
  });
  tx.jubelioPushDefaults.findFirst.mockResolvedValue({
    defaultMarginPercent: 25, defaultAdditionalCost: 5,
  });
  tx.jubelioProductMapping.count.mockResolvedValue(0);

  const result = await recalcItemSellingPrice(tx, {
    itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 100, changedById: "u1",
  });

  expect(result).toEqual(expect.objectContaining({
    applied: true,
    newSellingPrice: 130, // 100 * 1.25 + 5
  }));
});

it("returns skipped:no_margin_configured when neither item nor defaults has margin", async () => {
  const tx = createTx();
  tx.item.findUnique.mockResolvedValue({
    id: "i1", type: "FINISHED_GOOD", source: "ERP",
    sellingPrice: null, targetMarginPercent: null, additionalCost: null,
  });
  tx.jubelioPushDefaults.findFirst.mockResolvedValue({
    defaultMarginPercent: null, defaultAdditionalCost: null,
  });

  const result = await recalcItemSellingPrice(tx, {
    itemId: "i1", trigger: "MARGIN_CHANGE", changedById: "u1",
  });

  expect(result).toEqual({ applied: false, skipped: "no_margin_configured" });
  expect(tx.item.update).not.toHaveBeenCalled();
});

it("returns skipped:non_finished_good for raw material", async () => {
  const tx = createTx();
  tx.item.findUnique.mockResolvedValue({
    id: "i1", type: "FABRIC", source: "ERP",
    sellingPrice: null, targetMarginPercent: 30, additionalCost: null,
  });

  const result = await recalcItemSellingPrice(tx, {
    itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 100, changedById: "u1",
  });

  expect(result).toEqual({ applied: false, skipped: "non_finished_good" });
});

it("returns skipped:ingested_item when source is JUBELIO_INGEST", async () => {
  const tx = createTx();
  tx.item.findUnique.mockResolvedValue({
    id: "i1", type: "FINISHED_GOOD", source: "JUBELIO_INGEST",
    sellingPrice: 99, targetMarginPercent: 30, additionalCost: null,
  });

  const result = await recalcItemSellingPrice(tx, {
    itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 100, changedById: "u1",
  });

  expect(result).toEqual({ applied: false, skipped: "ingested_item" });
});

it("returns skipped:no_change when computed price equals current", async () => {
  const tx = createTx();
  tx.item.findUnique.mockResolvedValue({
    id: "i1", type: "FINISHED_GOOD", source: "ERP",
    sellingPrice: 130, targetMarginPercent: 30, additionalCost: null,
  });
  tx.jubelioPushDefaults.findFirst.mockResolvedValue({
    defaultMarginPercent: null, defaultAdditionalCost: null,
  });
  // newAvgCost 100 * 1.30 = 130, equal to current sellingPrice

  const result = await recalcItemSellingPrice(tx, {
    itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 100, changedById: "u1",
  });

  expect(result).toEqual({ applied: false, skipped: "no_change" });
  expect(tx.itemPriceChangeLog.create).not.toHaveBeenCalled();
  expect(tx.jubelioOutbox.create).not.toHaveBeenCalled();
});

it("enqueues product_push outbox row when item has Jubelio mapping", async () => {
  const tx = createTx();
  tx.item.findUnique.mockResolvedValue({
    id: "i1", type: "FINISHED_GOOD", source: "ERP",
    sellingPrice: 100, targetMarginPercent: 30, additionalCost: null,
  });
  tx.jubelioPushDefaults.findFirst.mockResolvedValue({});
  tx.jubelioProductMapping.count.mockResolvedValue(2);
  tx.jubelioOutbox.create.mockResolvedValue({ id: "ob1" });
  tx.itemPriceChangeLog.create.mockResolvedValue({});

  const result = await recalcItemSellingPrice(tx, {
    itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 200, fgReceiptId: "r1", changedById: "u1",
  });

  expect(tx.jubelioOutbox.create).toHaveBeenCalledWith({
    data: {
      entityType: "product_push",
      entityId: "i1",
      payload: {},
      enqueuedById: "u1",
    },
    select: { id: true },
  });
  expect(result).toEqual(expect.objectContaining({ applied: true, outboxRowId: "ob1" }));
});

it("does not enqueue outbox when no Jubelio mapping exists", async () => {
  const tx = createTx();
  tx.item.findUnique.mockResolvedValue({
    id: "i1", type: "FINISHED_GOOD", source: "ERP",
    sellingPrice: 100, targetMarginPercent: 30, additionalCost: null,
  });
  tx.jubelioPushDefaults.findFirst.mockResolvedValue({});
  tx.jubelioProductMapping.count.mockResolvedValue(0);
  tx.itemPriceChangeLog.create.mockResolvedValue({});

  const result = await recalcItemSellingPrice(tx, {
    itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 200, changedById: "u1",
  });

  expect(tx.jubelioOutbox.create).not.toHaveBeenCalled();
  expect(result).toEqual(expect.objectContaining({ applied: true, outboxRowId: null }));
});

it("writes ItemPriceChangeLog with fgReceiptId for FG_RECEIPT trigger", async () => {
  const tx = createTx();
  tx.item.findUnique.mockResolvedValue({
    id: "i1", type: "FINISHED_GOOD", source: "ERP",
    sellingPrice: 100, targetMarginPercent: 30, additionalCost: null,
  });
  tx.jubelioPushDefaults.findFirst.mockResolvedValue({});
  tx.jubelioProductMapping.count.mockResolvedValue(0);

  await recalcItemSellingPrice(tx, {
    itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 200, fgReceiptId: "r1", changedById: "u1",
  });

  expect(tx.itemPriceChangeLog.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      itemId: "i1",
      oldSellingPrice: 100,
      newSellingPrice: 260,
      newAvgCost: 200,
      marginPercentUsed: 30,
      additionalCostUsed: 0,
      triggerReason: "FG_RECEIPT",
      fgReceiptId: "r1",
      changedById: "u1",
    }),
  });
});
```

- [ ] **Step 8: Run all tests, confirm pass**

```bash
cd apps/api && npx jest --runInBand --testPathPattern=item-price-writer
```

Expected: 8 tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/item-price-writer.ts packages/db/src/index.ts apps/api/src/jubelio/queue/item-price-writer.spec.ts
git commit -m "feat(db): recalcItemSellingPrice helper with tests"
```

---

## Task 3: Extend pushable-diff to watch margin + extras

**Files:**
- Modify: `apps/web/lib/items/jubelio-push-diff.ts`

- [ ] **Step 1: Read current file**

Note line numbers for `PushableSnapshot` type and `hasPushableChange` function.

- [ ] **Step 2: Add fields to type and comparator**

Replace the entire file content with:

```ts
export type PushableSnapshot = {
  nameId: string;
  nameEn: string;
  description: string | null;
  sellingPrice: number | null;
  targetMarginPercent: number | null;
  additionalCost: number | null;
  variants: Array<Record<string, string>> | null;
  isActive: boolean;
};

function normalizeVariants(input: PushableSnapshot["variants"]): string {
  if (!input || input.length === 0) return "[]";
  const sorted = [...input]
    .map((v) => {
      const sku = (v as Record<string, string>).sku ?? "";
      const entries = Object.entries(v as Record<string, string>)
        .filter(([k]) => k !== "sku")
        .sort(([a], [b]) => a.localeCompare(b));
      return JSON.stringify({ sku, attrs: entries });
    })
    .sort();
  return JSON.stringify(sorted);
}

export function hasPushableChange(before: PushableSnapshot, after: PushableSnapshot): boolean {
  if (before.nameId !== after.nameId) return true;
  if (before.nameEn !== after.nameEn) return true;
  if ((before.description ?? "") !== (after.description ?? "")) return true;
  if ((before.sellingPrice ?? null) !== (after.sellingPrice ?? null)) return true;
  if ((before.targetMarginPercent ?? null) !== (after.targetMarginPercent ?? null)) return true;
  if ((before.additionalCost ?? null) !== (after.additionalCost ?? null)) return true;
  if (before.isActive !== after.isActive) return true;
  if (normalizeVariants(before.variants) !== normalizeVariants(after.variants)) return true;
  return false;
}
```

Note: the existing single-quote style is replaced with double quotes per project convention.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/items/jubelio-push-diff.ts
git commit -m "feat(web): pushable-diff watches targetMarginPercent and additionalCost"
```

---

## Task 4: Wire `receiveFG` to recalc on FG receipt

**Files:**
- Modify: `apps/web/app/actions/production.ts:1008-1194` (`receiveFG`)

- [ ] **Step 1: Read receiveFG function and confirm structure**

```bash
grep -n "export async function receiveFG\|return { receipt, woCompleted }\|notifyWOCompleted" apps/web/app/actions/production.ts
```

Confirms:
- TX opens at line ~1015
- TX returns `{ receipt, woCompleted }` at line ~1187
- Post-commit `notifyWOCompleted` fire-and-forget at line ~1191
- Receipt's `avgCostPerUnit` available as `avgCostPerUnit.toNumber()`

- [ ] **Step 2: Add import**

Near the top of `apps/web/app/actions/production.ts` with the other `@elorae/db` imports, add:

```ts
import { recalcItemSellingPrice } from "@elorae/db";
import { apiFetch } from "@/lib/internal-api";
```

(If `apiFetch` is already imported, skip that line.)

- [ ] **Step 3: Inject recalc inside the TX, capture outbox id in return value**

In `apps/web/app/actions/production.ts`, find the line `return { receipt, woCompleted };` inside the `prisma.$transaction(async (tx) => { ... })` block (around line 1187). Replace it with:

```ts
    let recalcOutboxRowId: string | null = null;
    if (wo.finishedGoodId && qtyAccepted > 0) {
      const recalc = await recalcItemSellingPrice(tx, {
        itemId: wo.finishedGoodId,
        trigger: "FG_RECEIPT",
        newAvgCost: avgCostPerUnit.toNumber(),
        fgReceiptId: receipt.id,
        changedById: userId,
      });
      if (recalc.applied) recalcOutboxRowId = recalc.outboxRowId;
    }

    return { receipt, woCompleted, recalcOutboxRowId };
```

- [ ] **Step 4: Fire post-commit dispatch hint**

Find the existing post-commit block:

```ts
  if (receiveResult.woCompleted) {
    notifyWOCompleted(data.woId, userId).catch(() => {});
  }
  return receiveResult.receipt;
```

Insert before `return receiveResult.receipt`:

```ts
  if (receiveResult.recalcOutboxRowId) {
    void apiFetch("POST", `/jubelio/outbox/enqueue/${receiveResult.recalcOutboxRowId}`, {
      userId,
    }).catch(() => {
      // poller picks it up within ~5s if this fails
    });
  }
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/actions/production.ts
git commit -m "feat(web): receiveFG triggers sellingPrice recalc on accepted qty"
```

- [ ] **Step 6: Note for user verification**

User runs: trigger a Work Order FG receipt → verify `Item.sellingPrice` updates → `ItemPriceChangeLog` row exists → `JubelioOutbox` row appears (if item has mapping).

(Web tests/type-check are user-run per `feedback_web_typecheck_disk`.)

---

## Task 5: Wire `updateItem` for margin change + manual edit audit

**Files:**
- Modify: `apps/web/lib/items/mutations.ts`
- Modify: `apps/web/app/actions/items.ts`

- [ ] **Step 1: Add fields to ItemFormData + validator**

Edit `apps/web/lib/items/mutations.ts`. Replace the `ItemFormData` type:

```ts
export type ItemFormData = {
  sku?: string;
  nameId: string;
  nameEn: string;
  type: "FABRIC" | "ACCESSORIES" | "FINISHED_GOOD";
  uomId: string;
  categoryId?: string;
  description?: string;
  variants?: Array<Record<string, string>>;
  reorderPoint?: number;
  overReceiveThreshold?: number;
  sellingPrice?: number;
  targetMarginPercent?: number;
  additionalCost?: number;
};
```

Replace the matching block in `SerializedItem` type:

```ts
export type SerializedItem = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: string;
  uomId: string;
  categoryId: string | null;
  reorderPoint: number | null;
  overReceiveThreshold: number | null;
  sellingPrice: number | null;
  targetMarginPercent: number | null;
  additionalCost: number | null;
  [k: string]: unknown;
};
```

In `validateItemPayload`, after the existing `sellingPrice` check, add:

```ts
  if (p.targetMarginPercent != null && (Number.isNaN(p.targetMarginPercent) || p.targetMarginPercent < 0)) {
    throw new Error("targetMarginPercent: Must be 0 or greater");
  }
  if (p.additionalCost != null && (Number.isNaN(p.additionalCost) || p.additionalCost < 0)) {
    throw new Error("additionalCost: Must be 0 or greater");
  }
```

Also find the section that builds the Prisma `data` payload for `prisma.item.create` and `prisma.item.update` calls and ensure `targetMarginPercent` and `additionalCost` flow through:

```bash
grep -n "sellingPrice:" apps/web/lib/items/mutations.ts
```

Wherever `sellingPrice: data.sellingPrice ?? null` (or similar) appears in the create/update payload, add right after it:

```ts
        targetMarginPercent: data.targetMarginPercent ?? null,
        additionalCost: data.additionalCost ?? null,
```

(Confirm exact context line-by-line; the conditional shape may differ slightly between create vs update paths.)

- [ ] **Step 2: Add recalc + manual-edit audit row in `updateItem` server action**

Read `apps/web/app/actions/items.ts:updateItem`:

```bash
grep -n "export async function updateItem\|updateItemLib\|prisma.\$transaction" apps/web/app/actions/items.ts | head -20
```

The action wraps `updateItemLib` from `@/lib/items/mutations`. The cleanest insertion point: before `updateItemLib` is called, fetch the current Item for margin/extras/sellingPrice; after `updateItemLib` returns (or inside its TX if it exposes one), detect changes and call helper. If `updateItemLib` doesn't expose a TX, wrap both calls in `prisma.$transaction`.

Add the imports at the top of `apps/web/app/actions/items.ts`:

```ts
import { recalcItemSellingPrice } from "@elorae/db";
import { apiFetch } from "@/lib/internal-api";
```

Inside `updateItem`, transform the function body to use a single transaction. Example shape (adapt to existing structure):

```ts
export async function updateItem(id: string, data: ItemFormData) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT);

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.item.findUnique({
      where: { id },
      select: {
        targetMarginPercent: true,
        additionalCost: true,
        sellingPrice: true,
      },
    });
    if (!before) throw new Error("Item not found");

    // Existing mutation flow runs against tx (refactor updateItemLib to accept tx, or inline the relevant logic here)
    const updated = await updateItemLib(tx, id, data);

    const marginChanged =
      Number(before.targetMarginPercent ?? null) !== Number(data.targetMarginPercent ?? null);
    const extrasChanged =
      Number(before.additionalCost ?? null) !== Number(data.additionalCost ?? null);
    const sellingPriceChanged =
      Number(before.sellingPrice ?? null) !== Number(data.sellingPrice ?? null);

    let outboxRowId: string | null = null;

    if (marginChanged || extrasChanged) {
      const recalc = await recalcItemSellingPrice(tx, {
        itemId: id,
        trigger: "MARGIN_CHANGE",
        changedById: session.user.id,
      });
      if (recalc.applied) outboxRowId = recalc.outboxRowId;
    } else if (sellingPriceChanged) {
      // Manual sellingPrice override — log it; outbox enqueue handled by existing pushable-diff path.
      await tx.itemPriceChangeLog.create({
        data: {
          itemId: id,
          oldSellingPrice: before.sellingPrice != null ? Number(before.sellingPrice) : null,
          newSellingPrice: data.sellingPrice ?? null,
          oldAvgCost: null,
          newAvgCost: null,
          marginPercentUsed: null,
          additionalCostUsed: null,
          triggerReason: "MANUAL_EDIT",
          fgReceiptId: null,
          changedById: session.user.id,
        },
      });
    }

    return { updated, outboxRowId };
  });

  if (result.outboxRowId) {
    void apiFetch("POST", `/jubelio/outbox/enqueue/${result.outboxRowId}`, {
      userId: session.user.id,
    }).catch(() => {});
  }

  return result.updated;
}
```

**Note:** If `updateItemLib` currently opens its own `prisma.$transaction`, refactor its signature to accept a `tx` parameter so it composes inside this outer TX. If that refactor is too invasive, fall back to: call `updateItemLib` first (its own TX), then start a second `prisma.$transaction` for the recalc + audit. Two TXs is a degraded but acceptable shape — the audit row and recalc still cluster atomically.

- [ ] **Step 3: Confirm createItem path**

Same file or `mutations.ts`: when creating an Item with `targetMarginPercent` set but no avgCost yet, do NOT call the helper. Recalc happens on first FG receipt. Verify the create path doesn't accidentally call `recalcItemSellingPrice`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/items/mutations.ts apps/web/app/actions/items.ts
git commit -m "feat(web): updateItem triggers recalc on margin change, audit on manual sellingPrice edit"
```

- [ ] **Step 5: Note for user verification**

User runs: edit an Item — change `targetMarginPercent` → expect Item.sellingPrice recomputed + audit row trigger=MARGIN_CHANGE + outbox row. Change `sellingPrice` directly (no margin change) → expect audit row trigger=MANUAL_EDIT + outbox row via existing diff path.

---

## Task 6: Wire `saveJubelioPushDefaults` for fan-out

**Files:**
- Modify: `apps/web/app/actions/jubelio-push-defaults.ts`

- [ ] **Step 1: Read current action**

```bash
grep -n "export async function saveJubelioPushDefaults\|JubelioPushDefaultsInput\|defaultMarginPercent" apps/web/app/actions/jubelio-push-defaults.ts
```

- [ ] **Step 2: Add fields to input type and persist them**

Add to `JubelioPushDefaultsInput` and `JubelioPushDefaultsState` types (whichever the file defines):

```ts
  defaultMarginPercent: number | null;
  defaultAdditionalCost: number | null;
```

In the `update` call where `buyPrice` is persisted, also persist:

```ts
        defaultMarginPercent: input.defaultMarginPercent ?? null,
        defaultAdditionalCost: input.defaultAdditionalCost ?? null,
```

- [ ] **Step 3: Add fan-out logic**

At the top of `saveJubelioPushDefaults`, after the auth check, fetch the previous defaults to compare:

```ts
import { recalcItemSellingPrice } from "@elorae/db";
import { apiFetch } from "@/lib/internal-api";

// inside saveJubelioPushDefaults, after auth:
const previous = await prisma.jubelioPushDefaults.findFirst({
  select: { defaultMarginPercent: true, defaultAdditionalCost: true },
});

const marginChanged =
  Number(previous?.defaultMarginPercent ?? null) !== Number(input.defaultMarginPercent ?? null);
const extrasChanged =
  Number(previous?.defaultAdditionalCost ?? null) !== Number(input.defaultAdditionalCost ?? null);
```

Replace the existing `update` call with:

```ts
const saved = await prisma.$transaction(async (tx) => {
  return tx.jubelioPushDefaults.update({
    where: { /* existing key */ },
    data: {
      // ... existing fields
      defaultMarginPercent: input.defaultMarginPercent ?? null,
      defaultAdditionalCost: input.defaultAdditionalCost ?? null,
    },
  });
});

const outboxRowIds: string[] = [];

if (marginChanged || extrasChanged) {
  const affected = await prisma.item.findMany({
    where: {
      type: "FINISHED_GOOD",
      targetMarginPercent: null,
      source: { not: "JUBELIO_INGEST" },
    },
    select: { id: true },
  });

  const BATCH_SIZE = 100;
  const SMALL_FANOUT_THRESHOLD = 500;
  const userId = session.user.id;

  if (affected.length <= SMALL_FANOUT_THRESHOLD) {
    await prisma.$transaction(async (tx) => {
      for (const { id } of affected) {
        const recalc = await recalcItemSellingPrice(tx, {
          itemId: id,
          trigger: "DEFAULTS_CHANGE",
          changedById: userId,
        });
        if (recalc.applied && recalc.outboxRowId) outboxRowIds.push(recalc.outboxRowId);
      }
    });
  } else {
    for (let i = 0; i < affected.length; i += BATCH_SIZE) {
      const batch = affected.slice(i, i + BATCH_SIZE);
      await prisma.$transaction(async (tx) => {
        for (const { id } of batch) {
          const recalc = await recalcItemSellingPrice(tx, {
            itemId: id,
            trigger: "DEFAULTS_CHANGE",
            changedById: userId,
          });
          if (recalc.applied && recalc.outboxRowId) outboxRowIds.push(recalc.outboxRowId);
        }
      });
    }
  }

  // Best-effort: fire dispatch hints for the first N rows so users see immediate progress.
  // Skip the rest; the poller drains them.
  const HINT_LIMIT = 50;
  for (const rowId of outboxRowIds.slice(0, HINT_LIMIT)) {
    void apiFetch("POST", `/jubelio/outbox/enqueue/${rowId}`, { userId }).catch(() => {});
  }
}

return { ...saved, fanOutCount: outboxRowIds.length };
```

Update the return type of `saveJubelioPushDefaults` to include `fanOutCount: number` so the UI can confirm.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/actions/jubelio-push-defaults.ts
git commit -m "feat(web): push-defaults change fans out sellingPrice recalc across margin-null items"
```

- [ ] **Step 5: Note for user verification**

User runs: edit push defaults → change default margin → expect N items recalculated + outbox rows enqueued. Verify only items with `targetMarginPercent IS NULL` and `source != JUBELIO_INGEST` are touched.

---

## Task 7: ItemForm UI — margin + additional cost fields + computed preview

**Files:**
- Modify: `apps/web/components/forms/ItemForm.tsx`

- [ ] **Step 1: Add to initialData destructuring + defaultValues**

In the `ItemFormProps` interface, after `sellingPrice`:

```ts
    targetMarginPercent?: number;
    additionalCost?: number;
```

In `useForm` `defaultValues`, after `sellingPrice`:

```ts
      targetMarginPercent: initialData?.targetMarginPercent,
      additionalCost: initialData?.additionalCost,
```

- [ ] **Step 2: Add Pricing section JSX**

Locate the existing `sellingPrice` input block (around line 627). Wrap it + the new fields in a section labelled "Pricing" (`{t("itemForm.pricingSection")}` — i18n key added in Task 10). Add right after the existing `sellingPrice` input closing wrapper:

```tsx
<div>
  <Label htmlFor="targetMarginPercent">
    Target Margin (%) <span className="text-xs text-muted-foreground">(optional)</span>
  </Label>
  <Input
    id="targetMarginPercent"
    type="number"
    step="0.01"
    min={0}
    {...register("targetMarginPercent", { valueAsNumber: true })}
    aria-invalid={!!errors.targetMarginPercent}
  />
  <p className="text-xs text-muted-foreground mt-1">
    Leave blank to use the default from Jubelio push settings.
  </p>
</div>

<div>
  <Label htmlFor="additionalCost">
    Additional Cost per pcs (Rp) <span className="text-xs text-muted-foreground">(optional)</span>
  </Label>
  <Input
    id="additionalCost"
    type="number"
    step="0.01"
    min={0}
    {...register("additionalCost", { valueAsNumber: true })}
    aria-invalid={!!errors.additionalCost}
  />
  <p className="text-xs text-muted-foreground mt-1">
    Flat add-on per unit (packaging, etc).
  </p>
</div>
```

Pricing section ONLY visible when `itemType === ItemType.FINISHED_GOOD` (the schema-level skip in the helper protects backend; UI also gates to reduce noise). Wrap the entire pricing block:

```tsx
{itemType === ItemType.FINISHED_GOOD && (
  <div className="space-y-4 border-t pt-4">
    {/* existing sellingPrice block, plus new targetMarginPercent + additionalCost blocks */}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/forms/ItemForm.tsx
git commit -m "feat(web): ItemForm exposes targetMarginPercent and additionalCost for FINISHED_GOOD items"
```

- [ ] **Step 4: Note for user verification**

User opens any Finished Good item edit form → see new Pricing section with margin + additional cost inputs. Save with values → reload → values persist.

---

## Task 8: Jubelio settings UI — default margin + additional cost

**Files:**
- Modify: `apps/web/app/backoffice/jubelio/settings/page.tsx`

- [ ] **Step 1: Add inputs after existing Buy Price field**

Read the current page to locate the `NumField label="Buy Price (default)"` block (around line 283).

Add immediately after that block:

```tsx
<NumField
  label="Default Margin (%)"
  value={defaultsDraft.defaultMarginPercent}
  onChange={(v) => setDefaultsDraft({ ...defaultsDraft, defaultMarginPercent: v ?? null })}
/>
<NumField
  label="Default Additional Cost (Rp)"
  value={defaultsDraft.defaultAdditionalCost}
  onChange={(v) => setDefaultsDraft({ ...defaultsDraft, defaultAdditionalCost: v ?? null })}
/>
```

(If `NumField` doesn't accept `null` in its `onChange`, look at its signature in the same file or a shared component dir; the pattern may need `v ?? 0` with a workaround, or `defaultMarginPercent: v === undefined ? null : v`.)

- [ ] **Step 2: Add confirmation dialog before save**

Wrap the save handler (where `saveJubelioPushDefaults(defaultsDraft)` is called, ~line 113):

```tsx
async function handleSave() {
  // existing precondition checks…

  // Count affected items if margin/extras differ from current defaults
  const marginDiff = (defaults?.defaultMarginPercent ?? null) !== (defaultsDraft.defaultMarginPercent ?? null);
  const extrasDiff = (defaults?.defaultAdditionalCost ?? null) !== (defaultsDraft.defaultAdditionalCost ?? null);

  if (marginDiff || extrasDiff) {
    const count = await getMarginFallbackItemCount(); // new server action; see step 3
    const confirmText =
      count > 500
        ? `${count} items will be recalculated and pushed to Jubelio in batches. This may take a few seconds. Continue?`
        : `${count} items will be recalculated and pushed to Jubelio. Continue?`;
    if (!confirm(confirmText)) return;
  }

  const saved = await saveJubelioPushDefaults(defaultsDraft);
  toast.success(`Saved. ${saved.fanOutCount} items recalculated.`);
  // existing post-save behavior...
}
```

- [ ] **Step 3: Add server action to count fallback items**

Append to `apps/web/app/actions/jubelio-push-defaults.ts`:

```ts
export async function getMarginFallbackItemCount(): Promise<number> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  return prisma.item.count({
    where: {
      type: "FINISHED_GOOD",
      targetMarginPercent: null,
      source: { not: "JUBELIO_INGEST" },
    },
  });
}
```

Import the new action in `page.tsx`:

```ts
import { getMarginFallbackItemCount } from "@/app/actions/jubelio-push-defaults";
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/backoffice/jubelio/settings/page.tsx apps/web/app/actions/jubelio-push-defaults.ts
git commit -m "feat(web): Jubelio settings exposes default margin + fan-out confirmation"
```

- [ ] **Step 5: Note for user verification**

User opens `/backoffice/jubelio/settings` → see Default Margin + Default Additional Cost inputs. Change default margin → click Save → confirmation dialog appears with item count → confirm → toast shows N items recalculated.

---

## Task 9: Item detail — Price history tab

**Files:**
- Create: `apps/web/app/actions/item-price-history.ts`
- Modify: `apps/web/app/backoffice/items/[id]/ItemDetailClient.tsx`

- [ ] **Step 1: Create server action for price history**

Create `apps/web/app/actions/item-price-history.ts`:

```ts
"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";

export type ItemPriceHistoryRow = {
  id: string;
  changedAt: Date;
  triggerReason: "FG_RECEIPT" | "MARGIN_CHANGE" | "DEFAULTS_CHANGE" | "MANUAL_EDIT";
  oldSellingPrice: number | null;
  newSellingPrice: number | null;
  newAvgCost: number | null;
  marginPercentUsed: number | null;
  additionalCostUsed: number | null;
  fgReceiptDocNumber: string | null;
  changedByName: string | null;
};

export async function getItemPriceHistory(
  itemId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ rows: ItemPriceHistoryRow[]; total: number }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_VIEW);

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [rows, total] = await Promise.all([
    prisma.itemPriceChangeLog.findMany({
      where: { itemId },
      orderBy: { changedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        fgReceipt: { select: { docNumber: true } },
        changedBy: { select: { name: true } },
      },
    }),
    prisma.itemPriceChangeLog.count({ where: { itemId } }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      changedAt: r.changedAt,
      triggerReason: r.triggerReason,
      oldSellingPrice: r.oldSellingPrice != null ? Number(r.oldSellingPrice) : null,
      newSellingPrice: r.newSellingPrice != null ? Number(r.newSellingPrice) : null,
      newAvgCost: r.newAvgCost != null ? Number(r.newAvgCost) : null,
      marginPercentUsed: r.marginPercentUsed != null ? Number(r.marginPercentUsed) : null,
      additionalCostUsed: r.additionalCostUsed != null ? Number(r.additionalCostUsed) : null,
      fgReceiptDocNumber: r.fgReceipt?.docNumber ?? null,
      changedByName: r.changedBy?.name ?? null,
    })),
    total,
  };
}
```

- [ ] **Step 2: Add Price History tab to ItemDetailClient**

Read `apps/web/app/backoffice/items/[id]/ItemDetailClient.tsx` to find the existing Tabs structure.

Add a new `<TabsTrigger value="price-history">{t("priceHistory.tab")}</TabsTrigger>` next to existing tabs and a matching `<TabsContent value="price-history">` block:

```tsx
<TabsContent value="price-history">
  <PriceHistoryTable itemId={props.item.id} />
</TabsContent>
```

In the same file or a new `PriceHistoryTable.tsx` component, render:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { getItemPriceHistory, type ItemPriceHistoryRow } from "@/app/actions/item-price-history";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatPrice(v: number | null, locale: string): string {
  if (v == null) return "—";
  return `Rp ${v.toLocaleString(locale === "id" ? "id-ID" : "en-US")}`;
}

function formatDateTime(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(d));
}

export function PriceHistoryTable({ itemId }: { itemId: string }) {
  const t = useTranslations("items.priceHistory");
  const locale = useLocale();
  const [rows, setRows] = useState<ItemPriceHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getItemPriceHistory(itemId, { limit: 50, offset: 0 })
      .then((res) => {
        if (!cancelled) {
          setRows(res.rows);
          setTotal(res.total);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (loading) return <div className="text-sm text-muted-foreground">{t("loading")}</div>;
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">{t("empty")}</div>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("colChangedAt")}</TableHead>
          <TableHead>{t("colTrigger")}</TableHead>
          <TableHead className="text-right">{t("colOldPrice")}</TableHead>
          <TableHead className="text-right">{t("colNewPrice")}</TableHead>
          <TableHead className="text-right">{t("colAvgCost")}</TableHead>
          <TableHead className="text-right">{t("colMargin")}</TableHead>
          <TableHead>{t("colSource")}</TableHead>
          <TableHead>{t("colActor")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{formatDateTime(r.changedAt, locale)}</TableCell>
            <TableCell>{t(`trigger.${r.triggerReason}` as never)}</TableCell>
            <TableCell className="text-right">{formatPrice(r.oldSellingPrice, locale)}</TableCell>
            <TableCell className="text-right">{formatPrice(r.newSellingPrice, locale)}</TableCell>
            <TableCell className="text-right">{formatPrice(r.newAvgCost, locale)}</TableCell>
            <TableCell className="text-right">
              {r.marginPercentUsed != null ? `${r.marginPercentUsed}%` : "—"}
            </TableCell>
            <TableCell>{r.fgReceiptDocNumber ?? "—"}</TableCell>
            <TableCell>{r.changedByName ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

(If `total > 50`, add a "Showing first 50" hint above the table. Pagination is a future improvement.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/actions/item-price-history.ts apps/web/app/backoffice/items/[id]/ItemDetailClient.tsx
git commit -m "feat(web): item detail page Price History tab"
```

- [ ] **Step 4: Note for user verification**

User opens any Item detail page → clicks Price History tab → sees table populated after a recalc fires (Task 4 or 5 must have triggered at least once for non-empty data).

---

## Task 10: i18n keys + branch wrap-up

**Files:**
- Modify: `apps/web/lib/i18n/messages/en.json`
- Modify: `apps/web/lib/i18n/messages/id.json`

- [ ] **Step 1: Add `items.pricing.*` and `items.priceHistory.*` to en.json**

Within the existing `items` namespace, add keys:

```json
"pricing": {
  "section": "Pricing",
  "sellingPriceLabel": "Selling Price (Harga Jual)",
  "targetMarginLabel": "Target Margin (%)",
  "targetMarginHint": "Leave blank to use the default from Jubelio push settings.",
  "additionalCostLabel": "Additional Cost per pcs (Rp)",
  "additionalCostHint": "Flat add-on per unit (packaging, etc).",
  "computedPreview": "Computed selling price = avgCost × (1 + margin/100) + additionalCost"
},
"priceHistory": {
  "tab": "Price History",
  "loading": "Loading price history…",
  "empty": "No price changes recorded yet.",
  "colChangedAt": "Changed at",
  "colTrigger": "Trigger",
  "colOldPrice": "Old price",
  "colNewPrice": "New price",
  "colAvgCost": "avgCost basis",
  "colMargin": "Margin used",
  "colSource": "FG Receipt",
  "colActor": "Actor",
  "trigger": {
    "FG_RECEIPT": "FG Receipt",
    "MARGIN_CHANGE": "Margin change",
    "DEFAULTS_CHANGE": "Defaults change",
    "MANUAL_EDIT": "Manual edit"
  }
},
```

- [ ] **Step 2: Mirror in id.json**

Within `items` namespace:

```json
"pricing": {
  "section": "Harga",
  "sellingPriceLabel": "Harga Jual",
  "targetMarginLabel": "Target Margin (%)",
  "targetMarginHint": "Kosongkan untuk pakai default dari pengaturan push Jubelio.",
  "additionalCostLabel": "Biaya Tambahan per pcs (Rp)",
  "additionalCostHint": "Tambahan tetap per unit (kemasan, dll).",
  "computedPreview": "Harga jual otomatis = avgCost × (1 + margin/100) + biaya tambahan"
},
"priceHistory": {
  "tab": "Riwayat Harga",
  "loading": "Memuat riwayat harga…",
  "empty": "Belum ada perubahan harga tercatat.",
  "colChangedAt": "Tanggal ubah",
  "colTrigger": "Pemicu",
  "colOldPrice": "Harga lama",
  "colNewPrice": "Harga baru",
  "colAvgCost": "Basis avgCost",
  "colMargin": "Margin dipakai",
  "colSource": "FG Receipt",
  "colActor": "Pelaku",
  "trigger": {
    "FG_RECEIPT": "Penerimaan FG",
    "MARGIN_CHANGE": "Ubah margin",
    "DEFAULTS_CHANGE": "Ubah default",
    "MANUAL_EDIT": "Edit manual"
  }
}
```

- [ ] **Step 3: Validate JSON syntax**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/en.json'))"
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/id.json'))"
```

Both must exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/i18n/messages/en.json apps/web/lib/i18n/messages/id.json
git commit -m "i18n: HPP price sync strings (en + id)"
```

- [ ] **Step 5: Stop. Notify user for full smoke + push.**

After Task 10 commits, all code is in place. **Do NOT push.** Tell the user:

> All 10 tasks complete on branch `feat/hpp-price-sync`. Smoke targets:
> 1. Edit an item: set targetMarginPercent → expect computed sellingPrice + audit row.
> 2. Approve a Work Order receipt: expect sellingPrice recalculated + audit row trigger=FG_RECEIPT + outbox row.
> 3. Edit Jubelio push defaults default margin: confirmation dialog → fan-out → N items recalculated.
> 4. Open any item's Price History tab: rows render correctly in en + id.
> 5. Verify no recalc on FABRIC/ACCESSORIES items or JUBELIO_INGEST-source items.
> 
> Once smoke is green, say push to open the PR.

---

## Post-merge tasks (not in this branch)

After PR merges, per CLAUDE.md maintenance rule:

- Update `docs/BOUNDARY.md` decision `H1`-`H8` table entry status (move from spec-decision to "shipped"). Mention `recalcItemSellingPrice` in §3.6 single-owner-web sentinel (it's a new dual-trigger helper).
- Update `docs/INTEGRATION-GUIDE.md`: add a section "Triggering a price recalc from a new caller" pointing at `recalcItemSellingPrice`.
- Update the CLAUDE.md "Integration work — decomposition + status" table: sub-3 status from 🟡 to ✅ with PR reference.
