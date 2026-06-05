# Jubelio Category Sync — Design Spec

**Date:** 2026-06-05
**Scope:** Manual admin UI to map Elorae `ItemCategory` rows to Jubelio category ids (`JubelioCategoryMapping`).
**Type:** Infrastructure / pre-requisite for product push at scale. Not tied to an EPIC story directly, but unblocks EPIC-02-01 (product push handler currently SKIPs `category_unmapped`).
**Status:** draft, awaiting approval

## 1. Goal

Replace the current "seed JubelioCategoryMapping rows manually via tsx script" workflow with a one-page admin UI. Admin clicks "Refresh categories" → sees the full Jubelio category tree as a flat list with breadcrumb paths → assigns each Elorae `ItemCategory` to a Jubelio category via searchable dropdowns → saves all mappings in one click.

## 2. Scope

### In scope
- New api endpoints: `GET /jubelio/categories/list` (pulls all pages from Jubelio + computes breadcrumb paths), `POST /jubelio/categories/mappings` (batch upsert).
- New api service: `JubelioCategoriesService` with `fetchAll()` + `saveMappings()`.
- New web route: `/backoffice/settings/jubelio/categories` (child page).
- Web server actions: `getJubelioCategoryMappings()`, `fetchJubelioCategoryList()`, `saveJubelioCategoryMappings()`.
- Searchable combobox per Elorae `ItemCategory` row.
- Bulk save (one button at bottom commits all dirty mappings).
- Tests: api service unit tests for pagination + path computation + upsert.

### Out of scope
- **Auto-match by name** — even fuzzy. Admin picks manually.
- **Pushing Elorae categories TO Jubelio** — Jubelio's create-category endpoint not called.
- **DB cache of Jubelio category list** — in-memory per page session only. Admin re-clicks Refresh to update.
- **Hierarchy editing** — admin only picks existing Jubelio categories; never creates/edits Jubelio tree.
- **Bulk CSV/Excel import** of mappings.
- **Auto-refresh** on page mount — explicit button only (Jubelio API rate considerations).

## 3. Architecture

```
┌─────────── apps/web ───────────────────────────────┐
│ /backoffice/settings/jubelio/categories (NEW route)│
│   ├─ page.tsx (server) → loads existing mappings   │
│   └─ CategoryMappingsClient.tsx                    │
│       ├─ Refresh button → fetchJubelioCategoryList │
│       ├─ Combobox per ERP category                 │
│       └─ Save button → saveJubelioCategoryMappings │
└────────────────────────────────────────────────────┘
              │ signed HMAC (sub-2.5)
              ▼
┌─────────── apps/api ───────────────────────────────┐
│ JubelioCategoriesModule                            │
│   ├─ JubelioCategoriesService                      │
│   │   ├─ fetchAll(): paginate + compute paths      │
│   │   └─ saveMappings(rows[]): batch upsert        │
│   └─ JubelioCategoriesController                   │
│       ├─ GET /jubelio/categories/list              │
│       └─ POST /jubelio/categories/mappings         │
└────────────────────────────────────────────────────┘
```

apps/api owns `JubelioCategoryMapping` writes (mirrors sub-3 catalog-delete pattern; api side handles all Jubelio-aware persistence).

## 4. Data model

One small schema addition. Existing `JubelioCategoryMapping`:

```prisma
model JubelioCategoryMapping {
  id                String       @id @default(cuid())
  jubelioCategoryId Int          @unique
  itemCategoryId    String
  itemCategory      ItemCategory @relation(...)
  createdAt         DateTime     @default(now())
  @@index([itemCategoryId])
}
```

`jubelioCategoryId @unique` means two ERP categories cannot map to the same Jubelio id — the constraint must be surfaced to the admin as a save-time error.

`itemCategoryId` is not unique on its own — but the UX treats it as effectively one-mapping-per-ERP-category. Upsert keys on `itemCategoryId` (assumes one row per ERP category). To enforce one-mapping-per-ERP-category in DB:

