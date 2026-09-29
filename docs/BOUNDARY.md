# Service boundary — `apps/web` ↔ `apps/api`

Status: **active** · Owner: backend integration · Last updated: 2026-09-27

This document defines the responsibility split between the Next.js app
(`apps/web`) and the NestJS Jubelio integration service (`apps/api`) in the
Elorae monorepo. It is the source of truth for *who writes what* and *how the
two services talk*. Any PR that violates the rules below must either update
this document or be rejected.

For day-to-day developer usage of the Jubelio-touching surface (how to enqueue
a push, which `entityType` and `source` strings to use, which helpers to call),
see [INTEGRATION-GUIDE.md](./INTEGRATION-GUIDE.md). This file owns the why; the
guide owns the how.

Legend used throughout: **✅ built** · **🟡 partial** · **⏳ planned**.

---

## 0. Status snapshot

| Layer | Item | State |
| ----- | ---- | :---: |
| Monorepo | `apps/web` + `apps/api` + `packages/db` + `reference/jubelio` + `docs/` | ✅ |
| Monorepo | pnpm workspaces + Turborepo (`turbo.json`, `pnpm-workspace.yaml`) | ✅ |
| `@elorae/db` | Prisma schema, migrations, generated client, MariaDB adapter | ✅ |
| `@elorae/db` | Stock writer (§3.1), sales-order fulfillment writer (§3.2) | ✅ |
| `@elorae/db` | Shared helpers (`writeAuditLog`, `SystemSetting` namespace enforcement) | ⏳ |
| `apps/web` | Existing Next.js ERP (untouched by carve, imports `@elorae/db`) | ✅ |
| `apps/api` | NestJS scaffold (`PrismaModule`, `HealthModule`, `JubelioModule`) | ✅ |
| `apps/api` | Swagger `/docs` behind HTTP Basic auth (`SWAGGER_USER`/`SWAGGER_PASS`) | ✅ |
| Jubelio token | env creds + DB persistence + 12 h TTL + in-memory cache + single-flight refresh + on-demand re-fetch within 5 min of expiry | ✅ |
| Jubelio token | Proactive scheduled refresh (`@Cron` hourly prewarm) + exponential backoff on `refresh()` failure + `AdminNotification` write on persistent failure | ✅ |
| Webhooks | Receivers (`salesorder`, `stock`, `salesreturn`, `product`) + signature verify + dedupe via `JubelioWebhookEvent` | ✅ |
| Webhook handlers | `stock` ✅ (applies Jubelio `end_qty` as on-hand plus field-sales holds — §3.1), `salesorder` ✅ (reserve/consume/release, with forward-sync to `fulfillmentStatus=SHIPPED`), `product` ✅ (triggers single-group catalog re-ingest), `salesreturn` ✅ (fetches the return's sales-order detail and ingests it through `SalesReturnIngestService`; a 30-min returns sweeper backstops it) | ✅ |
| Catalog ingest | `POST /jubelio/catalog/sync` — Jubelio → ERP (upserts `Item` via `@elorae/db` helper with `source=JUBELIO_INGEST`, `JubelioProductMapping`, zero `InventoryValue`) | ✅ |
| Outbox queue | `JubelioOutbox` table + outbox poller + outbox router + handlers (`stock_push`, `product_push`, `salesorder_pick`, `salesorder_pack`, `salesorder_ship`); already-in-state skip; entityType registry at `@elorae/db/jubelio-outbox`. `salesreturn_decision_push` is registered and enqueued but its handler is unwired (the router skips it `handler_not_wired`) | 🟡 |
| Bulk migration | One-shot ERP→Jubelio backfill tool (`/backoffice/jubelio/migration`) — enqueues `product_push` rows, polls outbox status for progress | ✅ |
| API audit | `JubelioApiCall` audit log + HTTP interceptor + 429 rate-limit handling | ✅ |
| Admin alerts | `AdminNotification` table + writer in api + read in web admin UI | ✅ schema + api writer; ⏳ web UI consumer |
| Cross-service auth bridge (HMAC-signed internal channel, `InternalSignGuard`) | | ✅ |
| Internal `api → web` revalidate endpoint | | ⏳ |
| Render deployment + Upstash Redis provisioning + CI for migrations lint | | ⏳ |
| `@elorae/types` shared package (Zod schemas, permission constants re-export) | | ⏳ |

---

## 1. Principle

- `apps/web` owns ERP business logic and UI.
- `apps/api` owns Jubelio integration: HTTP client, token lifecycle, push,
  ingest, webhook receivers, queues, long-running jobs.
- Each table has one **write owner**. Other service may read via the shared
  Prisma client in `@elorae/db`.

### Decision rule

> "Does this code talk to Jubelio (push, pull, webhook, or background job
> related to a Jubelio resource)?"
>
> - **Yes** → `apps/api`
> - **No** → `apps/web`

**Exception — ERP triggers with Jubelio side-effects.** Actions like
`receiveFG`, `createGRN`, `createStockAdjustment` stay in `apps/web` and write
to the local DB. In the same Prisma transaction they append a row to
`JubelioOutbox`. The `apps/api` outbox worker drains it. The ERP action does
not call Jubelio directly. **⏳ planned** — and for stock it only applies after
cutover: until Elorae is the system of record, Jubelio is the stock source of
truth and a push from an ERP action overwrites it (§3.1).

---

## 2. Service responsibilities

| Concern                                | `apps/web` | `apps/api` | State |
| -------------------------------------- | :--------: | :--------: | :---: |
| UI rendering (App Router)              | ✅          |            | built |
| NextAuth session                       | ✅          |            | built |
| ERP CRUD (items, GRN, PO, vendors)     | ✅          |            | built |
| Production / costing / reports         | ✅          |            | built |
| RBAC checks (UI + ERP actions)         | ✅          |            | built |
| Audit log writer (ERP side)            | ✅          |            | built |
| Encryption / decryption (supplier PII) | ✅          |            | built |
| File upload (R2, GRN photos)           | ✅          |            | built |
| Firebase admin (push notifications)    | ✅          |            | built |
| Jubelio HTTP client + token cache      |            | ✅          | built |
| Jubelio webhook receivers              |            | ✅          | built |
| Catalog ingest (Jubelio → ERP)         |            | ✅          | built (`Item` dual-write per §3.3) |
| Long-running jobs and queues           |            | ✅          | built (BullMQ webhook queue, outbox poller, salesorder resync worker, `@Cron` token prewarm / webhook sweep / returns sweeper) |
| Audit log writer (Jubelio side)        |            | ✅          | built (`JubelioApiCall` via the HTTP interceptor) |
| RBAC guard for Jubelio endpoints       |            | ✅          | built as the signed internal channel (`InternalSignGuard`, D16) — per-permission RBAC stays in web |
| Catalog push (ERP → Jubelio)           |            | ✅          | built (`product_push`) |
| Marketplace listing                    |            | ⏳          | planned |
| Stock push                             |            | ✅          | built (`stock_push`, the §3.1 contract formula) — manual, opname and `REASSERT_ELORAE` triggers only; nothing pushes automatically. Gated by the cutover switch `JUBELIO_STOCK_PUSH_ENABLED` (fail-closed, off until cutover — §3.1) |
| Sales order ingest                     |            | ✅          | built (`salesorder` webhook + resync) |
| WMS pick / pack / ship                 |            | ✅          | built (`salesorder_pick`/`_pack`/`_ship`) |
| Returns ingest                         |            | ✅          | built (`salesreturn` webhook + returns sweeper); the decision push back is unwired |
| Stock reconciliation                   | ✅          | snapshot read | built — web owns the run and its writes, api only serves `GET /jubelio/inventory/snapshot` (D5) |

