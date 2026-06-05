# Product Push (Elorae → Jubelio) — Design Spec

**Date:** 2026-05-28
**Scope:** EPIC-02-01 (Push New Product to Jubelio) + EPIC-02-02 (HPP/Price Sync)
**Sub-project:** sub-3 (single PR, atomic ship)
**Status:** draft, awaiting approval

## 1. Goal

When an admin creates or updates a `FINISHED_GOOD` Item in Elorae, propagate the change to Jubelio's catalog: create the product on first push (for `source = ERP` items), update fields/price/variants on subsequent pushes (for both ERP-source and ingested items with mapping). Variant lifecycle (add/remove) is fully supported in this sub.

## 2. Scope

### In scope
- New outbox `entityType` = `product_push`.
- Single Jubelio API call per push (`POST /inventory/catalog/`) handles create + edit + variant add + per-variant field changes.
- Separate `DELETE /inventory/items/item-variant/` call for variants removed locally.
- Web-side auto-trigger: `Item.create` / `Item.update` server actions enqueue a `product_push` row when relevant fields change. Direct-enqueue against api (sub-2.5 signed channel) for ~1s latency; poller is safety net.
- New singleton table `JubelioPushDefaults` holding the heavy required-field set (tax, account, brand, uom, package defaults) plus an admin settings UI.
- Handler reads current Item + mappings + defaults + category mapping at process time. Idempotent.
- Tests: handler unit tests covering each branch; mutations layer test for the pushable-fields diff; settings server-action tests.

### Out of scope (deferred to later subs)
- HPP-driven price recalc — admin owns `sellingPrice` manually. `InventoryValue.avgCost` (HPP) changes do NOT auto-recalc price.
- In-place variant SKU rename — treated as remove + add. Old Jubelio listing deleted, new one created.
- Image upload to Jubelio.
- Category creation push — handler SKIPs if Item's category has no `JubelioCategoryMapping`. Admin must seed mappings manually or via catalog ingest.
- Brand creation push — handler uses `brand_id` from defaults (or null).
- Pushing non-`FINISHED_GOOD` items.
- Bulk "push all products" admin action — current per-item auto-trigger suffices; bulk is sub-5 (migration tool) territory.

## 3. Architecture

```
┌─────────────────────── apps/web ───────────────────────┐
│ createItem / updateItem server actions                 │
│   └─ after Item.create/update succeeds                 │
│       └─ enqueueProductPushOnCreate / OnUpdate         │
│           ├─ writes JubelioOutbox row                  │
│           └─ apiFetch POST /jubelio/outbox/enqueue/:id │
│                                                         │
│ /backoffice/settings/jubelio (existing page)           │
│   └─ inline "Push defaults" section                    │
│       └─ getJubelioPushDefaults / save server actions  │
└─────────────────────────────────────────────────────────┘
                          │ signed HMAC (sub-2.5)
                          ▼
┌─────────────────────── apps/api ───────────────────────┐
│ OutboxRouter (entityType switch)                       │
│   └─ "product_push" → ProductPushHandler.handle(row)   │
│       ├─ reads Item, JubelioProductMapping[],          │
│       │   JubelioCategoryMapping, JubelioPushDefaults  │
│       ├─ builds createProductRequest body              │
│       ├─ POST /inventory/catalog/  (1 call)            │
│       ├─ reconciles mappings from item_ids[] response  │
│       └─ DELETE /inventory/items/item-variant/         │
│           (only if variants were removed locally)      │
└─────────────────────────────────────────────────────────┘
```

## 4. Data model changes

### New table: `JubelioPushDefaults`

Single-row table (sentinel `id = "singleton"` or first-row-wins; pattern up to plan stage). Holds defaults seeded from Jubelio's documented values in the OpenAPI spec.

```prisma
model JubelioPushDefaults {
  id                       String   @id @default("singleton")
  sellTaxId                Int      @default(-1)      // PPN
  buyTaxId                 Int      @default(-1)      // PPN
  salesAcctId              Int      @default(28)
  cogsAcctId               Int      @default(30)
  invtAcctId               Int      @default(4)
  purchAcctId              Int?                         // null = NULL
  uomId                    Int      @default(-1)
  brandId                  String?                      // null = no brand
  brandName                String?                      // optional override
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
  updatedBy                User?    @relation(fields: [updatedById], references: [id])
}
```

Migration: create table + seed one row with the defaults shown above. Field names mirror Jubelio's snake_case where it helps comprehension; Prisma camelCase by convention.

### No changes to existing models

`Item`, `JubelioProductMapping`, `JubelioOutbox`, `JubelioCategoryMapping` — all unchanged.

