# VIRA MCP adapter (phase 1 reads + phase 2 write confirms)

Epics #496 (reads) and #538 (writes). Code: `apps/web/lib/vira/**`, `apps/web/app/api/vira/token/route.ts`, `apps/web/app/api/vira/mcp/route.ts`, `apps/web/app/api/vira/confirm/route.ts`.

## 1. What it is

An MCP (Model Context Protocol) endpoint inside `apps/web` that lets VIRA, OKEJOB's own AI agent runtime (a separate repo), answer back-office questions and prepare back-office changes for an Elorae user. Phase 1 shipped **read** tools (one `whoami` and 16 other reads, marked `readOnlyHint`). Phase 2 adds **write** tools that only prepare a confirmation; nothing is applied until the user presses a button and the VIRA runtime calls `POST /api/vira/confirm`. Every call runs **as the logged-in Elorae user** who asked: the tool sees and changes only what that user's permission codes already allow in the back office, through the same `lib/` query and writer functions the pages and actions use. Tools never call server actions.

## 2. Auth flow

```
Elorae page (logged-in user)
  └─ widget → POST /api/vira/token        (NextAuth session + vira:use) → short-lived JWT (10 min)
        └─ VIRA runtime → POST /api/vira/mcp
               headers: X-Vira-Service-Key, Authorization: Bearer <JWT>
               1. reject if Origin header present (server-to-server only)
               2. check service key
               3. verify JWT (HS256, iss=elorae, aud=vira-mcp, exp, pwf)
               4. load user + permissions fresh from DB (isiSesiDari)
               5. require vira:use
               6. register only the tools this user may use → tools/list is filtered
               7. each tool re-checks its gate, then calls the existing lib/ query
```

- **`POST /api/vira/token`** stays behind the NextAuth session in `proxy.ts`. It needs a session (401), a same-origin `Origin` header (403 `bad_origin`) and `vira:use` (403 `forbidden`). It is rate-limited to 10 per minute per user (429 with `Retry-After`). It returns `{ token, expiresAt }`; the token is never logged.
- **`POST /api/vira/mcp`** and **`POST /api/vira/confirm`** are the VIRA paths on the `proxy.ts` allow-list. MCP is stateless: a new MCP server and transport per POST, with JSON responses. It is rate-limited to 60 per minute per user. GET and DELETE return 405. Confirm is rate-limited to 20 per minute per user.
- **Token TTL is 10 minutes** (600 s, 30 s clock skew). Claims: `sub` (user id), `iss` `elorae`, `aud` `vira-mcp`, `iat`, `exp`, `jti`, `pwf`.
- **Permissions are loaded fresh from the DB on every MCP call**, never from the token. A permission removed from a user's role applies on the next call.
- **A password change kills every outstanding token.** `pwf` is a SHA-256 fingerprint of the password hash; when it no longer matches, the call gets 401. Otherwise a token cannot be revoked within its 10 minutes, except by deleting the user. Elorae has no user deactivation yet (`User` has no `isActive` column), so there is nothing to deactivate; removing `vira:use` from the user's role does take effect on the next call (403), because permissions are reloaded per call.
- **`vira:use` is required on both routes.** It is added by the seed `packages/db/prisma/seed-vira-2026-11-16-permissions.sql` and granted to **no role by default**; the owner grants it in Settings → Roles & permissions. System (`"*"`) roles have it automatically.
- The **actor always comes from the verified token**, never from tool input.

MCP route responses, in check order: Origin present → 403 `bad_origin`; bad or missing service key → 401 `bad_service_key`; no Bearer token → 401 `invalid_token` (even when the token secret is unset); token secret unset → 503 `not_configured`; bad signature or expired token → 401 `invalid_token`; unknown user or stale `pwf` → 401 `invalid_token`; no `vira:use` → 403 `forbidden`; over the limit → 429. Every `invalid_token` response carries `WWW-Authenticate: Bearer`.

Tool errors come back as MCP tool errors, not HTTP errors: `FORBIDDEN`, `NOT_FOUND`, `INVALID_INPUT`, or `INTERNAL` (logged with the tool name and error only, never the input values).

## 3. Env vars