```prisma
@@unique([itemCategoryId])
```

This is a small schema addition + migration. Otherwise upsert logic must dedupe manually. **Decision: add the `@@unique([itemCategoryId])` constraint** — single source of truth at the DB level.

## 5. apps/api components

### 5.1 `JubelioCategoriesService` (`apps/api/src/jubelio/categories/categories.service.ts`)

```ts
type JubelioCategoryRaw = {
  category_id: number;
  category_name: string;
  parent_id: number | null;
  last_modified: string;
  has_children: boolean;
};

type JubelioCategoryFlat = {
  id: number;
  name: string;
  path: string;        // "Pakaian > Pria > Kaos"
  isLeaf: boolean;
};

@Injectable()
export class JubelioCategoriesService {
  async fetchAll(): Promise<JubelioCategoryFlat[]> {
    // Loop pages 1..N until response length < pageSize (100).
    // Build Map<id, JubelioCategoryRaw>.
    // For each row: compute path by walking parent_id chain.
    // Orphan parent → path = name only (logged warning).
    // Return flat array sorted by path.
  }

  async saveMappings(input: Array<{ itemCategoryId: string; jubelioCategoryId: number }>): Promise<{ saved: number }> {
    // Validate Jubelio ids are unique within input (no two ERP cats to same Jubelio).
    // For each row: upsert by itemCategoryId.
    // Single $transaction for atomicity.
    // Translate P2002 (jubelio unique violation) into a typed error with the offending pair.
  }
}
```

### 5.2 `JubelioCategoriesController` (`apps/api/src/jubelio/categories/categories.controller.ts`)

```ts
@ApiTags("jubelio-categories")
@Controller("jubelio/categories")
export class JubelioCategoriesController {
  constructor(private readonly svc: JubelioCategoriesService) {}

  @Post("list")  // POST (not GET) — sub-2.5 sign body shape is consistent for both
  @HttpCode(200)
  list(): Promise<JubelioCategoryFlat[]> {
    return this.svc.fetchAll();
  }

  @Post("mappings")
  @HttpCode(200)
  saveMappings(@Body() body: { mappings: Array<{ itemCategoryId: string; jubelioCategoryId: number }> }): Promise<{ saved: number }> {
    return this.svc.saveMappings(body.mappings);
  }
}
```

(Sub-2.5 signed channel `apiFetch` signs over `(method, path, userId, body)`. POST is the simpler default; GET would mean empty body in signature which works but inconsistent. Using POST for both list + save.)

### 5.3 `JubelioCategoriesModule` (`apps/api/src/jubelio/categories/categories.module.ts`)

Standard NestJS module wiring. Imported from `app.module.ts`.

## 6. apps/web components

### 6.1 Server actions (`apps/web/app/actions/jubelio-categories.ts`)

```ts
export type CategoryMappingRow = {
  erpCategoryId: string;
  erpName: string;
  erpCode: string | null;
  jubelioId: number | null;
  jubelioName: string | null;
  jubelioPath: string | null;
};

export async function getJubelioCategoryMappings(): Promise<CategoryMappingRow[]>;
export async function fetchJubelioCategoryList(): Promise<JubelioCategoryFlat[]>;
export async function saveJubelioCategoryMappings(
  rows: Array<{ itemCategoryId: string; jubelioCategoryId: number }>,
): Promise<{ saved: number }>;
```

- `getJubelioCategoryMappings()` reads directly via Prisma (LEFT JOIN ItemCategory ↔ JubelioCategoryMapping). `SETTINGS_SECURITY_VIEW` permission.
- `fetchJubelioCategoryList()` → `apiFetch("POST", "/jubelio/categories/list")`. `SETTINGS_SECURITY_VIEW`.
- `saveJubelioCategoryMappings()` → `apiFetch("POST", "/jubelio/categories/mappings", { body: { mappings } })`. `SETTINGS_SECURITY_MANAGE`.