---

## 3. Data ownership

**Write owner** is the service authorised to issue `INSERT`/`UPDATE`/`DELETE`
on the table. Reads are unrestricted via `@elorae/db`.

Tables marked ⏳ do not exist in Prisma schema yet — listed here as the target
contract for the migrations that will introduce them.

| Table                          | Owner                       | Reads from other            | State |
| ------------------------------ | --------------------------- | --------------------------- | :---: |
| `User`, `Role`, `Permission`   | web                         | api (read)                  | ✅ |
| `Item`, `ItemVariant`          | **both** — see §3.3         | —                           | ✅ schema + `source` column; api ingest via helper ✅; web continues bare prisma 🟡 |
| `Supplier`, `SupplierType`     | web                         | —                           | ✅ |
| `GRN`, `GRNItem`               | web                         | api (read)                  | ✅ |
| `PurchaseOrder`, `POItem`      | web                         | api (read)                  | ✅ |
| `VendorReturn`                 | web                         | —                           | ✅ |
| `Production*`                  | web                         | api (read FG receipts)      | ✅ |
| `PlanYear`, `PlanCategory`, `PlanMonthly`, `PlanColorAllocation`, `PlanAccessory` | web | — | ✅ |
| `PlanCmtAllocation`, `PlanStage` | web — WO creation via `createWorkOrder` in `apps/web`; `PlanStage` auto-synced when generating from CMT rows (`planCmtAllocationId`) | — | ✅ |
| `InventoryValue`               | **both** — see §3.1         |                             | ✅ schema + shared writer — quantity moves ONLY through the movers in `packages/db/src/stock-balance.ts` (`moveMainStock`/`setMainStock`), which append a `StockLedgerEntry` in the same transaction; `stock-writer.ts`'s `applyJubelioStockAdjustment` (the api-side webhook path) already routes through them, and a guard test fails the suite on a bare-prisma balance write. `reservedQty` is the documented exception — it is not a stock movement and is written by `reservation-writer.ts`, plus `issueKonsiTransfer` (konsi shipment completion), the one writer outside that file. Until cutover this table MIRRORS Jubelio, which is the stock source of truth — see §3.1. |
| `StockAdjustment`              | **both** — see §3.1         |                             | ✅ schema; written by each side's own action beside the balance move, in the same transaction. `source` MUST come from the `@elorae/db` registry — see §3.1. |
| `StockLedgerEntry`             | **both** — see §3.1         |                             | ✅ schema + writer — append-only movement ledger, written through `appendStockLedger` and (almost always) via the `stock-balance.ts` movers. **api** writes it on two paths: `stock.handler.ts` → `applyJubelioStockAdjustment` → `setMainStock` (an absolute set, so a no-op webhook appends nothing), and `salesorder.handler.ts` → `consumeOrder` → `appendStockLedger`. `reserveOrder` is deliberately NOT one of them — it moves only `reservedQty` and appends nothing, because a reservation is not a stock movement; the only `reservation-writer.ts` functions that append are `consumeOrder`, `consumeFieldSalesOrderPartial` and `consumeFieldSalesOrder`. **web** writes it from every ERP path that moves a balance. Never write it outside a transaction that also moves the balance it describes, and never UPDATE or DELETE a row. |
| `StockReservation`             | **both** — see §3.1         |                             | ✅ schema + writer — api (Jubelio salesorder webhook via `reserveOrder`/`consumeOrder`/`releaseOrder` with `source=JUBELIO`), web (ship button `consumeOrder`, field-sales putus orders via `reserveFieldSalesOrder` at create and `consumeFieldSalesOrderPartial` per **delivery** / `releaseFieldSalesOrder` on reject or close-remainder, with `source=FIELD_SALES`). `consumeFieldSalesOrder` (whole-order) still exists but has NO production caller — reaching for it bypasses the delivery document. Konsi orders reserve through `reserveKonsiFieldSalesOrder` at approve and at the admin konsi push (both via `approveKonsiOrderInTx`), with `source=FIELD_SALES_KONSI`. Open non-`JUBELIO` rows are the `offlineReserved` term of the Jubelio stock contract (§3.1). Written through `@elorae/db/reservation-writer.ts` — never bare prisma — with ONE documented exception: `issueKonsiTransfer` (`apps/web/lib/field-sales/konsi-transfer/writer.ts`) draws a konsi reservation down (`consumedQty`, then `CONSUMED` once exhausted) at shipment completion. |
| `SalesOrder`                   | **both** — see §3.2         | —                           | ✅ api owns Jubelio-derived cols; web owns fulfillment cols via helper |
| `SalesOrderItem`               | api                         | web (read)                  | ✅ schema + api writer |
| `SalesHistory`                 | web                         | api (read)                  | ✅ Excel import (`channel=MARKETPLACE`) + putus **delivery** (`channel=OFFLINE`, keyed by `FieldSalesDelivery.docNo` so repeat deliveries of a variant don't collide — approval writes none since delivery became its own document); identity fields (`itemId`, `erpVariantSku`, `jubelioItemId`, `resolutionStatus`) stamped at import via `marketplace-sku-resolver` — see §3.7 |
| `SalesHistoryImport`           | web                         | —                           | ✅ |
| `ForecastConfig`, `ForecastResult` | web                     | —                           | ✅ `ForecastResult.itemId` for item-centric grouping |
| `SalesReturn`                  | api ingest; web decision | —                    | 🟡 api ingest ✅ (`salesreturn` webhook + returns sweeper, through `SalesReturnIngestService`); web decision writer ✅ (`acceptReturnItem`/`rejectReturnItem`/`submitReturnDecision` in `packages/db/src/sales-return-writer.ts`, driven from `/backoffice/returns/[id]` — the line's order reservation decides the stock: a consumed line moves main stock back through `moveMainStock`, `source = ERP_RETURN_ACCEPT`, onto the row that governs its variant now (the reservation's own row while mapped, else the one item the variant moved to); a released line is accepted with no stock change; a still-reserved one is refused; a line naming an order line with no reservation is refused; a line naming no order line keeps the item-based path onto its ingest-resolved `itemId`) and it enqueues `salesreturn_decision_push`. Only the api handler for that outbox type is unwired, so decisions never reach Jubelio |
| `FieldSalesOrder`, `FieldSalesOrderLine` | web           | api (read)                  | ✅ schema; web-written putus orders (ERP-originated), api never writes |
| `FieldSalesDelivery`, `FieldSalesDeliveryLine` | web     | —                           | ✅ schema + writer — `recordFieldSalesDelivery` / `closeFieldSalesOrderRemainder` in `apps/web/lib/field-sales/delivery/writer.ts`. Putus only; api never writes. `docNo` is NOT always `DLV/`-prefixed — rows written by the backfill migration carry the order number instead. |
| `JubelioProductMapping`        | api                         | web (read)                  | ✅ |
| `JubelioCategoryMapping`       | api                         | web (read)                  | ✅ schema; writer ⏳ (currently seed-only, no runtime writer) |
| `JubelioOutbox`                | web insert, api consume/update | — | ✅; `entityType` MUST come from `@elorae/db/jubelio-outbox` registry — see §4.2.1 |
| `JubelioWebhookEvent`          | api                         | —                           | ✅ |
| `JubelioApiCall`               | api                         | web (read for admin UI)     | ✅ |
| `AdminNotification`            | **both** — see §3.5; api on integration alerts, web on ERP-detected alerts | — | ✅ schema + api writer + web writers — journals, order approvals, store changes, fakturs, retur mismatches, credit holds, collections, AR overdue, stuck deliveries and the konsi count schedule; the live category list is `CATEGORY_PERMISSION` in `apps/web/lib/notifications/admin-fanout.ts` |
| `SystemSetting` (Jubelio keys) | api                         | web (read for settings UI)  | ✅ (`JUBELIO_SESSION_TOKEN`) |
| `SystemSetting` (other keys)   | web                         | —                           | ✅ |
| `AuditLog`                     | both — shared writer        | —                           | ✅ schema; 🟡 shared writer ⏳ |
| `Notification`                 | both                        | —                           | ✅ |