Set in `apps/web` (see `apps/web/.env.example`):

| Var | What | If unset |
|---|---|---|
| `VIRA_TOKEN_SECRET` | HS256 signing secret for VIRA tokens. At least 32 characters. Use a different value from `AUTH_SECRET`; this is operator guidance, the code does not check it. | Token route → 503 `not_configured`; MCP route → 503 `not_configured` (after the service-key and Bearer-present checks). |
| `VIRA_SERVICE_KEY` | Shared secret the VIRA runtime sends as `X-Vira-Service-Key`. At least 32 characters. Compared as SHA-256 digests with `timingSafeEqual`. | MCP route → 401 `bad_service_key` on every call (fails closed). |
| `VIRA_APP_URL` | Base URL for the record links tools return, e.g. `https://elorae.cloud`. Trailing `/` is removed. | Links fall back to the request's forwarded host headers. |
| `NEXT_PUBLIC_VIRA_WIDGET_URL` | URL of the embed script (e.g. `https://elorae.cloud/vira/widget/v1/vira.js`). Baked in at build time. | Chat widget stays off. |
| `NEXT_PUBLIC_VIRA_RUNTIME_URL` | Base URL of the VIRA runtime the widget talks to (e.g. `https://elorae.cloud/vira`). Baked in at build time. | Chat widget stays off. |

### Chat widget

`apps/web/components/vira/ViraWidget.tsx` loads on every `/backoffice/*` page (see `app/backoffice/layout.tsx`) for users who hold `vira:use` (system `"*"` roles have it automatically). It is not mounted on `/pwa/*`, `/packer/*`, `/print/*` or login.

Before the script runs, the page sets `window.ViraHost` with `app: "elorae"`, `runtimeUrl`, `locale: "id"`, and `getToken()` which `POST`s `/api/vira/token` with `credentials: "same-origin"` and returns `{ token, expiresAt }`. The browser never receives `VIRA_SERVICE_KEY` or a confirm token — only that short-lived user JWT. The token is not stored in `localStorage` / `sessionStorage`; the widget calls `getToken()` again when it expires.

A secret shorter than 32 characters is treated as unset. Values are trimmed and read on every call (no caching).

Generate each secret separately:

```
openssl rand -base64 48
```

**Production:** set `VIRA_APP_URL` explicitly. `.env.example` marks it optional, and locally the fallback is fine, but MCP calls come server-to-server from the VIRA runtime, so the request's host headers describe that call, not the Elorae site the user should open. Do not set any `VIRA_*` var in production before the owner sign-off (#516).

**Deploy:** the `vira:use` permission row comes from `seed-vira-2026-11-16-permissions.sql`. The deploy's `migrate` job runs each `packages/db/prisma/seed-*.sql` **once**, recorded in `_seed_runs`, so nothing needs to be run by hand on prod. The file is idempotent and links no role. For a database outside the deploy flow, run it with the `mariadb` client as its header says.

## 4. Read tool list (phase 1 + two phase-2 reads)

17 read tools (15 from phase 1 plus `list_leave_requests` and `list_spg_buyer_returns`). "Gate" is what the tool checks; it is the same check the page or action applies (proved by `parity.spec.ts`). Every list tool takes `limit` (default 20, **max 50**) and `offset`, and returns `{ items, total, offset, limit, hasMore }`. Two tools add one key to that shape: `list_receivables` adds `summary`, and `get_store_stock` (paged over its stock rows) adds `store`. Every record carries a `url` into the back office. Write tools are in section 8.