### 6.2 Page (`apps/web/app/backoffice/settings/jubelio/categories/page.tsx`)

Server component. Calls `getJubelioCategoryMappings()`, passes rows to client.

### 6.3 Client (`apps/web/app/backoffice/settings/jubelio/categories/CategoryMappingsClient.tsx`)

State: `rows: CategoryMappingRow[]` (server-loaded), `draft: Record<erpCategoryId, jubelioId|null>` (local edits), `jubelioList: JubelioCategoryFlat[]` (in-memory cache, empty until Refresh), `isRefreshing`, `isSaving`.

UI:
- Top bar: "Refresh categories" button (loads Jubelio list).
- Table:
  - Column 1: ERP category (code + name)
  - Column 2: Searchable combobox (filtered by `jubelioList`; placeholder "Click Refresh first" when list empty)
  - Column 3: Current Jubelio path (read-only, derived from selected id)
- Footer: "Save mappings" button (disabled if no draft changes).

Combobox uses existing `apps/web/components/ui/searchable-combobox.tsx` (confirmed present in earlier audit).

### 6.4 Nav

Add to `BackofficeShell.tsx` nav under Settings → Jubelio:
- Old: `{ labelKey: "navSettingsJubelio", href: "/backoffice/settings/jubelio" }`
- New: nested children
  - `{ labelKey: "navSettingsJubelio", href: "/backoffice/settings/jubelio" }` (existing token + push defaults + cleanup)
  - `{ labelKey: "navSettingsJubelioCategories", href: "/backoffice/settings/jubelio/categories" }`

(Or single entry pointing to parent + a tab inside the parent page that links out. Plan stage picks.)

### 6.5 RBAC

Reuses `SETTINGS_SECURITY_VIEW` / `SETTINGS_SECURITY_MANAGE`. Route added to `ROUTE_PERMISSIONS`:
```ts
"/backoffice/settings/jubelio/categories": "settings_security:view"
```

## 7. Data flow

1. Server-component page mounts → `getJubelioCategoryMappings()` returns 3 ERP rows (current state: T-SHIRT, PANTS, FABRIC; one already mapped to Jubelio 7278).
2. Client component renders table with current selections.
3. Admin clicks "Refresh categories":
   - `fetchJubelioCategoryList()` → api → Jubelio API (10–15 page calls) → ~1000+ flat rows with paths.
   - Stored in component state.
4. Each row's combobox is now searchable. Admin types "kaos" → filtered to a handful of matches.
5. Admin picks the mappings. Draft state tracks dirty rows.
6. Admin clicks "Save mappings":
   - Web action collects dirty rows → `saveJubelioCategoryMappings(...)`.
   - api upserts in one transaction.
   - On success: server action re-runs `getJubelioCategoryMappings()` → returns fresh state → client clears draft.
   - On unique-violation (P2002 on `jubelioCategoryId`): error toast with offending pair.

## 8. Boundary respect

- `JubelioCategoryMapping`: api-owned for writes (controller / service). Web reads directly via Prisma for the read-only get action — same pattern as `getJubelioPushDefaults()` from sub-3 (web reads a simple table directly).
- `ItemCategory`: web-owned (existing). No change.
- Jubelio API calls: go through `JubelioHttpService` (auth + retry + log via `JubelioApiCall` table). No direct fetch.

## 9. Error handling + idempotency

- Save is idempotent: upsert by `itemCategoryId`. Re-saving the same draft is a no-op (rows unchanged).
- Refresh is idempotent: re-fetches all categories. No side effects on Elorae.
- Token expiry during fetch → `JubelioHttpService` auto-refreshes (sub-1).
- 429 rate limit → `JubelioHttpService` auto-retries with backoff (sub-1).
- Concurrent admin saves: last write wins (Prisma upsert atomic). UI shows the latest state on next refresh.
- Service must guard against orphan parents in path computation: if `parent_id` references a category not in the fetched set (pagination gap, deleted parent), path falls back to category name only. Log warning.