### 3.1 Stock writes — multi-writer

**Source of truth until cutover: Jubelio, not Elorae.** The client still runs
day-to-day on Jubelio. Until Elorae becomes the system of record,
`InventoryValue` is a MIRROR, kept by the Jubelio `stock` webhook and by
marketplace reserve/consume. So the Jubelio → Elorae direction — the `stock`
webhook and reconciliation `MATCH_JUBELIO` — is the one that must be correct
today, and every Elorae → Jubelio stock push overwrites the source of truth
with a mirror that is not yet trustworthy: a negative-on-hand row pushes as
`end_qty 0` and takes a live marketplace listing out of stock. The pushes that
exist: bulk "push all stock" (`/backoffice/jubelio/admin`,
`bulkPushAllStockToJubelio`), the per-item push on the item page
(`pushItemStockToJubelio`), the push after opname approval
(`pushFgStockAfterOpname`), and reconciliation `REASSERT_ELORAE`.

**The cutover switch.** Every one of those pushes is gated by the
`SystemSetting` key `JUBELIO_STOCK_PUSH_ENABLED`, read only through
`isJubelioStockPushEnabled` (`packages/db/src/jubelio-stock-contract.ts`). It
fails closed: only the exact string `"true"` enables pushing; an absent row
(nothing seeds it) or any other value is off. `StockPushHandler` is the
backstop: it reads the switch first and skips EVERY `stock_push` row with
`stock_push_disabled` while it is off — both buttons, the post-opname push,
`REASSERT_ELORAE`, rows queued before it went off, and any future automatic
push. The web refuses first where it can: the two push actions return
`push_disabled`, the manual `REASSERT_ELORAE` resolve and saving
`REASSERT_ELORAE` as the direction return `PUSH_DISABLED` (any other direction
still saves), and the reconciliation run degrades `REASSERT_ELORAE` to
`FLAGGED`. Skipped rows are not replayed when the switch goes on. The webhook
direction keeps applying either way; only its field-sales add-back depends on
the switch (the contract below). Turning it on is the LAST cutover step, on
`/backoffice/jubelio/admin` (admin only, audited as
`JUBELIO_STOCK_PUSH_TOGGLE`): after the recount and a clean reconciliation,
and immediately followed by a bulk push, so Jubelio receives figures net of
the holds the webhook starts adding back. The rule that keeps it whole: every
new push path enqueues `stock_push`, and nothing calls
`PUT /inventory/items/{id}/stock` outside that handler.

**The quantity contract (verified live 2026-09-27).** Jubelio's `end_qty` is
ON-HAND; `order_qty` is Jubelio's own open marketplace orders; and
`available_qty = end_qty − order_qty`. Jubelio therefore nets marketplace
commitments itself, and the only commitments it cannot see are Elorae's
field-sales holds: `offlineReserved` = the open qty (`qty − consumedQty`) of
`StockReservation` rows with `state = 'RESERVED'` and `source <> 'JUBELIO'`.
Every path goes through `packages/db/src/jubelio-stock-contract.ts`:

| Path | Formula |
| ---- | ------- |
| Stock push (`stock-push.handler.ts`) | `end_qty = max(0, qtyOnHand − offlineReserved)` |
| `stock` webhook (`stock.handler.ts`) | `qtyOnHand = end_qty + offlineReserved`, absolute, via `setMainStock` on the locked row; a raw `end_qty` that `parseJubelioQty` rejects (`null`, `""`, non-numeric, negative) is skipped |
| Reconciliation comparison | Elorae `max(0, qtyOnHand − offlineReserved)` vs Jubelio `end_qty` while pushes are enabled; raw `qtyOnHand` (can be negative) while they are off, since the floor only mirrors what the push sends; a variant with no Jubelio figure is FLAGGED, never compared as 0 |
| `MATCH_JUBELIO` correction | `qtyOnHand = end_qty + offlineReserved`, absolute, via `setMainStock` on the locked row |

The `offlineReserved` term on the webhook, comparison and `MATCH_JUBELIO`
rows applies ONLY while the cutover switch is on
(`effectiveOfflineReservedQty`/`effectiveOfflineReservedByKey`): only a push
nets the holds out of Jubelio's `end_qty`, so while pushes are off nothing
has, and the term is `0`. The push runs only while the switch is on, so it
always nets. The comparison's floor at 0 is gated the same way
(`comparableEloraeQty`): it exists only to mirror the push's own floor, so
while pushes are off nothing floors Jubelio's figure for this to mirror, and
the comparison uses raw `qtyOnHand` instead.

Never subtract `reservedQty` on any of these paths: it includes the `JUBELIO`
reservations, which Jubelio already counts in `order_qty`, so subtracting it
takes every marketplace order off twice. The push did exactly that until the
contract was verified. `available = qtyOnHand − reservedQty` remains the ERP's
own selling figure and is not what Jubelio receives. The evidence, the
history and the prod damage (cause unproven) are in `docs/landmines/jubelio.md`.

**Writers.**

- **web** writes `InventoryValue` and `StockAdjustment` from every ERP action
  that moves main stock. Exactly one of them pushes to Jubelio: opname
  approval, which enqueues `stock_push` AFTER its transaction commits
  (`pushFgStockAfterOpname`; a failed enqueue leaves the local adjustment
  standing). Every other main-stock mover changes on-hand WITHOUT pushing
  (checked against every `moveMainStock`/`setMainStock` call site):
  - GRN receipt (`createGRN` → `calculateMovingAverage`) and GRN owner decline
    (`declineGRNByOwner` → `reverseMovingAverage`);
  - FG receipt (`receiveFG` → `calculateMovingAverage`) and material issue
    (`issueMaterials`);
  - manual stock adjustment (`createStockAdjustment`);
  - vendor return (`processReturn` → `reverseInventoryValue`);
  - van load (`loadVan`, out) and van reconcile (`recordVanReconcile`, the
    counted units back in);
  - field retur approve (`approveFieldReturn`, sellable qty back into main —
    the warehouse receipt before it moves only `StoreStock`);
  - marketplace sales-return accept (`acceptReturnItem`, `ERP_RETURN_ACCEPT`);
  - the fabric-aggregate re-derive inside opname (`syncFabricAggregateQty`);
  - the UMKM opening-stock script (`applyUmkmManifest`, run from
    `apps/web/scripts/reconcile-umkm-opening-stock.ts`);
  - the superseded-item retirement (`retireSupersededItem`, run from
    `scripts/retire-superseded-items.mjs`) — nothing to push, since a retired item is unmapped;
  - putus delivery (`consumeFieldSalesOrderPartial`) and the konsi transfer at
    shipment completion (`issueKonsiTransfer`) — both decrement on-hand AND the
    matching field-sales hold by the same qty, so they leave the pushed figure
    unchanged.

  The field-sales reservation writers change `offlineReserved`, and with it
  the pushed figure, without moving on-hand: putus order create
  (`reserveFieldSalesOrder`), konsi approve and the admin konsi push
  (`reserveKonsiFieldSalesOrder`, through `approveKonsiOrderInTx`), reject
  (`rejectFieldSalesOrder` → `releaseFieldSalesOrder`) and close-remainder
  (`closeFieldSalesOrderRemainder` → `releaseFieldSalesOrder`). None of them
  pushes either. Before cutover that is the correct outcome, because Jubelio is
  the source of truth; after cutover these two lists are what the automatic
  push has to cover.