| Tool | Gate | Source (`lib/`) | Notes on what is returned |
|---|---|---|---|
| `whoami` | any valid token | (the actor) | id, name, permission codes. |
| `search_items` | `items:view` | `items/queries` `listItems` | Item search with type filter. |
| `get_item_stock` | `inventory:view` | `items/queries` `getItemById`/`listItems`, `inventory/stock-across-locations` `getStockAcrossLocations`, `inventory/stock-ledger-card` `getItemMovementCard`, `field-sales/queries` `getItemAvailabilityBySku` | Gudang rows from balances, store/van rows from ledger closing balances, each labelled with its `source`; van labels containing `@` are dropped; max 50 rows, with `truncated`. |
| `get_store_stock` | `stores:view` | `inventory/store-stock-card` `getStoreStockCard`, `stores/queries` `getStore` | **KONSI stores only**, as the store page: a PUTUS store is refused with `INVALID_INPUT` ("… is not a consignment (konsi) store, so it has no store stock."). Stock rows and in-transit quantities; no movements. |
| `list_store_stocktakes` | `stores:view` | `stores/stocktake/queries` `listStoreStocktakes` | Net variance quantity only, no variance value. |
| `list_marketplace_orders` | `sales_orders:view` | `sales-orders/queries` `listSalesOrders` | Buyer phone, email and address removed at every depth. |
| `get_marketplace_order` | `sales_orders:view` | `sales-orders/queries` `getSalesOrderById` | Same stripping; city and province are returned. |
| `list_field_sales_orders` | `field_sales_orders:view` | `field-sales/queries` `listFieldSalesOrders` | **`total` is `null` for a KONSI order that is not APPROVED**, as the list page shows "—". No store or salesman ids. |
| `get_field_sales_order` | `field_sales_orders:view` | `field-sales/queries` `getFieldSalesOrderById` | **For a KONSI order not APPROVED, `total` and each line's `price` and `subtotal` are `null`**, as the detail page's `showMoney`. Deliveries are id, doc no. and date only (no photo, GPS, signature or receiver). |
| `list_purchase_orders` | any of `purchase_orders:view`, `supplier_payments:view`, `inventory:manage`, `work_orders:create`, `work_orders:manage` (copy of the PO action's list) | `purchase-orders/queries` `listPOs` | Includes computed `isOverdue`. |
| `list_work_orders` | any of `work_orders:view`, `work_orders:create`, `work_orders:manage`, `vendor_returns:view` (copy of the WO action's list) | `work-orders/queries` `listWorkOrders` | |
| `list_receivables` | `bolehMembacaPiutang` | `receivables/queries` `daftarPiutang`, `saringPiutang`, `ringkasPiutang` (the `/backoffice/piutang` page) | The summary is computed on the **filtered** rows, so with filters it differs from the page header. |
| `list_consignment_cycles` | `bolehMembukaKonsi` | `konsinyasi/queries` `daftarSiklus`, `saringSiklus` | **`soldValue`** is the total of goods the store reported sold in the cycle, not the billed amount (no VAT, loss charges or other adjustments). Never calls `rincianSiklus` (SPG salary). |
| `list_tax_invoices` | `tax_invoices:view` | `tax-invoices/queries` `listTaxInvoices` | No NPWP or NIK. Link is the faktur page searched by faktur number, or by the source document number while the faktur has none. |
| `list_marketplace_settlements` | `finance:settlements:view` | `finance/settlement/queries` `listSettlements` | **id, channel, period start/end, status and link only — no totals, fees or net amounts** (the list query has none). The description says so. |
| `list_leave_requests` | `bolehMelihatIzin` | `salesman/izin` / `izin-queries` | Office leave (izin) list; no salary fields. |
| `list_spg_buyer_returns` | `spg_sales:view` | `spg/retur-pembeli-queries` | SPG buyer-return list for approve/reject. |

The registry is `lib/vira/tools/index.ts`; `app/api/vira/mcp/route.spec.ts` and `lib/vira/tools/index.test.ts` pin the 17 read names and the 9 write names in registry order for a `"*"` user.

## 5. How to add a tool

1. Pick the module file named after the action or page it mirrors, `lib/vira/tools/<module>.ts` (add the module to `MODULES` in `tools/index.ts` only if it is new). Add the tool to its `tools` array with `defineTool(...)`.
2. **Read the source `lib/` function first.** Use its real parameter names and enums; copy enums from its type or from the page that calls it. If the read only exists inside an action body, extract it to `lib/` first (see `docs/FOLLOWUPS.md`); never call the action.
3. Input: only what the user would type; plus `...listInputShape` for list tools. Every optional input is `.optional()` and has a plain-English `.describe()`. No user id, actor id or permission in the input. A cross-field rule (for example "exactly one of id or docNo") cannot live on the raw shape: export a refined `z.object(...)` and re-check it in the handler, throwing `ViraInputError`.
4. Gate: the **same** check the page or action applies (`code`, `anyOf`, `allOf`, or an `izin` predicate from `lib/`). If you must copy a code list, copy it exactly and pin it with a test that reads the source.
5. Paging: source takes `skip`/`take` → pass offset/limit and return `toPage(...)`. Source takes `page`/`pageSize` → `page = offset / limit + 1`; if `offset % limit !== 0` throw `ViraInputError("offset must be a multiple of limit")`. Source returns all rows → `sliceToPage(rows, offset, limit)`.
6. Output: map to an explicit list of camelCase English fields. Never spread a source row. Leave out a field the source does not have. Where the UI hides a value (for example money on an unapproved KONSI order), return `null` or refuse, the same way. Every record gets a `url` from `recordUrl(ctx.baseUrl, path)` that opens a page which actually finds the record.
7. Errors: not found → `ViraNotFoundError("<Thing> not found")`; bad or ambiguous input → `ViraInputError(...)`.
8. **Add a parity case** to the module's `parityCases` (`route`, `pageCode`, `predicate` or `action`), so `lib/vira/tools/parity.spec.ts` proves the tool's gate equals the UI's.
9. Tests in `lib/vira/tools/<module>.test.ts` with the `lib/` function mocked: input accepted and rejected, exact output fields, a deep check that forbidden fields never appear, paging, `url`, not-found and ambiguous errors.
10. Update the pinned tool-name lists in `app/api/vira/mcp/route.spec.ts` / `lib/vira/tools/index.test.ts` and the tables in this doc, then **run the specs** (section 7).

## 6. Rules

- **No personal data:** never return phone, email, street address, SPG salary (`gajiPokok`), NPWP or NIK. City and province may be returned. Store and customer **names** are returned; store and salesman ids only where the card lists them.
- **Conservative by default:** when a field's exposure is unclear, leave it out. Prices and money are returned only where the page shows them to the same user, and hidden where the page hides them.
- **Never call server actions** (`app/actions/**`). Call the `lib/` function the action or page calls.
- **Never take the actor from input.** It comes from the verified token, loaded fresh per call.
- **Max 50 rows** per call (`VIRA_LIST_MAX_LIMIT`). A tool whose source is not paged caps its rows the same way (`get_item_stock` says `truncated`).
- Never import `@/lib/auth` (NextAuth) from `lib/vira/**`, `app/api/vira/mcp/**` or `app/api/vira/confirm/**`; only the token route may.
- Never log tokens, confirm tokens, service keys or customer personal data.
- No Prisma schema changes or migrations for VIRA; permission rows come from dated seed SQL.
- **Write-tool safety:** a write tool's MCP handler must never change data. Only `execute`, called from `/api/vira/confirm`, may change data. The confirm token goes only into `_meta["elorae/confirmation"]`, never into `content`.

## 7. Testing

Run through `scripts/verify.sh` (see `AGENTS.md` § Workflow conventions). The DB specs need the MariaDB test bed on `:3308` (`docs/local-db-testbed.md`).

```
scripts/verify.sh -F @elorae/web exec vitest run lib/vira app/api/vira
scripts/verify.sh -F @elorae/web type-check
```

## 8. Write tools (phase 2)

Epic #538. Nine write tools prepare a change; the VIRA runtime shows confirm/cancel buttons; only a successful confirm applies the writer.

### 8.1 Prepare → button → confirm

```
User asks VIRA to change something in Elorae
  └─ VIRA runtime → MCP tools/call <write_tool>
        Elorae prepare (read-only): resolve record, check state, build preview + args
        Result content (to the model): awaiting_confirmation JSON (preview fields + note; see §8.4)
        Result _meta["elorae/confirmation"] (for the VIRA runtime only, never shown to the model):
          { token, expiresAt, title, summary, details[], confirmLabel, cancelLabel, destructive, target{ type, id, url } }
  └─ VIRA runtime renders Confirm / Cancel from _meta (not the model)
        User presses Confirm
        VIRA runtime → POST /api/vira/confirm
           headers: X-Vira-Service-Key, Authorization: Bearer <access JWT>
           body:    { confirmToken, decision: "confirm" | "cancel" }
           Elorae: verify tokens, consume jti once, re-check gate, tool.execute(args) → writer
```

An MCP call of a write tool **only prepares**. Execution happens **only** in `POST /api/vira/confirm`, which is not an MCP tool, so the model cannot call it.

### 8.2 `vira:write`

- Permission code **`vira:write`** (seed `packages/db/prisma/seed-vira-2026-11-17-permissions.sql`).
- Required in addition to each write tool's own gate (MCP ANDs it outside the tool gate; parity compares the tool gate without it).
- **Not granted to any role by default**; the owner grants it in Settings → Roles & permissions.
- System (`"*"`) roles have it automatically.
- Confirm also requires `vira:use` (from the access token) and `vira:write`.

### 8.3 `POST /api/vira/confirm`

Headers: `X-Vira-Service-Key`, `Authorization: Bearer <access JWT>` (same mint as MCP). Body: `{ confirmToken: string, decision: "confirm" | "cancel" }`. No `Origin` header (server-to-server). Checks run in this order (`confirm/route.ts`):

| HTTP | Body | When |
|---|---|---|
| 403 | `{ error: "bad_origin" }` | `Origin` header present |
| 401 | `{ error: "bad_service_key" }` | Missing/wrong service key |
| 401 | `{ error: "invalid_token" }` | Missing/bad/expired access token, unknown user, or stale `pwf` (also sets `WWW-Authenticate: Bearer`) |
| 503 | `{ error: "not_configured" }` | `VIRA_TOKEN_SECRET` unset (after Bearer-present check) |
| 403 | `{ error: "forbidden" }` | No `vira:use` or no `vira:write` |
| 429 | `{ error: "rate_limited" }` (with `Retry-After`) | Over 20 confirms/min for that user |
| 400 | `{ error: "invalid_request" }` | Body fails zod |
| 410 | `{ error: "confirmation_expired" }` | Confirm JWT expired |
| 400 | `{ error: "invalid_confirmation" }` | Bad confirm JWT (before `sub` / `jti`) |
| 403 | `{ error: "forbidden" }` | Confirm `sub` ≠ bearer `sub` |
| 409 | `{ error: "already_used" }` | `jti` already consumed |
| 200 | `{ status: "cancelled" }` | `decision === "cancel"` (returns here; no tool lookup) |
| 400 | `{ error: "invalid_confirmation" }` | Unknown tool name in confirm claims |
| 403 | `{ error: "forbidden" }` | Tool gate no longer allows |
| 400 | `{ error: "invalid_confirmation" }` | Args fail `argsSchema` |
| 200 | `{ status: "refused", code, message, url? }` | `execute` returned `{ ok: false }` (no revalidate) |
| 200 | `{ status: "done", message, url }` | `execute` succeeded; then revalidate paths + optional `afterSuccess` |
| 500 | `{ status: "failed", code: "INTERNAL", message }` | Unexpected throw from `execute` |

Confirm token: HS256 with `VIRA_TOKEN_SECRET`, `iss: "elorae"`, `aud: "vira-confirm"`, TTL **300 s**. Claims: `sub`, `tool`, `args`, `jti`. Single-use `jti`s are kept in memory until they expire.

### 8.4 `_meta["elorae/confirmation"]`

Built by `toolConfirmation` in `lib/vira/output.ts`. The token never appears in `content`.

```json
{
  "content": [{
    "type": "text",
    "text": "{\"status\":\"awaiting_confirmation\",\"title\":\"Setujui pesanan SO/2026/0123\",\"summary\":\"Toko Melati · 3 baris\",\"details\":[{\"label\":\"Toko\",\"value\":\"Toko Melati\"}],\"target\":{\"type\":\"field_sales_order\",\"id\":\"o1\",\"url\":\"https://elorae.example/backoffice/field-sales-orders/o1\"},\"note\":\"Nothing has been changed yet. The user must press the confirm button in the chat. Do not say the change is done.\"}"
  }],
  "structuredContent": { "...same object as text..." },
  "_meta": {
    "elorae/confirmation": {
      "token": "<confirm JWT>",
      "expiresAt": "2026-11-17T09:05:00.000Z",
      "title": "Setujui pesanan SO/2026/0123",
      "summary": "Toko Melati · 3 baris",
      "details": [{ "label": "Toko", "value": "Toko Melati" }],
      "confirmLabel": "Setujui",
      "cancelLabel": "Batal",
      "destructive": false,
      "target": {
        "type": "field_sales_order",
        "id": "o1",
        "url": "https://elorae.example/backoffice/field-sales-orders/o1"
      }
    }
  }
}
```

The VIRA runtime must never pass `_meta` to the model (decision E5; tracked in the VIRA repo).

### 8.5 How to add a write tool

1. Mirror an existing `"use server"` action and its `lib/` writer. Cite the action/writer line ranges above the tool.
2. Add `defineWriteTool(...)` to that module's `writeTools` (and the module to `MODULES` only if new). English `name` / `description` verbatim from the card; Indonesian labels in the preview.
3. `inputShape`: only the listed fields, each with `.describe()`. No actor id. Set `__sampleInput` for `never-execute.spec.ts`.
4. `prepare`: **reads only**. Resolve the record; refuse wrong state with `ViraInputError` / `ViraNotFoundError`. Return `preview` + `args` (writer input minus the actor).
5. `execute`: call the same writer with `args` plus the actor from `ctx`. Map refusal codes like the action. On success return `{ ok: true, message, url, entityType, entityId }` (and `extra` only if `afterSuccess` needs it).
6. `revalidate`: copy the action's `revalidatePath` list. Copy notifications / side effects into `afterSuccess` with a source comment; it must not throw.
7. Gate: same permission as the action (`code` / `anyOf` / `allOf` — never `izin` on a write tool). Do **not** put `vira:write` on the tool gate.
8. Add a `writeAction` parity case (one per tool; two rows when the action gates on a call argument, e.g. consignment NOTA vs PAJAK).
9. Update the pinned write-tool name list and the table below; run section 7.

### 8.6 Limitations

- **In-memory single-use `jti`:** used confirm ids live in process memory until expiry. A web restart forgets them, so a token that was already used could be accepted once more after restart (documented; one web process on the VPS).
- **Stale previews:** the user can wait up to the confirm TTL. Every writer re-checks state inside its transaction; confirm returns `{ status: "refused", ... }` instead of success when the write is no longer valid.
- **`_meta` trust:** the confirm token is only safe if the VIRA runtime keeps `_meta` off the model and only posts it to `/api/vira/confirm` after a real button press.

### 8.7 Write tool list

Nine tools, registry order (`MODULES` in `lib/vira/tools/index.ts`). Listing also requires `vira:write`.

| Tool | Gate (plus `vira:write`) | Writer | Notes |
|---|---|---|---|
| `approve_field_sales_order` | `field_sales_orders:approve` | `field-sales` approve | Approve-as-is only (no price/line/credit override). |
| `reject_field_sales_order` | `field_sales_orders:approve` | `field-sales` reject | Destructive; reason required. |
| `close_purchase_order` | `purchase_orders:approve` | `purchase-orders/tutup` | Destructive; UI PARTIAL only; notifies on success. |
| `record_consignment_document_number` | any of `consignment:note_number`, `consignment:tax_number` | `konsinyasi/writer` `catatNomorDokumen` | NOTA or PAJAK; per-jenis prepare check. |
| `mark_tax_invoice_sent_to_store` | `tax_invoices:manage` | `tax-invoices/writer` | CREATED → SENT_TO_STORE. |
| `approve_leave_request` | `field_sales_orders:approve` | `salesman/izin-writer` | Same code `bolehMemutuskanIzin` uses. |
| `reject_leave_request` | `field_sales_orders:approve` | `salesman/izin-writer` | Destructive. |
| `approve_spg_buyer_return` | `spg_returns:approve` | `spg` retur writer | `spgSaleId` only for revalidate, never the writer. |
| `reject_spg_buyer_return` | `spg_returns:approve` | `spg` retur writer | Destructive. |