## 5. Trigger flow (apps/web)

### 5.1 Pushable-fields diff

Define in `apps/web/lib/items/jubelio-push-diff.ts`:

```ts
type PushableSnapshot = {
  nameId: string;
  nameEn: string;
  description: string | null;
  sellingPrice: number | null;
  variants: VariantJson[] | null;
  isActive: boolean;
};

export function hasPushableChange(before: PushableSnapshot, after: PushableSnapshot): boolean;
```

Compares field-by-field. Variants compared as a normalized set (key = sku, attrs deep-equal).

### 5.2 Enqueue helpers

New file `apps/web/app/actions/jubelio-product-push.ts`:

```ts
"use server";

export async function enqueueProductPushOnCreate(itemId: string): Promise<void>;
export async function enqueueProductPushOnUpdate(
  itemId: string,
  before: PushableSnapshot,
  after: PushableSnapshot,
): Promise<void>;
```

Both:
- Verify Item exists + `type === FINISHED_GOOD`.
- Gate logic:
  - Create-time: only if `source === ERP` (no mapping yet expected). Always enqueue.
  - Update-time: enqueue if mapping exists OR (source = ERP AND no mapping yet); skip otherwise. Skip if `!hasPushableChange(before, after)`.
- Insert `JubelioOutbox { entityType: "product_push", entityId: itemId, payload: {}, enqueuedById }`.
- Fire `apiFetch("POST", "/jubelio/outbox/enqueue/:rowId")` and swallow errors (poller rescues).

### 5.3 Wire into existing server actions

`apps/web/app/actions/items.ts`:
- `createItem`: after `createItemLib(data)` succeeds, call `enqueueProductPushOnCreate(item.id)` (await is optional; mirrors existing `notifyItemCreated` fire-and-forget pattern).
- `updateItem`: capture `before` (re-fetch via `getItemById(id)` before mutation OR have mutation return both pre+post snapshots), call `enqueueProductPushOnUpdate(id, before, after)` after success.

`updateItemLib` may need to return the pre-update snapshot or the call site can fetch it first. Decision deferred to plan stage; ergonomic, low-risk either way.

## 6. Handler logic (apps/api)

### 6.1 File: `apps/api/src/jubelio/outbox/handlers/product-push.handler.ts`

```
async handle(row):
  itemId = row.entityId

  item = prisma.item.findUnique({ where: { id: itemId }, include: { category: true } })
  if !item                       → SKIP "orphan_item"
  if item.type !== FINISHED_GOOD → SKIP "wrong_type"

  mappings = prisma.jubelioProductMapping.findMany({ where: { itemId } })
  defaults = prisma.jubelioPushDefaults.findFirst()
  if !defaults                   → SKIP "defaults_missing"

  categoryMap = item.categoryId
    ? prisma.jubelioCategoryMapping.findUnique({ where: { itemCategoryId: item.categoryId } })
    : null
  if !categoryMap                → SKIP "category_unmapped"

  isCreate = mappings.length === 0
  if isCreate && item.source !== "ERP" → SKIP "cannot_create_from_ingested"

  // Build product_skus[] from Item.variants (or single-row variantless)
  desiredVariants = item.variants?.length
    ? item.variants.map(v => ({ sku: v.sku, attrs: v.attrs, item_id: mappingForSku(v.sku)?.jubelioItemId ?? 0 }))
    : [{ sku: item.sku, attrs: {}, item_id: mappings[0]?.jubelioItemId ?? 0 }]

  // Body
  body = buildCreateProductRequest({ item, defaults, categoryMap, desiredVariants, mappings })
  // body.item_group_id = mappings[0]?.jubelioItemGroupId ?? 0
  // body.sell_price = item.sellingPrice (top-level), per-variant sell_price omitted (falls back)

  response = http.post("/inventory/catalog/", body)
  // response = { status, id (item_group_id), item_ids[] (in product_skus order) }

  // Reconcile mappings: each product_skus[i] now has response.item_ids[i]
  await reconcileMappings({ itemId, groupId: response.id, desiredVariants, itemIds: response.item_ids })

  // Drop variants that exist in mappings but not in Item.variants
  removed = mappings.filter(m => !desiredVariants.some(d => d.sku === m.erpVariantSku))
  if removed.length > 0:
    http.delete("/inventory/items/item-variant/", { body: removed.map(m => m.jubelioItemId) })
    prisma.jubelioProductMapping.deleteMany({ where: { id: { in: removed.map(m => m.id) } } })

  return PROCESSED
```

### 6.2 Body builder: `apps/api/src/jubelio/outbox/handlers/product-push.payload.ts`