- **api** writes `InventoryValue` and `StockAdjustment` when the Jubelio
  `stock` webhook arrives (applying the contract above through
  `applyJubelioStockAdjustment`, `source = JUBELIO_WEBHOOK`), and when the
  salesorder ship webhook calls `consumeOrder`.
- **Stock reconciliation — web-owned and shipped (D5).** `runReconciliation`
  (`apps/web/lib/inventory/reconciliation-runner.ts`) runs every 6 h from the
  in-process node-cron and on demand from `/backoffice/inventory/reconciliation`.
  It reads Jubelio's `end_qty` through the signed `GET /jubelio/inventory/snapshot`
  on apps/api, which pages through every item group and returns `null` for a
  variant it has no usable figure for, and compares by the contract above; a
  `null` row is FLAGGED and never corrected. Prod runs `FLAG_ONLY`, which
  is right until cutover. A `MATCH_JUBELIO` correction writes a
  `StockAdjustment` stamped `source = JUBELIO_RECONCILE` and SETS on-hand
  through `setMainStock` (`refType: "Reconciliation"`) on a row it locked
  first; the manual resolve re-reads that one item group live through
  `GET /jubelio/inventory/snapshot/group/:groupId` (the id in the path — a
  query string fails the signed channel) and refuses, writing nothing, when
  the live figure is missing or invalid or Elorae's stock moved since the run. `MATCH_JUBELIO` is the correct manual-resolution
  direction today. `REASSERT_ELORAE` enqueues a push instead and must not be
  used before cutover.
- **`StockReservation` ledger writes** (resolved 2026-07-02, D6): api's
  `SalesOrderWebhookHandler` calls `reserveOrder` on ingest, `consumeOrder`
  on the ship webhook and `releaseOrder` on cancel or on a return that was never
  consumed; web's Ship button calls
  `consumeOrder` through the fulfillment writer. A future web-side cancel action
  can call `releaseOrder` safely (idempotent). These helpers, with the
  field-sales ones listed above, live in `@elorae/db/reservation-writer.ts` and
  are the sanctioned writers of `StockReservation` and
  `InventoryValue.reservedQty` — with ONE documented exception,
  `issueKonsiTransfer`, which decrements `reservedQty` and draws the konsi
  reservation down beside its own `moveMainStock` at shipment completion.
  `consumeOrder` also writes `StockAdjustment` (`source = FULFILLMENT_CONSUME`)
  to deduct `qtyOnHand` at ship time — see D6 in §9.

`StockAdjustment.source` is a free-form `String` column but the allowed values
are codified in the registry `packages/db/src/stock-adjustment-source.ts`
(`@elorae/db/stock-adjustment-source`). All callers MUST use
`satisfies StockAdjustmentSource` to compile-check the string. Audit dashboard
filters and reconcile-cron logic key off the exact values.

Allowed values today: `ERP`, `ERP_OPNAME`, `ERP_RETURN_ACCEPT`,
`FULFILLMENT_CONSUME`, `FIELD_SALES_CONSUME`, `JUBELIO_WEBHOOK`,
`JUBELIO_RECONCILE`, `VAN_LOAD`, `VAN_RETURN`, `SUPERSEDED_ITEM_RETIRE`. Two live writers do NOT follow
the rule yet: `issueKonsiTransfer` writes `KONSI_TRANSFER` and
`approveFieldReturn` writes `FIELD_RETURN`, neither in the registry nor
checked with `satisfies` — logged in `docs/FOLLOWUPS.md`.

To add a new source, see [INTEGRATION-GUIDE §2](./INTEGRATION-GUIDE.md).

### 3.5 `AdminNotification` writes — two writers

- **api** writes integration alerts: token-refresh failure, outbox DLQ growth,
  rate-limit exhaustion, webhook signature failure. (✅ shipped where helpers
  exist.)
- **web** writes ERP-detected alerts; the live categories are the entries in
  `CATEGORY_PERMISSION` (`apps/web/lib/notifications/admin-fanout.ts`), and the
  §3 table row names them. Negative-available stock and opname variance over
  threshold are still ⏳ planned. Shipped among them: AR overdue (`AR_OVERDUE`);
  and the konsi sell-through discrepancy alert, shipped with the konsi count
  schedule for AUTO-created reports only — a report created automatically after
  a full count is announced as `KONSI_REPORT_HELD` when lines await a
  resolution, beside `KONSI_REPORT_READY` and `KONSI_REPORT_BLOCKED`, while a
  report created by hand that holds lines announces nothing; and the monthly
  count raises `KONSI_COUNT_DUE` and `KONSI_COUNT_OVERDUE` (✅ shipped).

No shared writer helper exists or is mandated — the table is simple. The web
call sites have accumulated: each creates its row directly and fans it out
through `fanOutAdminNotification` (`apps/web/lib/notifications/admin-fanout.ts`).
Lifting the create into a `@elorae/db/admin-notification-writer.ts` helper
remains an option.

### 3.6 Single-owner web tables — default rule

Any table not enumerated in this section is **single-owner web**. This includes
all ERP-only tables introduced by upcoming EPICs (finance/CoA, journal, AR,
field sales, settlement, retur management, etc). The enumeration here is
**Jubelio-touching tables only**. New tables that *do* touch Jubelio (push or
ingest) must be added to §3 explicitly.

### 3.7 `SalesHistory` — certified Excel demand (web-owned, 2026-06-24)

`SalesHistory` is **Excel-only certified demand** for S&OP forecast and reconciliation.
It is never populated from `SalesOrder` or Jubelio webhooks.

- **web** writes all rows via `executeSalesHistoryImport` (`apps/web/lib/forecast/import-sales-history.ts`).
- At import, each row is resolved through `marketplace-sku-resolver` (same heuristics as `umkm-sku-bridge`): `itemId`, `erpVariantSku`, `jubelioItemId`, `resolutionStatus` (`MAPPED` / `UNMAPPED` / `AMBIGUOUS`).
- Unmapped rows remain in `SalesHistory` and still contribute to forecast demand (grouped by `parentSku`).

**Reconciliation (read-only report):** `apps/web/lib/sales/sales-reconciliation.ts` compares aggregated Excel `SalesHistory.netQuantity` vs Jubelio `SalesOrderItem.qty` for a channel + calendar month. Default strategy is **B-Aggregate** (per item / period totals). Line-level matching requires a verified marketplace order key (`channelOrderId`) — not shipped until Gate 2 confirms the field.

**Stock non-goal:** Excel import and sales reconciliation **do not** write `InventoryValue`, `StockAdjustment`, or any stock ledger. Operational stock mutations from marketplace sales flow only through Jubelio `SalesOrder` ingest + fulfillment.

### 3.2 Sales writes — dual-writer (as of 2026-06-14)

`SalesOrder` is now dual-writer, split by column:

**api-owned columns** (written by `SalesOrderWebhookHandler.upsertSalesOrder` on every Jubelio webhook):

