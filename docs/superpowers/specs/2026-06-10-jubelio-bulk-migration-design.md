# Jubelio Bulk Migration — Design Spec

**Date:** 2026-06-10
**Scope:** EPIC-02-05 — one-time admin tool to push existing Elorae `FINISHED_GOOD` catalog to Jubelio in bulk.
**Sub-project:** sub-5
**Status:** draft, awaiting approval

## 1. Goal

Add a `/backoffice/jubelio/migration` admin page that lists ERP-source FINISHED_GOOD items without a Jubelio mapping, lets admin pick which to push, and bulk-enqueues `product_push` outbox rows. Sub-3's `ProductPushHandler` does the per-item work. Sub-2's outbox dashboard shows progress.

Closes EPIC-02-05 (Initial Data Migration) — the last story in EPIC-02.

## 2. Scope

### In scope
- New child route `/backoffice/jubelio/migration` under the Jubelio nav group (sub-3.5 hoisted).
- Server actions: `getEligibleItems()`, `enqueueBulkMigration(itemIds[])`, `getMigrationSummary()`.
- Client UI: preview table with checkboxes, "select all", confirm dialog, "Migrate N selected" button, summary card showing recent (24h) run outcomes.
- vitest tests for the server actions (apps/web now has vitest per recent master).
- Nav + RBAC route + i18n strings.