Pure function. Takes `{ item, defaults, categoryMap, desiredVariants, mappings }`, returns the full POST body. Easily unit-testable without prisma/http.

### 6.3 New skip reasons

In `apps/api/src/jubelio/outbox/outbox-status.ts`:

```ts
export const OUTBOX_SKIP_REASONS = {
  MISSING_MAPPING: "missing_mapping",       // existing (stock_push)
  NO_INVENTORY: "no_inventory",             // existing
  UNKNOWN_ENTITY_TYPE: "unknown_entity_type", // existing
  ORPHAN_ITEM: "orphan_item",
  WRONG_TYPE: "wrong_type",
  DEFAULTS_MISSING: "defaults_missing",
  CATEGORY_UNMAPPED: "category_unmapped",
  CANNOT_CREATE_FROM_INGESTED: "cannot_create_from_ingested",
} as const;
```

### 6.4 Router

Extend `OutboxRouter` to dispatch `product_push` to `ProductPushHandler`.

## 7. Defaults table + UI

### 7.1 Server actions: `apps/web/app/actions/jubelio-push-defaults.ts`

```ts
export async function getJubelioPushDefaults(): Promise<JubelioPushDefaults>;
export async function saveJubelioPushDefaults(input: JubelioPushDefaultsInput): Promise<JubelioPushDefaults>;
```

Both gated by `SETTINGS_SECURITY_MANAGE` (same permission as Jubelio token refresh).

### 7.2 UI: inline section on existing `/backoffice/settings/JubelioMappingIntegration` page (or sibling page if it grows too long)

- Form rows for each field, grouped:
  - **Tax**: sellTaxId, buyTaxId
  - **Accounts**: salesAcctId, cogsAcctId, invtAcctId, purchAcctId
  - **Brand**: brandId, brandName
  - **UOM**: uomId, sellUnit, buyUnit
  - **Flags**: sellThis, buyThis, stockThis, dropshipThis, isActive, useSingleImageSet, useSerialNumber
  - **Package**: packageWeight (g)
  - **Other**: rop, storePriorityQtyTreshold, buyPrice

- "Reset to schema defaults" button.
- "Last edited by X at Y" footer.

### 7.3 Migration

Single migration:
1. Create table `JubelioPushDefaults`.
2. Insert one row with the spec-documented defaults.

## 8. Boundary respect (data ownership)

- `Item` (dual-owner): web continues to own via `createItem`/`updateItem`. No change.
- `JubelioOutbox`: web-writable (sub-2 established). No change.
- `JubelioProductMapping`: api-owned (catalog ingest already writes). Sub-3 handler also writes from api — no boundary violation.
- `JubelioPushDefaults` (new): web-only writes (admin UI). Handler reads only. Clean.

## 9. Error handling + idempotency

- Each Jubelio call in the handler is awaited; first failure throws → BullMQ retries the whole row with exponential backoff → DEAD after `JOB_ATTEMPTS` retries → `AdminNotification` raised.
- **Idempotency**: re-running on a row that already pushed produces a POST with identical body (item_group_id matches, item_ids match) → Jubelio updates with no-op semantics → marketplace listing unchanged. DELETE call is only made when local variants were removed; second run produces empty removal list.
- **Partial failure during reconcile**: `reconcileMappings` is the critical write step. If POST succeeds but mapping upsert fails, the row stays in PROCESSING → retry → second POST returns same `item_ids[]` (Jubelio item_group_id stable) → mappings upsert succeeds.
- **Concurrent edits**: two rows queued for the same Item. Handler reads CURRENT state both times. Second is effectively a no-op (same body). BullMQ `jobId = rowId` keeps duplicates from coalescing across queue rounds.

## 10. Testing