- All marketplace metadata: `channel`, `sourceName`, `salesorderNo`, etc.
- Status (raw + derived): `channelStatus`, `internalStatus`, `wmsStatus`, `status`, `isCanceled`, `isPaid`, `markedAsComplete`.
- Buyer + shipping snapshot: `customerName`, `customerPhone`, `customerEmail`, `shippingProvince`, `shippingCity`, `shippingAddress`.
- Totals + fees: `subTotal`, `totalDisc`, `totalTax`, `shippingCost`, `grandTotal`, `feeBreakdown`.
- Timestamps from Jubelio: `transactionDate`, `createdDateJubelio`, `completedDate`, `cancelDate`, `lastModifiedJubelio`, `paymentDate`.
- `trackingNumber`, `courier`, `paymentMethod`, `lastWebhookEventId`.

**web-owned columns** (written EXCLUSIVELY via `@elorae/db/sales-order-fulfillment-writer` — never bare prisma):

- `fulfillmentStatus` (with api forward-sync exception — see below)
- `pickedAt`, `pickedById`
- `packedAt`, `packedById`
- `shippedAt`, `shippedById` (with api forward-sync exception — see below)
- `shipmentJubelioId`
- `courierId`

The writer helper enforces the state machine (PENDING → PICKED → PACKED → SHIPPED, no skip, no reverse) and enqueues a `JubelioOutbox` row per transition in the same transaction. Web bare-prisma writes to any fulfillment column are a contract violation.

**api forward-sync exception (added 2026-06-14):** `SalesOrderWebhookHandler.upsertSalesOrder` MAY advance `fulfillmentStatus → SHIPPED` and stamp `shippedAt` when the inbound Jubelio salesorder webhook reports the order shipped (any of `wms_status === "SHIPPED"`, `is_shipped === true`, `marked_as_complete === true`, or `completed_date` present). The advancement is:

- **Forward-only.** Guarded by `where: { fulfillmentStatus: { not: "SHIPPED" } }` — never overwrites an existing SHIPPED audit set by the writer helper (preserves `shippedById` + original `shippedAt`).
- **No `shippedById` write.** When advanced via webhook, `shippedById` stays null (no user clicked Ship). UI distinguishes "Shipped at … by NAME" vs "Shipped at …" accordingly.
- **No intermediate cascade.** `pickedAt`/`pickedById`/`packedAt`/`packedById` are NOT backfilled when the webhook arrives directly at SHIPPED — they stay whatever the web writer last set (likely null if the order shipped externally).
- **Why:** prevents drift between Jubelio-reported `status = SHIPPED` and Elorae-internal `fulfillmentStatus = PENDING/PICKED/PACKED` when operators ship from Jubelio admin UI, the marketplace auto-ships, or any external WMS performs the action.

`SalesOrderItem` remains api-only — web never writes line items.

### 3.3 `Item` writes — two writers (resolved 2026-05-25)

`Item` has an `ItemSource` discriminator column:

- `ERP` — row created/edited via apps/web (ERP forms, GRN receive-new-SKU).
  Default on `INSERT`.
- `JUBELIO_INGEST` — row created/edited by apps/api catalog ingest.

**api** writes `Item` only through the shared helper
`@elorae/db/item-writer.ts` (`createItemFromIngest`, `updateItemFromIngest`).
The helper stamps `source = JUBELIO_INGEST` automatically. Direct
`prisma.item.create` / `prisma.item.update` from apps/api is still forbidden
(§7).

**web** continues to use `prisma.item.*` directly; rows default to
`source = ERP`. Migrating web call sites to an `ErpItemWriter` helper is a
future cleanup, not a prerequisite for ingest.

Backfill in migration `20260525100000_add_item_source`: any pre-existing row
joined to `JubelioProductMapping` was set to `JUBELIO_INGEST`; all others
default to `ERP`.

**Conflict policy:** none yet. If both services edit the same item
near-simultaneously, last-write-wins. Add a policy in the helper when a real
collision case appears (low probability; ingest is push-button, not
continuous).

---

## 4. Communication patterns

### 4.1 `web → api` (sync, low-volume) — ✅ shipped

User-facing flows where api must respond inline.

- Use cases: "Push catalog now" button, fetch WMS list for UI, fetch Jubelio
  token state, manual sync trigger, signed `GET /jubelio/inventory/snapshot`
  (D5).
- Auth: HMAC-signed internal channel, not NextAuth JWT — see §5. Web signs
  each request via `signInternalRequest()` in `apps/web/lib/internal-api.ts`;
  api verifies via the global `InternalSignGuard`.
- Latency budget: 200 ms guard at gateway. Errors surfaced to user.

**Current state:** all api endpoints are gated by `InternalSignGuard`
(registered globally via `APP_GUARD` in `apps/api/src/auth/auth.module.ts`),
except `health.controller.ts` and `webhooks.controller.ts` which opt out via
`@Public()`. See D16.

### 4.2 `web → api` (async, write-coupled via outbox) — ✅ shipped

ERP action commits local write **and** `JubelioOutbox` row in one Prisma
transaction. api outbox poller + router + handlers drain. See
[INTEGRATION-GUIDE §1](./INTEGRATION-GUIDE.md) for the call-site recipe.

- **Idempotency key:** `${entityType}:${entityId}:${version}` — Jubelio call
  must accept this key (or be naturally idempotent).
- **No sync HTTP call** from a Prisma transaction. Always outbox.
- **Already-in-state Jubelio responses** are skipped (not retried) — see
  `OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE`. Detection is a phrase match on
  the response body, in `outbox/handlers/already-in-state.ts`, because Jubelio
  returns these as a generic HTTP 500 with the reason in free text rather than as
  a status code. This contract was **unmet in code** from the pick/pack/ship slice
  until 2026-09-02 (the handlers tested for a marker nothing ever set); see
  `docs/ARCHITECTURE-NOTES.md`.

#### 4.2.1 `entityType` registry

The canonical list lives in `packages/db/src/jubelio-outbox.ts` and is
exported via `@elorae/db/jubelio-outbox`. Every web insert and every api
router branch MUST be typed against `JubelioOutboxEntityType`. The router has
an exhaustiveness guard (`const _exhaustive: never = entityType`) — adding a
new value to the registry without a handler is a compile error, not a runtime
silent drop.

Current values: `stock_push`, `product_push`, `salesorder_pick`,
`salesorder_pack`, `salesorder_ship`.

To add: append to the registry array, run `pnpm -F @elorae/db build`, add a
handler under `apps/api/src/jubelio/outbox/handlers/`, wire the router case,
register in the Nest module, add a `.spec.ts`. See
[INTEGRATION-GUIDE §1](./INTEGRATION-GUIDE.md).

### 4.2.2 `web → api` (async, long-running job) — ✅ shipped (bulk migration)

For jobs that take minutes (e.g. the initial bulk data migration), web triggers via
a server action that batch-inserts `JubelioOutbox` rows. Progress is observed
by polling the outbox status grouped by `enqueuedById` + `createdAt` window.
No separate job-state table required when the outbox itself models the unit
of work.

### 4.3 `api → web` (rare) — ⏳ planned

Only for cache invalidation:
- `POST /api/internal/revalidate` with `{ paths: string[] }`.
- Auth: shared `INTERNAL_API_KEY` header (env), **not** user JWT.

Avoid otherwise. Prefer api owning its own data and web fetching from api.

### 4.4 Jubelio → api (webhooks) — ✅ shipped

- Path: `POST /webhooks/jubelio/:event` (events: `salesorder`, `stock`,
  `salesreturn`, `product`).
- Verify Jubelio signature header `Sign`:
  `HMAC-SHA256(data=rawBody + secret, key=secret)` (per Jubelio's Node.js
  example — the docs *text* says "SHA256" but the code uses `CryptoJS.HmacSHA256`).
- Persist raw payload to `JubelioWebhookEvent` table, ack 200 immediately,
  process asynchronously via BullMQ queue.