## 10. Testing

### apps/api (vitest pattern matching sub-3)

`categories.service.spec.ts`:
- **fetchAll pagination**: mock http with 3 pages × 100 + final 47. Expect 347 categories. Assert page 4 not requested.
- **fetchAll path computation**: input flat list with parent_id chains (3 levels). Expect "Root > Mid > Leaf" path string. Root has parent_id=null → path = name.
- **fetchAll orphan handling**: child references missing parent_id → path = name only + warning logged.
- **fetchAll http error**: propagates (no swallowing).
- **saveMappings happy path**: 3 rows in, 3 upserts called.
- **saveMappings duplicate input rejection**: two rows with same `jubelioCategoryId` → throws before upsert.
- **saveMappings P2002 → typed error**: prisma upsert throws P2002 with constraint `jubelio_category_id` → service throws `CategoryMappingConflictError` with the conflicting pair.

### apps/web (vitest — now available per recent master)

`jubelio-categories.spec.ts` (server action layer):
- Permission gate: unauthed call throws.
- Permission gate: `SETTINGS_SECURITY_VIEW` insufficient for save.

### Manual smoke (per `feedback_prod_test_rollback`)

No prod write risk (writes are local Elorae table only; Jubelio is read-only). Smoke steps:
1. Open `/backoffice/settings/jubelio/categories` → see 3 ERP rows. T-SHIRT pre-mapped from earlier seed.
2. Refresh → list loads, ~1000 rows. Toast confirms count.
3. Map PANTS → search "celana bahan" → pick → row marked dirty.
4. Save → toast "1 mapping saved". Refresh page → PANTS shows mapping.
5. Try mapping FABRIC → search "kain" → pick → save. Should succeed.
6. Try mapping a second ERP to T-SHIRT's existing Jubelio id 7278 → save → error toast about unique violation. Row stays in dirty state.

## 11. Open implementation questions (resolve in plan stage)

1. **Combobox API**: confirm `searchable-combobox.tsx` accepts an `options: Array<{value, label, secondaryLabel}>` shape. If not, extend.
2. **Path separator**: `>` (single char + visual). Locking to `>`.
3. **Service rate-limit safety**: 10–15 sequential requests inside `fetchAll()`. Jubelio's 429 retry is per-call. If Jubelio enforces a global rate limit, we may need to space requests. Plan adds a 100ms delay between pages as a safety; remove if Jubelio doesn't throttle.
4. **Empty state**: ERP has 0 categories → UI shows "Create an ItemCategory first" message + link to item-categories page.
5. **Nav placement** (sub-tab on settings page vs separate nav entry): default to separate nav entry for child route discoverability. Plan can flip.
6. **i18n**: add nav label + page strings to `lib/i18n/messages/{en,id}.json`.
7. **Schema constraint**: confirm during plan whether `@@unique([itemCategoryId])` is safe to add. Existing data: only 1 mapping row, no risk.

## 12. Decisions log

- **Direction**: Pull from Jubelio. No reverse push.
- **Mapping creation**: Manual admin via dropdown UI. No auto-match.
- **Pull mechanism**: Button-driven, in-memory only (no DB cache).
- **Display**: Flat list with `Parent > Child > Leaf` breadcrumb path.
- **Placement**: New child route `/backoffice/settings/jubelio/categories`.
- **Save model**: Bulk save — one button commits all dirty rows.
- **Storage owner**: apps/api (write path). apps/web reads directly via Prisma (consistent with sub-3 push-defaults pattern).
- **Schema**: add `@@unique([itemCategoryId])` to `JubelioCategoryMapping` to enforce one-mapping-per-ERP-category at the DB level.
- **No prod test risk**: writes are local; Jubelio is read-only. No rollback tooling required (vs sub-3 which writes to Jubelio).
