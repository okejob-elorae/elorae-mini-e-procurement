# VIRA MCP adapter (phase 1, read-only)

Epic #496. Code: `apps/web/lib/vira/**`, `apps/web/app/api/vira/token/route.ts`, `apps/web/app/api/vira/mcp/route.ts`.

## 1. What it is

An MCP (Model Context Protocol) endpoint inside `apps/web` that lets VIRA, OKEJOB's own AI agent runtime (a separate repo), answer back-office questions for an Elorae user. Phase 1 is **read-only**: one `whoami` tool and 14 read tools, all marked `readOnlyHint`. Every call runs **as the logged-in Elorae user** who asked: the tool sees only what that user's permission codes already let them see in the back office, through the same `lib/` query functions the pages and actions use. Tools never call server actions and never write.

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
- **`POST /api/vira/mcp`** is the only VIRA path on the `proxy.ts` allow-list. It is stateless: a new MCP server and transport per POST, with JSON responses. It is rate-limited to 60 per minute per user. GET and DELETE return 405.
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

A secret shorter than 32 characters is treated as unset. Values are trimmed and read on every call (no caching).

Generate each secret separately:

```
openssl rand -base64 48
```

**Production:** set `VIRA_APP_URL` explicitly. `.env.example` marks it optional, and locally the fallback is fine, but MCP calls come server-to-server from the VIRA runtime, so the request's host headers describe that call, not the Elorae site the user should open. Do not set any `VIRA_*` var in production before the owner sign-off (#516).

**Deploy:** the `vira:use` permission row comes from `seed-vira-2026-11-16-permissions.sql`. The deploy's `migrate` job runs each `packages/db/prisma/seed-*.sql` **once**, recorded in `_seed_runs`, so nothing needs to be run by hand on prod. The file is idempotent and links no role. For a database outside the deploy flow, run it with the `mariadb` client as its header says.

## 4. Tool list

15 tools. "Gate" is what the tool checks; it is the same check the page or action applies (proved by `parity.spec.ts`). Every list tool takes `limit` (default 20, **max 50**) and `offset`, and returns `{ items, total, offset, limit, hasMore }`. Two tools add one key to that shape: `list_receivables` adds `summary`, and `get_store_stock` (paged over its stock rows) adds `store`. Every record carries a `url` into the back office.

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

The registry is `lib/vira/tools/index.ts`; `app/api/vira/mcp/route.spec.ts` pins exactly these 15 names for a `"*"` user.

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
10. Update the 15-name list in `app/api/vira/mcp/route.spec.ts` and the table above, then **run the specs** (section 7).

## 6. Rules

- **No personal data:** never return phone, email, street address, SPG salary (`gajiPokok`), NPWP or NIK. City and province may be returned. Store and customer **names** are returned; store and salesman ids only where the card lists them.
- **Conservative by default:** when a field's exposure is unclear, leave it out. Prices and money are returned only where the page shows them to the same user, and hidden where the page hides them.
- **Never call server actions** (`app/actions/**`). Call the `lib/` function the action or page calls.
- **Never take the actor from input.** It comes from the verified token, loaded fresh per call.
- **Max 50 rows** per call (`VIRA_LIST_MAX_LIMIT`). A tool whose source is not paged caps its rows the same way (`get_item_stock` says `truncated`).
- Never import `@/lib/auth` (NextAuth) from `lib/vira/**` or `app/api/vira/mcp/**`; only the token route may.
- Never log tokens, service keys or customer personal data.
- No Prisma schema changes or migrations for VIRA; permission rows come from dated seed SQL.

## 7. Testing

Run through `scripts/verify.sh` (see `AGENTS.md` § Workflow conventions). The DB specs need the MariaDB test bed on `:3308` (`docs/local-db-testbed.md`).

```
scripts/verify.sh -F @elorae/web exec vitest run lib/vira app/api/vira
scripts/verify.sh -F @elorae/web type-check
```