- Idempotency: dedupe by Jubelio's `event_id` (or hash of payload if missing).
- Jubelio retries non-200 responses up to 3 times — return 200 quickly even
  when payload processing is deferred to the queue.

### 4.5 Scheduled jobs — cron home rule

When a scheduled job needs to read from Jubelio or call Jubelio, it lives in
**apps/api**. Web cron does not have access to the Jubelio token cascade and
must not be tempted to import the api's Jubelio HTTP client.

When a scheduled job is pure-ERP (no Jubelio touch — e.g. nightly settlement
parser, AR aging recomputation, FCM cleanup), it lives in **apps/web** via
in-process **node-cron** (`apps/web/lib/cron/jobs.ts`, registered from
`instrumentation.ts` on server boot), calling a server action. Vercel cron was
the original home and is gone — Vercel was decommissioned 2026-06-18 and both
services now run as long-lived processes on the VPS, which is what makes an
in-process scheduler viable at all. Some jobs also keep a matching `/api/cron/*`
route as a manual smoke-test trigger, but not all of them do, and such a route
is never what fires the job in normal operation.

Cross-service writes from scheduled jobs use the same `@elorae/db` helpers as
on-demand writes. An api cron that writes a web-owned table goes through the
helper. The stock reconciliation is the notable exception to the home rule
above, by decision (D5): it reads Jubelio, yet it runs in **apps/web**, because
it only needs Jubelio's figures, which api serves through the signed
`GET /jubelio/inventory/snapshot`; its correction goes through `setMainStock`,
stamping `source = JUBELIO_RECONCILE`.

### 4.6 External integrations beyond Jubelio — punted

Some upcoming EPICs touch external systems other than Jubelio:

- e-Faktur (DJP)
- Bank reconciliation APIs (future)

Today these are scoped as **manual entry only** — no automation. When the
first automated external integration lands, choose between (a) extending
apps/api with a new module per external system, or (b) splitting into a new
`apps/integrations` service. Decision deferred until the first concrete EPIC
plan exists.

---

## 5. Auth model

| Endpoint type           | Mechanism                                              | State |
| ----------------------- | ------------------------------------------------------ | :---: |
| api: user-facing        | HMAC-signed internal channel (`InternalSignGuard`, global `APP_GUARD`) — see D16 | ✅ |
| api: webhook receivers  | Jubelio `Sign` header (HMAC-SHA256 scheme, `@Public()`) | ✅ |
| api: internal (web→api) | `InternalSignGuard` — HMAC-SHA256 over method+path+userId+rawBody, keyed by `INTERNAL_API_SECRET` (headers `x-internal-sign`/`x-user-id`), `timingSafeEqual` compare | ✅ |
| api → web revalidate    | Shared `INTERNAL_API_KEY` (env, rotated quarterly)     | ⏳ |
| api: `/docs`            | HTTP Basic (`SWAGGER_USER`/`SWAGGER_PASS`) — disabled if env missing | ✅ |

- Permission constants live in `@elorae/types/erp/permissions` (⏳). Both services
  import them. No duplication.
- RBAC matrix in `apps/web/lib/rbac.ts` is the single source. api imports it
  via `@elorae/types` re-export (⏳).

**Current state:** all `apps/api` routes are gated by `InternalSignGuard`,
registered globally via `APP_GUARD` in `apps/api/src/auth/auth.module.ts`.
Only `health.controller.ts` and `webhooks.controller.ts` opt out via
`@Public()`. Shipped 2026-05-28 (commit `188752f`) — see D16.

---

## 6. Failure modes

| Failure          | Behaviour                                                                                          | State |
| ---------------- | -------------------------------------------------------------------------------------------------- | :---: |
| api down         | web ERP fully functional. `JubelioOutbox` accumulates. No data loss. Drains on api restart.        | ⏳ requires outbox |
| Jubelio down     | api outbox retries with backoff. UI shows "N items pending Jubelio sync" indicator.                | ⏳ requires outbox |
| web down         | api still ingests Jubelio webhooks and persists. Outbox idle (no producers).                       | ⏳ requires webhooks |
| DB down          | Both services 500. Standard.                                                                       | ✅ |
| Outbox stuck     | Alert when `PENDING + FAILED > threshold` for `> X min`. Manual replay tool in api admin.          | ⏳ |
| Webhook replay   | Dedup by `event_id` in `JubelioWebhookEvent`. Safe to replay.                                      | ⏳ |
| Token expired    | api auto-refreshes within 5 min of expiry (on demand). Single-flight refresh per process. Hourly `@Cron` prewarm + exponential backoff + `AdminNotification` on persistent failure. | ✅ |
| Schema drift     | Migrations run only via `@elorae/db`. CI blocks PRs that add migrations elsewhere.                 | 🟡 convention enforced socially; ⏳ CI guard |

---

## 7. Anti-patterns

- ❌ api importing from `apps/web/lib/*`. Circular dependency, blurs boundary.
  If logic must be shared, lift into `packages/types` or new `packages/*`.
- ❌ web calling Jubelio directly via `fetch('https://api2.jubelio.com')`.
- ❌ Two services running `prisma migrate`. Only `@elorae/db` runs migrations.
  Both apps run `prisma generate` only.
- ❌ Duplicating Zod schemas. Define once in `@elorae/types`.
- ❌ Writing to a table not listed in §3 without updating this doc first.
- ❌ Sync HTTP call from ERP server action to api inside a Prisma transaction.
  Always outbox.
- ❌ api writing to `User`, `Role`, `Permission`, `GRN`, `PO`, or any table
  marked web-owned. `Item` is dual-owned (§3.3) — api writes **only** via
  `@elorae/db/item-writer.ts` helpers, never `prisma.item.create/update`
  directly.
- ❌ Hardcoding `JubelioOutbox.entityType` or `StockAdjustment.source` strings
  (including `FULFILLMENT_CONSUME`) without `satisfies` against the registry
  types. A typo becomes a silent runtime drop — the router skips with
  `unknown_entity_type:…`. See §4.2.1 and §3.1.
- ❌ Moving a stock QUANTITY — `InventoryValue.qtyOnHand`, `StoreStock.qty`,
  `VanStock.qty` — via bare `prisma.*.update/upsert/create`. Always go through
  a mover in `packages/db/src/stock-balance.ts`, which moves the balance and
  appends the `StockLedgerEntry` in one transaction; a direct write leaves the
  movement invisible to the ledger, which is the table the read side now
  trusts — `/backoffice/inventory/movements` and the store detail card both
  render straight from it, so a skipped append is a movement an operator
  cannot see happened. `apps/web/lib/inventory/stock-balance-guard.test.ts` fails the suite
  on any such write it can see (it greps Prisma model calls, so raw SQL is
  invisible to it) and carries the documented `ALLOWED` exemptions. Creating a
  row at quantity 0 is provisioning, not a movement, and is exempt.
- ❌ Writing `StockReservation` rows or `InventoryValue.reservedQty` via bare
  `prisma.stockReservation.*` / `prisma.inventoryValue.update`. Always go
  through the helpers in `@elorae/db/reservation-writer.ts` — see D6. The one
  documented exception is `issueKonsiTransfer`, which draws a konsi reservation
  down beside its own `moveMainStock`; it is not a precedent. A reservation is
  NOT a stock movement: it writes no ledger entry, which is exactly why it is a
  separate rule from the one above rather than covered by it.
- ❌ Subtracting `reservedQty` from anything sent to, or compared against,
  Jubelio's `end_qty` — including "fixing" the push to send `available`.
  `end_qty` is on-hand and Jubelio already nets its own marketplace orders
  (`order_qty`), so `reservedQty`, which includes those same orders, takes
  them off twice. Only the field-sales holds (`offlineReserved`) are
  subtracted on the way out and added back on the way in — §3.1.