### Out of scope
- Re-push of already-mapped items (use sub-3's per-item auto-push trigger).
- Bulk delete / rollback (rely on sub-3's per-item Test cleanup card).
- Dry-run mode.
- Direct-enqueue for bulk (poller's 5s tick suffices).
- Excel/CSV import.
- Cron/scheduled migration.
- Per-run isolation tracking (no `bulkRunId` column — uses `enqueuedById + 24h` window).
- New api endpoints — all writes through Prisma directly from web.

## 3. Architecture

```
┌─────────── apps/web ──────────────────────────────┐
│ /backoffice/jubelio/migration (NEW child route)   │
│   ├─ page.tsx (server) → getEligibleItems() +     │
│   │                       getMigrationSummary()   │
│   └─ MigrationClient.tsx                          │
│       ├─ Table: SKU + name + category + variants  │
│       ├─ Checkboxes per row + "Select all"        │
│       ├─ "Migrate N selected" button + confirm    │
│       └─ Summary card (last 24h: DONE/DEAD/SKIPPED)│
└────────────────────────────────────────────────────┘
              │ Prisma directly (read + outbox write)
              ▼
┌─────────── Existing infra (no new server-side code) ┐
│ JubelioOutbox.createMany {entityType: "product_push"}│
│ Outbox poller (5s tick) → BullMQ → ProductPushHandler│
│ (sub-3 handler — unchanged)                          │
└──────────────────────────────────────────────────────┘
```

**Zero new api code.** Entire feature lives in apps/web. Sub-3's `ProductPushHandler` does the actual Jubelio push. Sub-2's outbox dashboard is the live progress viewer.

## 4. Data model

No new tables. No migration. Uses existing `JubelioOutbox`:
- `entityType: "product_push"` (already in sub-3)
- `entityId`: Item.id
- `enqueuedById`: admin who triggered (used to scope the summary)
- `createdAt`: used for "recent run" 24h window
- `status`: PENDING → PROCESSING → DONE / SKIPPED / DEAD (sub-2 lifecycle)

Summary query shape:
```ts
prisma.jubelioOutbox.groupBy({
  by: ['status'],
  where: {
    entityType: 'product_push',
    enqueuedById: session.user.id,
    createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  },
  _count: { _all: true },
});
```

Returns counts like `{ DONE: 24, DEAD: 1, SKIPPED: 2, PENDING: 3 }` for the admin's last 24h of bulk activity.

## 5. apps/web components

### 5.1 Server actions (`apps/web/app/actions/jubelio-bulk-migration.ts`)

```ts
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

export async function getEligibleItems(): Promise<EligibleItem[]>;
export async function enqueueBulkMigration(itemIds: string[]): Promise<{ enqueued: number }>;
export async function getMigrationSummary(): Promise<MigrationSummary>;
```

- `getEligibleItems()` — Prisma query for `FINISHED_GOOD` + `source: ERP` + `jubelioProductMappings: { none: {} }`. Includes `category.name` and computes `variantCount` from the JSON `variants` field. Computes `hasJubelioCategoryMapping` by joining against `JubelioCategoryMapping` (per-item flag for the table's "ready?" indicator).
- `enqueueBulkMigration(itemIds)` — `SETTINGS_SECURITY_MANAGE` permission. Validates input (non-empty, all ids belong to eligible items). Creates `JubelioOutbox` rows in a single `createMany`. Returns count.
- `getMigrationSummary()` — `SETTINGS_SECURITY_VIEW`. `groupBy` on outbox rows for the admin's last 24h, returns counts.

### 5.2 Page (`apps/web/app/backoffice/jubelio/migration/page.tsx`)

Server component:

```tsx
import { getEligibleItems, getMigrationSummary } from "@/app/actions/jubelio-bulk-migration";
import { MigrationClient } from "./MigrationClient";

export default async function MigrationPage() {
  const [items, summary] = await Promise.all([getEligibleItems(), getMigrationSummary()]);
  return <MigrationClient initialItems={items} initialSummary={summary} />;
}
```

### 5.3 Client component (`apps/web/app/backoffice/jubelio/migration/MigrationClient.tsx`)

State:
- `items: EligibleItem[]`
- `selected: Set<string>`
- `summary: MigrationSummary`
- `isEnqueueing: boolean`

UI:
- Header: title + summary card.
- Table:
  - Header: checkbox (select all toggles) + SKU + Name + Category + Variants + Status badge.
  - Status badge: green "Ready" if `hasJubelioCategoryMapping`, amber "Category unmapped — will SKIP" otherwise.
  - Row checkbox.
- Footer: "N selected" count + "Migrate selected" button (destructive variant, disabled when 0 selected or `isEnqueueing`).
- Confirm dialog: "Push N items to Jubelio? This creates real listings on production. Items with unmapped categories will SKIP — check `/backoffice/jubelio/categories` first."

Click confirm → call `enqueueBulkMigration(Array.from(selected))` → toast "Queued N items. Worker drains over ~5 min." + link to outbox dashboard. Selected set cleared. Summary refetched.

### 5.4 Nav

`apps/web/app/backoffice/BackofficeShell.tsx`: add child to Jubelio nav group (sub-3.5):
```ts
{ labelKey: "navJubelioMigration", href: "/backoffice/jubelio/migration" }
```

Placement: between "Admin" and "Settings" (or after Categories — visual order tbd).

### 5.5 RBAC

`apps/web/lib/rbac.ts`:
- `ROUTE_PERMISSIONS["/backoffice/jubelio/migration"] = "settings_security:view"`
- Add to `BACKOFFICE_ROUTES_ORDER` near other Jubelio routes.

### 5.6 i18n

`apps/web/lib/i18n/messages/{en,id}.json`:
- `navJubelioMigration`: "Migration" / "Migrasi"
- Page strings (title, table headers, button labels, confirm copy).

## 6. Data flow

1. Page load (server) → `getEligibleItems()` + `getMigrationSummary()` in parallel.
2. Client renders table. Admin reviews — rows with amber status (unmapped category) show a warning.
3. Admin checks rows (or "Select all") → "Migrate N selected" enables.
4. Click → confirm dialog with N count and risk copy.
5. Confirm → `enqueueBulkMigration(itemIds)` → `createMany` outbox rows → toast.
6. Summary card refetches via revalidatePath. Background: outbox poller picks up rows on next 5s tick, processes them via sub-3 handler.
7. Admin can click toast link → outbox dashboard `/backoffice/jubelio/admin` for live row-level view.
8. Items disappear from the eligible list once their mapping is created (sub-3 handler writes mapping on success).

## 7. Boundary respect

- `JubelioOutbox`: web-writable per sub-2 boundary (web already writes this for per-item push).
- `JubelioProductMapping`: api-owned. Web reads only (existing pattern).
- `Item`, `ItemCategory`, `JubelioCategoryMapping`: web reads via Prisma.

No new boundary work.

## 8. Error handling + idempotency

- **Per-item processing errors**: sub-3 `ProductPushHandler` handles. Jubelio API failures → BullMQ retry with backoff → DEAD after `JOB_ATTEMPTS` (sub-2 setting). DEAD rows surface in outbox dashboard + summary card's `dead` count.
- **Bulk enqueue failures**: `createMany` is a single transaction. If it throws (e.g. constraint violation), no rows created; admin sees error toast and retries.
- **Idempotency at re-run**: `getEligibleItems()` filters out items that already have a mapping. Once sub-3 handler creates mapping for an item, that item drops off the list on next page load. Re-clicking "Migrate selected" with stale state would re-enqueue, but sub-3 handler is itself idempotent (re-running on an Item with mapping just does an update push to Jubelio — no harm).
- **Concurrent admin sessions**: harmless. Each session sees current state. If two admins migrate overlapping selections, outbox gets two rows for the same item; sub-3 handler dedupes via its own state.
- **Category unmapped at run time**: sub-3 handler SKIPs with reason `category_unmapped`. Surfaces as `skipped` in summary. Admin fixes mapping via `/backoffice/jubelio/categories` and re-migrates (item reappears in eligible list).

## 9. Prod-test-rollback (per `feedback_prod_test_rollback`)

Bulk push to production Jubelio is high-blast-radius. Mitigations in this PR:

- **Strong confirm dialog**: shows item count + warning "This creates real listings on production".
- **Status badge for unmapped categories** in the eligible table — admin can spot risky rows before checking them.
- **Documented rollback path**: README of the migration page + this spec direct admin to `/backoffice/jubelio/settings` → "Test cleanup" card for per-item delete.
- **NO bulk delete in this PR**. Bulk rollback is out of scope (would be sub-5.5 if needed). For migrations <50 items, manual one-at-a-time cleanup is acceptable.

If a future PR needs bulk delete, sub-3's existing `JubelioCatalogDeleteService.deleteByGroupId` is the building block — wrap in a similar bulk-select UI.

## 10. Testing

### apps/web vitest (new since master)
`apps/web/app/actions/jubelio-bulk-migration.spec.ts`:
- `getEligibleItems` permission gate (unauthed throws).
- `getEligibleItems` returns only ERP-source FG items without mapping.
- `enqueueBulkMigration` permission gate (`SETTINGS_SECURITY_MANAGE`).
- `enqueueBulkMigration` rejects empty array.
- `enqueueBulkMigration` rejects ids that aren't in the eligible set (defense against stale UI).
- `enqueueBulkMigration` creates correct outbox rows (entityType + entityId + enqueuedById).
- `getMigrationSummary` aggregates correctly by status.

### apps/api
No new tests. Sub-3 `ProductPushHandler` is unchanged.

### Manual smoke
- Smoke uses real Jubelio account → needs client greenlight (same as sub-4).
- Steps:
  1. Open `/backoffice/jubelio/migration`. Table shows current 3 ERP unmapped items (TEST-PUSH-* if remnants from sub-3 smoke).
  2. Select 1 item. Migrate selected. Confirm.
  3. Verify outbox row created with `entityType=product_push`.
  4. Wait ~5s. Outbox dashboard shows row in PROCESSING → DONE.
  5. Verify Jubelio admin: new product appeared.
  6. Refresh migration page. Item disappeared from eligible list (now mapped).
  7. Summary card shows `done: 1`.
  8. Cleanup: use sub-3 Test cleanup card to remove the test product.

## 11. Open implementation questions (settle in plan stage)

1. Confirm dialog component: shadcn `AlertDialog` vs inline `confirm()`. Lean shadcn.
2. Summary card placement: top of page (above table) vs sidebar. Lean top.
3. Pagination on eligible table: for now show all (≤100 expected). If catalog grows past that, add pagination — flag for follow-up.
4. Should the migration page also expose a "force re-push for selected mapped items" mode? **No** — separate UI concern; auto-push from Item.update handles re-pushes. Sub-5 is migration-only.
5. Loading skeleton vs empty state: empty state ("No items to migrate — all ERP catalog already mapped") covered; loading state via Next.js suspense or local isLoading flag — plan picks.

## 12. Decisions log

- **Filter UX**: preview table + checkboxes. ERP-source FG, unmapped only.
- **Re-runnability**: unmapped-only filter handles it. Mapped items use sub-3 per-item auto-push.
- **Progress**: reuse outbox dashboard + summary card on the migration page (24h window scoped by admin).
- **Validation report**: post-enqueue summary card (DONE/PENDING/PROCESSING/DEAD/SKIPPED counts).
- **Run identifier**: `enqueuedById + 24h` (no schema change).
- **Direct-enqueue**: skipped for bulk. Poller drains. Per-item still uses it (sub-2.5 fast path).
- **Rollback**: existing per-item Test cleanup card (sub-3). Bulk delete deferred to sub-5.5 if needed.
- **No new api code**: web writes outbox directly. Sub-3 handler reused.
- **No schema changes**: `JubelioOutbox` already supports the use case.