### Handler unit tests
Fake prisma + http. Cover:
- Create variantless (mappings empty, source=ERP, single variant body, no DELETE).
- Create with N variants (mappings empty, source=ERP, N entries in product_skus, no DELETE).
- Source guard (mappings empty, source=JUBELIO_INGEST) → SKIP `cannot_create_from_ingested`.
- Category unmapped → SKIP `category_unmapped`.
- Defaults missing → SKIP `defaults_missing`.
- Edit fields (mappings exist, fields differ, variants identical) → POST with item_group_id=N, no DELETE.
- Add variant (mappings has SKU-A, Item.variants has A+B) → POST with item_ids [N, 0], no DELETE.
- Remove variant (mappings has A+B, Item.variants has A only) → POST with item_id [N] + DELETE [B's jubelio_item_id].
- Add-and-remove together → POST with new+kept entries + DELETE for dropped.
- Idempotent re-run (mappings already reflect Item state) → POST with all existing item_ids, no DELETE.
- Wrong type → SKIP `wrong_type`.

### Payload builder unit tests
Pure function. Snapshot test the body for each variant scenario.

### apps/web tests
- `hasPushableChange` returns true/false correctly for each pushable field flip.
- `enqueueProductPushOnUpdate` skips when no pushable change.
- Settings server actions gate on permission.

### Integration smoke (manual, in Task 12 of plan)
- Create item in UI → outbox row appears → status DONE within ~1s → JubelioProductMapping rows populated.
- Edit sellingPrice → second outbox row → DONE → Jubelio listing reflects new price.
- Add variant → outbox row → mapping has new row.
- Remove variant → outbox row → DELETE called, mapping row dropped.

## 11. Open implementation questions (resolve in plan stage)

1. **`variation_values` schema**: OpenAPI shows `type: object` (no properties). Need real example from Jubelio docs or test request. May require reading ingest types more carefully or a 30-min spike call to Jubelio.
2. **`updateItemLib` pre/post snapshot ergonomics**: refetch-before vs return-pre-and-post from the mutation. Plan picks one.
3. **Settings UI placement**: inline on existing page vs new sibling. Lean inline; if section gets unwieldy, plan can punt to a child route.
4. **Per-variant `sell_price`**: omit (use top-level) vs explicit. Plan checks if Jubelio rejects omission; if so, send same value per variant.
5. **Concurrency on JubelioProductMapping writes during reconcile**: wrap mapping reconcile + DELETE in a Prisma `$transaction` for atomicity? Marginal value; plan decides.
6. **Source restriction precision**: should an ingested item that's been edited locally and has its mapping deleted somehow still be pushable? Spec says no (treat as orphan, would need re-ingest). Plan documents this in the admin notes.
7. **Jubelio behavior on no-op POSTs**: assumption is that re-POSTing identical data is a true no-op (no change-history entry, no return webhook). If Jubelio actually fires inventory-update webhooks back on every POST, we get an inbound webhook on every push — harmless (handler is idempotent) but noisy. Plan stage: confirm during impl spike or accept the noise.

## 12. Test rollback path

Before ANY end-to-end push test against the production Jubelio account, a rollback mechanism must be in place. Two acceptable options — plan picks one:

### Option A (preferred): small admin action

Add a "Test cleanup" subsection on the Jubelio settings page, gated by `SETTINGS_SECURITY_MANAGE`:
- Single-row table of recent `JubelioProductMapping` entries (filterable by `lastSyncedAt`).
- Per-row "Delete from Jubelio" button → calls api → `DELETE /inventory/items/` with the row's `jubelioItemGroupId` → drops mapping rows on success.
- Confirm dialog ("This deletes the product from the live Jubelio account. Type 'delete' to confirm.").

Implementation cost: ~30 minutes. Removes friction during sub-3 smoke testing and any future test pushes.

### Option B (zero-code): manual deletion

Document in the plan's Task 12 (smoke):
- Before pushing, note the SKU you're testing with.
- After push, visit Jubelio admin UI → Inventory → Items → find by `item_code` → delete.
- Drop the local mapping row via:
  ```sql
  DELETE FROM JubelioProductMapping WHERE itemId = '<itemId>';
  ```
- Verify the listing is gone from marketplace storefronts (Shopee/Tokopedia/etc) since Jubelio cascades.

Risk if Option B is chosen: if a test push creates listings on multiple marketplaces and a delete is missed on one, that listing stays orphaned. **Required for Option B: pre-test acknowledgement that all test products carry a recognizable test prefix (e.g., SKU starts with `TEST-`) so cleanup is auditable.**

**Decision: Option A.** The admin action becomes the FIRST functional task in the plan, landing before any handler work that could create real Jubelio listings.

## 13. Decisions log

- **Trigger model**: auto on Item create/update (no manual button).
- **Pricing model**: manual `sellingPrice` on Item, pushed as-is. No HPP recalc.
- **Update scope**: create only for ERP-source, updates for both sources where mapping exists.
- **Variant lifecycle**: full (create + add + remove). Rename = remove + add.
- **Approach**: single `product_push` entityType, idempotent diff handler. Not split.
- **Defaults strategy**: settings table + admin UI.
- **Slicing**: single sub-3, atomic ship.
- **Bulk push**: not in scope; deferred to sub-5 (migration tool).
- **Test rollback**: Option A (admin "Delete from Jubelio" action on settings page), gated by `SETTINGS_SECURITY_MANAGE`, lands as first functional task.