- ❌ Pushing Elorae stock to Jubelio before cutover — the bulk push, the
  per-item push, `REASSERT_ELORAE`. Until then Jubelio is the stock source of
  truth and `InventoryValue` a mirror of it (§3.1). The cutover switch
  refuses them while it is off; turning it on is the last cutover step.
- ❌ Calling `PUT /inventory/items/{id}/stock` anywhere but `StockPushHandler`,
  or adding a push path that does not enqueue `stock_push`. The handler is
  where the cutover switch is enforced, so any other path bypasses it (§3.1).
- ❌ Reusing marketplace `SalesOrder` for offline field-sales writes.
  Marketplace SO is api-owned and Jubelio-shaped; offline
  orders use the dedicated web-owned `FieldSalesOrder`/`FieldSalesOrderLine`
  model — see D8.
- ❌ Pre-filling a field retur's warehouse received qty from salesman claim. The
  acceptance criterion explicitly forbids it — warehouse independence is the
  whole point.
- ❌ Sync HTTP call to non-Jubelio external systems (DJP, payment gateway)
  from inside a Prisma transaction. Same rule as Jubelio (§4.2) — use
  outbox or job queue.

---

## 8. Monorepo migration — completion log

| # | Step | State |
| - | ---- | :---: |
| 1 | `git mv frontend apps/web` (drop `apps/web/prisma/` after step 2) | ✅ commits `01e2bb2`, `996d310` |
| 2 | Create `packages/db`; move `frontend/prisma/*` to `packages/db/prisma/` | ✅ `996d310` |
| 3 | Update `apps/web` imports of `@/lib/prisma` → `@elorae/db` (+ swap `@prisma/client` imports) | ✅ `996d310` |
| 4 | Remove `backend/` Go scaffold (throwaway) | ✅ `01e2bb2` |
| 5 | Wire NestJS at `apps/api` (hand-crafted, not `nest new`) — `PrismaModule`, `HealthModule`, `JubelioModule`, Swagger UI gated by Basic auth | ✅ `0758033`, `4d306da`, `a0526be` |
| 6 | `git mv jubelio reference/jubelio` (sample JSON + yaml + plans, gitignored) | ✅ `01e2bb2`, `885c8a0` |
| 7 | Add `pnpm-workspace.yaml`, `turbo.json`, root `package.json` | ✅ `e34d26d` |
| 8 | CI: block migrations outside `@elorae/db`; lint forbidden imports (`apps/api` → `apps/web`) | ⏳ |

Additional bring-up: prisma generator swapped to ESM (`prisma-client`),
`bootstrap-env.ts` loads `.env` before `AppModule` resolves `@elorae/db`, dev
script uses `nest start --watch --builder swc` (SWC honours
`emitDecoratorMetadata` which tsx/esbuild do not).

---

## 9. Decisions

| # | Topic | Decision |
| - | ----- | -------- |
| Q1 | Webhook signature | Jubelio uses `HMAC-SHA256(data=rawBody + secret, key=secret)`, hex-encoded. Header name: **`Sign`** (verified 2026-05-28 from real delivery and Jubelio's docs Node.js example). Note: Jubelio's docs *text* incorrectly says "SHA256" without mentioning HMAC — their code example is the source of truth. Secret configured in Jubelio dashboard (Pengaturan → Developer → Webhook). Rate limit: 600 req/min, 429 on exceed. Jubelio retries non-200 callbacks up to 3 times. |
| Q2 | Redis | **Upstash Redis** (managed). Free tier covers MVP. Used by BullMQ. |
| Q3 | api deployment | **Render** (persistent web service, Docker). |
| Q4 | Audit log writer | Shared helper in `@elorae/db` (e.g. `writeAuditLog()`). Single Prisma call site. Both services call it. |
| Q5 | `SystemSetting` namespace | api-owned keys prefixed `JUBELIO_*` (e.g. `JUBELIO_SESSION_TOKEN`). All other keys web-owned. Enforce in a small helper that rejects writes from the wrong owner. |
| D1 | Outbound queue | **BullMQ + Upstash Redis** (per Q2). All `apps/web` → `apps/api` async writes enqueued; `apps/api` workers drain. |
| D2 | Admin alert channel | **In-DB `AdminNotification` table.** Written by api on token-refresh failure, outbox-stuck, rate-limit hit, etc. Consumed by apps/web admin UI. Web may also write for ERP-detected alerts — see §3.5. |
| D3 | Admin dashboard | **Full UI in apps/web** at `/backoffice/jubelio/admin` — queue depth, failed items, audit log, outbox status, retry buttons. api exposes JSON endpoints; apps/web renders. |
| D4 | Local Redis | **Docker compose** (`redis:7-alpine`) declared in repo-root `docker-compose.dev.yml`. apps/api reads `REDIS_URL` env. Upstash used for staging/prod. |
| D5 | Stock reconciliation cron home | **apps/web owns orchestration + persistence.** A secret-guarded `POST /api/cron/reconciliation` (and in-process `node-cron` every 6h on VPS) calls `runReconciliation('CRON')` in web. Config lives in `SystemSetting` (`RECON_AUTO_CORRECT_THRESHOLD`, `RECON_AUTO_CORRECT_DIRECTION`, `RECON_CRON_ENABLED`). Launch posture: `FLAG_ONLY` + threshold 0. **apps/api** exposes signed `GET /jubelio/inventory/snapshot` (InternalSignGuard); web fetches Jubelio `end_qty` via `apiFetch`. Compares by the Jubelio stock contract (§3.1): Elorae `max(0, qtyOnHand − offlineReserved)` vs Jubelio `end_qty` while stock pushes are enabled, or raw `qtyOnHand` (can be negative) vs `end_qty` while they are off — both the holds and the floor apply only while pushes are enabled; a variant the snapshot has no figure for is FLAGGED, never compared as 0. A `MATCH_JUBELIO` correction writes `StockAdjustment` with `source = JUBELIO_RECONCILE` and SETS on-hand to `end_qty + offlineReserved` through `setMainStock` (ledger `refType = Reconciliation`; `StockMovement` is a frozen archive and gets nothing). FG-only scan (items with `JubelioProductMapping`). Overlap guard skips when a `ReconciliationRun` is already `RUNNING`. Until cutover `FLAG_ONLY` stays the setting, `MATCH_JUBELIO` is the manual-resolution direction, and `REASSERT_ELORAE` must not be used — Jubelio is the source of truth. |
| D6 | Reservation modeling | **Resolved.** `StockReservation` ledger — one row per `salesorderDetailId` (unique), `state: ReserveState { RESERVED, CONSUMED, RELEASED }` — plus an aggregate `InventoryValue.reservedQty` (Decimal, default 0) kept in sync by the ledger writes. Three order-level helpers in `@elorae/db/reservation-writer.ts`: `reserveOrder` (webhook ingest — creates ledger rows + bumps `reservedQty`, raises `AdminNotification` on oversell), `consumeOrder` (ship — flips `RESERVED → CONSUMED`, deducts `InventoryValue.qtyOnHand` via a `StockAdjustment` stamped `source = FULFILLMENT_CONSUME`), `releaseOrder` (cancel, or a return that was never consumed — flips `RESERVED → RELEASED`, decrements `reservedQty` without touching `qtyOnHand`). Idempotency: unique `salesorderDetailId` on create, and every transition is a conditional `updateMany WHERE state = 'RESERVED'` so the Jubelio ship webhook and the ERP Ship button can both fire — whichever lands first wins, the other is a no-op. Model: **reserve-at-ingest, consume-onHand-at-ship, release-on-cancel-or-return**; `available = qtyOnHand - reservedQty`, derived at read time (not stored), is the ERP's own selling figure. It is NOT what the Jubelio stock push sends: `stock-push.handler.ts` sends `max(0, qtyOnHand − offlineReserved)`, because Jubelio's `end_qty` is on-hand and Jubelio already nets these same marketplace reservations as `order_qty` (live-verified 2026-09-27; §3.1). The push sent `available` until then, which subtracted every marketplace order twice. |
| D7 | Warehouse scope on Jubelio stock push | **Push only main-warehouse stock — excluded by STRUCTURE, not by a subtraction.** Konsi stock lives in `StoreStock` and canvasser stock in `VanStock`, separate tables the push never reads, so no `virtualWarehouseQty` term exists or is needed: units leave `InventoryValue` when they move to a store or a van. The figure pushed is the Jubelio stock contract (§3.1): `end_qty = max(0, qtyOnHand − offlineReserved)`, the field-sales holds being the only subtraction. |
| D8 | Offline vs marketplace `SalesOrder` | **Resolved (2026-07-04, Taking Order (Putus) backend, PR #98)** — option (b), narrower: dedicated `FieldSalesOrder`/`FieldSalesOrderLine` model (not a generic `OfflineSalesOrder`), web-owned, item-level per D15. |
| D9 | Auto-journal trigger | **In-Prisma-TX helper, not outbox queue.** Financial debit=credit invariant cannot be eventually consistent. `withJournal()` helper in `@elorae/db` participates in source transaction. |
| D10 | External integrations beyond Jubelio | **Punted.** No automation today (e-Faktur, bank reconciliation are manual). First concrete automated integration EPIC reopens this decision. |
| D11 | Role/permission model | **Open.** Six new roles incoming (SALESMAN, SPG, CANVASSER, COLLECTOR, FINANCE, ADMIN_PAJAK). Migration path: keep `Role` enum for now; revisit when count exceeds ~10 or dynamic role grants become a requirement. |
| D12 | Bulk migration job control | **Outbox-as-job-state.** No separate job table. Progress = `groupBy(status) WHERE enqueuedById=… AND createdAt > windowStart`. Cancel = delete PENDING rows for that batch. (Shipped via PR #41.) |
| D13 | `JubelioOutbox.entityType` registry | **Single source: `packages/db/src/jubelio-outbox.ts`.** Web `satisfies` typed insert + api router `never`-exhaustive switch. Typos = compile error. (Shipped this PR.) |
| D14 | `StockAdjustment.source` registry | **Single source: `packages/db/src/stock-adjustment-source.ts`.** Same pattern as D13. (Shipped this PR.) |
| D15 | Putus/konsi order granularity | **SUPERSEDED (2026-07-17, PR #144) — field-sales putus/konsi is now PER-VARIANT.** ~~Originally item-level (order lines `variantSku = ""`, variantless `InventoryValue` row).~~ Reversed after confirming per-variant stock already exists on prod: `InventoryValue` is keyed `(itemId, variantSku)` and Jubelio-ingested variant items are stored **entirely per-variant** (real `variantSku` rows, no pooled row) — so the item-level PWA sell path (which sent `variantSku ""`) actually found no row for variant items → unsellable/oversell. Now: PWA catalog exposes per-variant availability (`CatalogItem.variants[]`); a variant sheet picks variants; order lines carry the **real** `variantSku`; reserve/consume/release (already per-line `variantSku`) hit the exact per-variant row → per-variant `StockReservation`/`reservedQty`. **Min-qty aggregates per item** (variants collectively meet the min); **promos aggregate per item then pro-rate** across variant lines (shared `applyItemAggregatedPromos` used by writer + preview so the quote == recorded order). **Simple items (no `Item.variants`) stay item-level** — `variants: []`, inline stepper, cart line `variantSku ""` (the null/"" bucket + tolerant lookup preserved). No schema migration (schema was already per-variant). **Canvassing (van load/sale/reconcile) is ALSO per-variant — Track B, PR #146 (2026-07-23):** `VanStock` + van docs keyed `(userId, itemId, variantSku)`; the backoffice load form picks per-variant (one item block → its in-stock variants, 0-available hidden), the PWA van sell screen groups by item + opens a variant sheet, and sale/reconcile stamp the variant label into `productName`. No schema migration (van tables already had `variantSku`). Van stock has no reservation dimension, so this is purely a key change; simple items stay item-level (`VanStock` keyed `""`). Caveat: a variant item restocked via ERP GRN/production writes a `null` pooled row the per-variant sale won't see (only matters if variant items are ERP-received; Jubelio feeds them per-variant). |
| D16 | Cross-service auth bridge (§4.1, §5) | **Resolved (shipped 2026-05-28, commit `188752f`) — pivoted from the original plan.** Original plan was NextAuth-JWT forwarding (web signs a `Bearer <jwt>` with shared `NEXTAUTH_SECRET`, api verifies). Shipped instead as an **HMAC-signed internal channel**: `apps/web/lib/internal-api.ts` (`signInternalRequest`) computes `HMAC-SHA256(method+path+userId+rawBody)` keyed by `INTERNAL_API_SECRET`, sent as `x-internal-sign`/`x-user-id` headers; api's `InternalSignGuard` (`apps/api/src/auth/internal-sign.guard.ts`) verifies with `timingSafeEqual` and is registered globally via `APP_GUARD` in `apps/api/src/auth/auth.module.ts`. Only `health.controller.ts` and `webhooks.controller.ts` opt out via `@Public()`. Simpler than JWT forwarding — no shared session-secret coupling, no token expiry to juggle for service-to-service calls. |
| D17 | Stock source of truth, and what Jubelio's quantities mean | **Jubelio is the stock source of truth until cutover; Elorae's `InventoryValue` mirrors it.** The client operates on Jubelio today, so Jubelio → Elorae (the `stock` webhook, reconciliation `MATCH_JUBELIO`) must be right now, while Elorae → Jubelio pushes (bulk, per-item, `REASSERT_ELORAE`, post-opname) overwrite the source of truth with an untrusted mirror and are to be avoided until go-live; reconciliation stays `FLAG_ONLY`. Quantities (live-verified 2026-09-27): `end_qty` is on-hand, `order_qty` is Jubelio's own open marketplace orders, `available_qty = end_qty − order_qty`. Push `max(0, qtyOnHand − offlineReserved)`, apply `end_qty + offlineReserved`, where `offlineReserved` is the open non-`JUBELIO` `StockReservation` qty — never subtract `reservedQty`. The field-sales add-back (webhook, `MATCH_JUBELIO`) and the comparison's subtraction AND floor at 0 apply only while stock pushes are enabled, because only a push nets the holds out of `end_qty` and only a push floors at 0 — while pushes are off the comparison uses raw `qtyOnHand` (can be negative). Helpers in `packages/db/src/jubelio-stock-contract.ts`; full entry in `docs/landmines/jubelio.md`. **Pushes are gated by the cutover switch** `JUBELIO_STOCK_PUSH_ENABLED` (fail-closed; only `"true"` enables): `StockPushHandler` skips every `stock_push` row with `stock_push_disabled` while it is off, the web refuses first where it can, and skipped rows are not replayed. Enabling it on `/backoffice/jubelio/admin` (admin only, audited) is the last cutover step, after the recount, immediately followed by a bulk push. Every push path goes through `stock_push`; nothing calls `PUT /inventory/items/{id}/stock` outside that handler (§3.1). |
