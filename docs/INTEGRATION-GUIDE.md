# Integration Guide — Jubelio-touching Surface

> Read this BEFORE writing any code that touches Jubelio data, the outbox, or stock adjustments. It tells you which helpers to call, which strings are allowed, and what the boundary owners enforce.

Audience: ERP module developers building returns, stock opname + reconciliation, reservations, warehouses, and anything else that crosses into Jubelio territory.

For the why (architectural decisions, ownership rules, anti-patterns), see [BOUNDARY.md](./BOUNDARY.md). This file is the how.

---

## TL;DR — the four rules

1. **Never call Jubelio directly.** Enqueue a `JubelioOutbox` row from `apps/web`. The api drains it.
2. **Never invent an outbox `entityType` string.** Use the registry from `@elorae/db` (`JubelioOutboxEntityType`, source file `packages/db/src/jubelio-outbox.ts`). Add new types there first, then everywhere else.
3. **Never invent a `StockAdjustment.source` string.** Use the registry from `@elorae/db` (`StockAdjustmentSource`, source file `packages/db/src/stock-adjustment-source.ts`). Audit dashboards and reconcile logic key off these.
4. **Never write to web-owned tables from apps/api (and vice versa) without going through a `@elorae/db` helper.** See [BOUNDARY.md §3](./BOUNDARY.md).

If a workflow doesn't fit, raise the question in the spec/plan PR. Don't bend the rules in code.

---

## 1. Enqueueing a Jubelio push from the ERP

### Pattern

1. Decide which `entityType` covers your push. Pick from `JUBELIO_OUTBOX_ENTITY_TYPES` in `packages/db/src/jubelio-outbox.ts`.
2. Insert a `JubelioOutbox` row in `apps/web` (server action). The row carries `entityType`, `entityId`, optional `payload` JSON, and the user who triggered it.
3. (Optional) Fire `apiFetch("POST", "/jubelio/outbox/enqueue/{id}", …)` for low-latency dispatch. If it fails, the outbox poller picks it up within ~5 s.
4. The api `OutboxRouter` matches `entityType` and dispatches to the handler. Handler talks to Jubelio.

### Code

```ts
// apps/web/app/actions/your-feature.ts
"use server";

import { prisma } from "@elorae/db";
import type { JubelioOutboxEntityType } from "@elorae/db";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/internal-api";

export async function enqueueMyPush(entityId: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session) return { ok: false };

  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: "stock_push" satisfies JubelioOutboxEntityType,
      entityId,
      payload: {},
      enqueuedById: session.user.id,
    },
    select: { id: true },
  });

  void apiFetch("POST", `/jubelio/outbox/enqueue/${row.id}`, {
    userId: session.user.id,
  }).catch(() => {
    // poller picks it up within ~5 s
  });

  return { ok: true };
}
```

The `satisfies JubelioOutboxEntityType` makes typos a compile error, not a silent drop. If you remove the annotation and pass `"stoc_push"`, the api router will skip the row with reason `unknown_entity_type:stoc_push` and you'll wonder why nothing pushed.

### Adding a new `entityType`

If your feature needs a push type that doesn't exist yet (e.g. `salesreturn_decision_push`):

1. Add the string to `JUBELIO_OUTBOX_ENTITY_TYPES` in `packages/db/src/jubelio-outbox.ts`.
2. Run `pnpm -F @elorae/db build`.
3. Add a handler file under `apps/api/src/jubelio/outbox/handlers/<your-type>.handler.ts` implementing `OutboxHandler`. Mirror `salesorder-pick.handler.ts` for shape.
4. Wire it in `apps/api/src/jubelio/outbox/outbox-router.ts` — add a case branch. The exhaustiveness check (`const _exhaustive: never`) will compile-fail until you do.
5. Register the handler in `jubelio-outbox.module.ts`.
6. Add a `.spec.ts` for the handler. Mock the Jubelio HTTP client.

The compile error from the router's `never` check is the safety net: you cannot ship a new outbox type without a handler.

---

## 2. Writing a `StockAdjustment` from the ERP

### Which `source` do I use?

| Source value | When to use | Owner |
|---|---|---|
| `ERP` | Manual stock adjustment via ERP UI (existing flow). | web |
| `ERP_OPNAME` | Stock opname session approval. | web |
| `JUBELIO_WEBHOOK` | Inbound Jubelio stock-changed webhook, applying `end_qty + offlineReserved` as on-hand, the holds added only while stock pushes are enabled (§4.2). **Do not call from web — only `apps/api`.** | api |
| `JUBELIO_RECONCILE` | A `MATCH_JUBELIO` correction from stock reconciliation — the 6h cron or a manual resolve on `/backoffice/inventory/reconciliation`. | web (`reconciliation-runner.ts`; api only serves the snapshot read) |
| `SUPERSEDED_ITEM_RETIRE` | Zeroing a superseded catalog item's stock rows — an unmapped item whose every variant is mapped on another item (`retireSupersededItem`, run from `scripts/retire-superseded-items.mjs`). | db helper, run as an ops script |
| `ERP_RETURN_ACCEPT` | Accepting a marketplace return line that puts stock back (`acceptReturnItem` in `packages/db/src/sales-return-writer.ts`, reached through `app/actions/sales-return-decision.ts`). | db helper, called from web |
| `FULFILLMENT_CONSUME` | Consuming a Jubelio order's reservation when the order ships (`consumeOrder` in `packages/db/src/reservation-writer.ts`, called by `salesorder.handler.ts`). | db helper, called from api |
| `FIELD_SALES_CONSUME` | Consuming a putus field-sales order's reservation at delivery (`consumeFieldSalesOrderPartial` / `consumeFieldSalesOrder` in `packages/db/src/reservation-writer.ts`; the partial one is called by `lib/field-sales/delivery/writer.ts`). | db helper, called from web |
| `VAN_LOAD` | Loading main stock onto a canvasser's van (`loadVan` in `lib/canvassing/writer.ts`). | web |
| `VAN_RETURN` | Returning counted van stock to main at van reconcile (`recordVanReconcile` in `lib/canvassing/reconcile-writer.ts`). | web |
| `KONSI_TRANSFER` | Moving konsi stock from main to the store when a delivery shipment completes (`issueKonsiTransfer` in `lib/field-sales/konsi-transfer/writer.ts`). | web |
| `FIELD_RETURN` | Restoring the sellable quantity of an approved field retur to main (`approveFieldReturn` in `lib/field-sales/retur/approve-writer.ts`). | web |

If your use case doesn't fit any of these, add to the registry first (see "Adding a new `source`" below). Do not pick the closest match and hope for the best — the reconcile logic and audit dashboards key off the exact string.

### Code (ERP-side, e.g. opname)

```ts
import { prisma, setMainStock } from "@elorae/db";
import type { StockAdjustmentSource } from "@elorae/db";
import type { AdjustmentType } from "@elorae/db";
import { findExistingInventoryValueRow } from "@/lib/inventory/costing";

const opnameSource = "ERP_OPNAME" satisfies StockAdjustmentSource;

await prisma.$transaction(async (tx) => {
  // OR-tolerant + tie-broken: a variantless row keys on null OR "". See the notes below.
  const inv = await findExistingInventoryValueRow(tx, itemId, variantSku);
  if (!inv) throw new Error(`no InventoryValue row for ${itemId}`);

  await tx.stockAdjustment.create({
    data: {
      docNumber,             // unique; format per your feature
      itemId,
      type: delta >= 0 ? "POSITIVE" : "NEGATIVE",
      qtyChange: delta,
      reason,
      prevQty,
      newQty,
      prevAvgCost: avgCost,
      newAvgCost: avgCost,
      source: opnameSource,
      idempotencyKey,        // critical — collisions are silently skipped
      // externalRef only when there's an upstream system; otherwise omit
    },
  });

  // NEVER write InventoryValue directly. A balance move goes through a mover in
  // packages/db/src/stock-balance.ts, which moves the balance AND appends the StockLedgerEntry
  // in the same transaction. A guard test (apps/web/lib/inventory/stock-balance-guard.test.ts)
  // fails the suite on a direct write it can see.
  await setMainStock(tx, {
    itemId,
    variantSku,
    nextQty: newQty,          // an opname is an absolute COUNT — setMainStock, not moveMainStock
    totalValue: newQty * avgCost,
    unitCost: avgCost,
    inventoryValueId: inv.id, // pins the write to the row the lookup above resolved
    refType: "StockOpname",
    refId: opnameId,
    refDocNumber: docNumber,
    createdById: userId,
  });

  // Optional: enqueue a JubelioOutbox row to push the adjustment outbound
  // await tx.jubelioOutbox.create({ data: { entityType: "stock_push" satisfies …, … } });
});
```

**Three things that example is doing deliberately, each of which has broken something here.**

*Resolve the row first, and with `findExistingInventoryValueRow`.* A variantless `InventoryValue` row keys on `null` OR `""` — both legitimately, and one item can hold both — so a strict `findUnique` on the composite `itemId_variantSku` key misses a real row. That is the worst defect the stock-ledger branch produced: the strict read found nothing, `previousAvgCost` fell back to `0`, and the write then SET `avgCost` from that zeroed base, destroying the moving average on every receipt of a variantless item. No production read of a variantless row uses the strict form any more; `packages/db/prisma/seed.ts` and the spent `packages/db/prisma/backfill-reservations.ts` are the deliberate exceptions. The helper is also the only spelling carrying the `orderBy: { id: "asc" }` tie-break, which is what makes two callers over one dual bucket resolve the SAME row.

*Pass `inventoryValueId`.* OR-tolerance on the read is not enough on its own — without pinning, the mover re-resolves independently and can land on the other row of the bucket.

*Pick the mover that matches the shape of the change.* `setMainStock`/`setStoreStock` take an absolute `nextQty` and are for physical counts; `moveMainStock`/`moveStoreStock`/`moveVanStock` take a signed `qtyDelta` and apply it as an atomic increment, and are for everything else. Routing a count through the delta mover lands the row at `previous + delta` rather than the counted figure, and types the ledger entry `IN`/`OUT` where a count must be `ADJUSTMENT` — permanently, because the ledger is append-only. Never write an absolute quantity computed from a pre-read through the delta mover; `moveMainStock` also refuses a decrement that would cross zero, throwing `MainStockNegativeError`.

**Why a transaction.** `StockAdjustment`, `InventoryValue` and `StockLedgerEntry` must move together. If one succeeds and the others don't, the audit trail diverges from the actual on-hand and you'll see "Jubelio shows 100, ERP shows 98 but the audit log says we adjusted to 100" — exactly the kind of mismatch reconcile is supposed to catch, except now reconcile thinks they're aligned because the wrong row wrote. The movers append the ledger entry inside the caller's transaction for exactly this reason: it is never best-effort.

### Code (Jubelio webhook ingest, api-side)

Use the existing helper. Do not duplicate the logic.

```ts
// apps/api/...
import { applyJubelioStockAdjustment, parseJubelioQty, prisma } from "@elorae/db";

const endQty = parseJubelioQty(rawEndQty); // null for null, "", or anything invalid — skip it
const result = await applyJubelioStockAdjustment(prisma, {
  itemId,
  variantSku,
  jubelioEndQty: endQty, // the RAW Jubelio figure; the writer adds the holds back itself
  idempotencyKey,
  externalRef,
  reason,
});
if (result.skipped) {
  // idempotency collision — webhook replay; safe to ignore
}
```

Pass Jubelio's raw `end_qty`, validated with `parseJubelioQty` before any coercion — never `Number(raw)` first, because `Number(null)` and `Number("")` are both `0`. The writer locks the row as its transaction's first statement, then sets on-hand to `end_qty` plus the effective field-sales holds (the open holds while stock pushes are enabled, `0` while they are off) as an absolute through `setMainStock` — never `available_qty` — see §4.2.

### Adding a new `source`

1. Append to `STOCK_ADJUSTMENT_SOURCES` in `packages/db/src/stock-adjustment-source.ts`.
2. Write it at the call site as `"<SOURCE>" satisfies StockAdjustmentSource`, so a typo or an unregistered value is a compile error rather than a free-form string in the column.
3. Add it to the "Allowed values today" list in `docs/BOUNDARY.md` §3.1 and give it a row in the table above, naming its writer.
4. Run `pnpm -F @elorae/db build`.
5. Update audit dashboard filters if the source should appear in UI.
6. Update reconcile-cron logic if the source should be treated as authoritative or skippable (depends on whether your source represents a known divergence or an unrelated change).

---

## 3. Reading from Jubelio (cron, dashboard, ad-hoc)

**Web cannot call Jubelio directly.** No `JUBELIO_TOKEN` is provided to apps/web. The only path is via apps/api.

For now, two signed read endpoints ship on apps/api:

```
GET /jubelio/inventory/snapshot
GET /jubelio/inventory/snapshot/group/:groupId
```

Both are protected by `InternalSignGuard`, and both take their input in the PATH: the guard verifies `req.path`, which excludes the query string, while `apiFetch` signs the full path, so a query string always 401s (`apiFetch` throws on one).

- `/jubelio/inventory/snapshot` returns `{ rows: [{ itemId, variantSku, jubelioItemId, jubelioQty }] }` for all mapped FG variants. It pages through every item group of `GET /inventory/items/` (200 per page, with a page ceiling) and reads `end_qty` ONLY. `jubelioQty` is `null` when a mapped variant is on no page read or its `end_qty` is invalid — "no figure", never 0. Web reconciliation (`apps/web/lib/inventory/reconciliation-runner.ts`) records such a row FLAGGED and never corrects it.
- `/jubelio/inventory/snapshot/group/:groupId` returns `{ rows: [{ jubelioItemId, endQty }] }` for one item group, read live from `GET /inventory/items/group/{id}` (the endpoint the stock webhook trusts); `endQty` is `null` when invalid. The manual `MATCH_JUBELIO` resolve uses it and refuses, writing nothing, without a live figure for the variant.

Both compare by the §4.2 contract, never against raw `qtyOnHand − reservedQty`. Do not call Jubelio directly from web.

**Opname FG push:** on opname approval, adjusted FG items enqueue `stock_push` via `JubelioOutbox`, after the approval commits. Local `StockAdjustment` with `source = ERP_OPNAME` is never rolled back on push failure. While the cutover switch is off (§4.2) the api handler skips the row with `stock_push_disabled`, so nothing reaches Jubelio, the stock source of truth.

The endpoint contract:
- Authentication: `apiFetch` from web with NextAuth JWT (the existing internal-api signed channel). See `apps/web/lib/internal-api.ts`.
- Response: normalized JSON. Never raw Jubelio response — adapt at the api layer so web doesn't depend on Jubelio's shape.
- Rate limiting: api owns the Jubelio rate budget (600 rpm). Web callers must accept 429 and back off.

---

## 4. Reservations, and the Jubelio stock contract

> Status: shipped. BOUNDARY D6 (reservations) and D17 (stock source of truth and quantity contract) are authoritative; the full landmine entry is in `docs/landmines/jubelio.md`.

### 4.1 Writing `InventoryValue.reservedQty` / `StockReservation`

- Go through `packages/db/src/reservation-writer.ts`. Never touch `reservedQty` or `StockReservation` with bare Prisma.
  - **Marketplace** (`source = JUBELIO`) is **reserve-at-ingest, consume-at-ship, release-on-cancel-or-return**: `reserveOrder` when the salesorder webhook ingests an order, `consumeOrder` at ship (the first webhook `reportsShipped` reads as shipped or completed — for a ship, today almost always `internal_status: "SHIPPED"` — or the ERP Ship button through `markOrderShipped`, whichever lands first; the other is a no-op), `releaseOrder` when the order is cancelled or returned without having been consumed (`isCanceledOrder` / `isReturnedOrder` in the api's status-derive).
  - **Field sales**: `reserveFieldSalesOrder` at putus order create (`FIELD_SALES`), `reserveKonsiFieldSalesOrder` at konsi approve and at the admin konsi push (`FIELD_SALES_KONSI`, both through `approveKonsiOrderInTx`), `consumeFieldSalesOrderPartial` per putus delivery, `releaseFieldSalesOrder` on reject or close-remainder.
- **The one documented writer outside that file is `issueKonsiTransfer`** (`apps/web/lib/field-sales/konsi-transfer/writer.ts`). At konsi shipment completion it moves `qtyOnHand` through `moveMainStock`, then decrements `reservedQty` on the same pinned row and draws the line's reservation down (`consumedQty`, flipping it `CONSUMED` once exhausted). It is an exception with its own guard-test `ALLOWED` entry, not a pattern to copy, and its writes must never be separated.
- A reservation remembers its row. Every reserve stores the `InventoryValue` row it reserved against on `StockReservation.inventoryValueId`, and every consume, release and konsi draw-down acts on that row through `resolveReservedInventory`, which falls back to the reserve's own lookup only when there is no stored row (a reservation made before the column existed) or the stored row no longer exists. A new reserve path must stamp the column; a new consume or release path must resolve through that helper, never a fresh lookup, or a variantless row provisioned after the reserve pulls the consume onto the wrong row.
- Only the konsi reserve is guarded at write time: a raw `UPDATE … WHERE (qtyOnHand - reservedQty) >= ?`, where 0 rows affected means a short line. The marketplace and putus reserves increment unconditionally and report an oversell afterwards (the marketplace path raises an `AdminNotification`), because the order already exists by then.
- A reservation is not a stock movement: it writes no `StockLedgerEntry`.

### 4.2 What Jubelio's quantities mean — and what to push

Jubelio's `end_qty` is **on-hand**. `order_qty` is Jubelio's own open marketplace orders, and `available_qty = end_qty − order_qty`. This was verified live against prod on 2026-09-27, and it reverses what this guide used to say. So Jubelio already nets marketplace commitments, and the only thing Elorae must take off is what Jubelio cannot see: the field-sales holds, `offlineReserved` = the open qty of `StockReservation` rows with `source <> 'JUBELIO'`. Use `packages/db/src/jubelio-stock-contract.ts`, never hand-rolled arithmetic:

- push: `end_qty = jubelioEndQtyFor(qtyOnHand, offlineReserved)` = `max(0, qtyOnHand − offlineReserved)`;
- `stock` webhook: `qtyOnHand = eloraeOnHandFromJubelio(end_qty, offlineReserved)` = `end_qty + offlineReserved`, as an absolute on the locked row, skipping an `end_qty` that `parseJubelioQty` rejects;
- reconciliation: compare Elorae's figure with `end_qty` via `comparableEloraeQty(qtyOnHand, offlineReserved, pushEnabled)` (`apps/web/lib/inventory/reconciliation.ts`) — `jubelioEndQtyFor(qtyOnHand, offlineReserved)` while pushes are enabled, raw `qtyOnHand` (can be negative) while they are off, and correct `MATCH_JUBELIO` to `eloraeOnHandFromJubelio(end_qty, offlineReserved)` as an absolute through `setMainStock`. A variant with no Jubelio figure is FLAGGED, never compared as 0;
- `offlineReservedQty(client, itemId, variantSku)` / `offlineReservedByKey(client, keys)` read the raw term, for the push. The webhook, the comparison and `MATCH_JUBELIO` use `effectiveOfflineReservedQty` / `effectiveOfflineReservedByKey` instead, which return the holds only while stock pushes are enabled and `0` while they are off: only a push nets the holds out of Jubelio's `end_qty`, so with pushes off nothing has, and adding them back would overstate on-hand. The comparison's floor at 0 is gated the same way — it only means something on the push path, so it does not apply while pushes are off either. Pass the transaction client when inside one.

**Never subtract `reservedQty` from the pushed figure, and never push `available`.** `reservedQty` includes the `JUBELIO` reservations, the same orders Jubelio counts in `order_qty`, so that subtracts every marketplace order twice. The push did exactly that until the contract was verified.

**Virtual warehouses need no term in the formula.** Konsi stock sits in `StoreStock` and canvasser stock in `VanStock`, separate tables the push never reads. Units leave `InventoryValue` when they move there, so they are excluded by structure (BOUNDARY D7). There is no `virtualWarehouseQty` to subtract.

**Direction until cutover.** Jubelio is the stock source of truth, and `InventoryValue` mirrors it. Jubelio → Elorae (the webhook, `MATCH_JUBELIO`) has to be right today. An Elorae → Jubelio push overwrites the source of truth with a mirror that is not yet trustworthy: a negative-on-hand row pushes as `end_qty 0` and takes a live listing out of stock. That covers the bulk and per-item push buttons, the post-opname push and `REASSERT_ELORAE`. So do not add a new push trigger before cutover, keep reconciliation at `FLAG_ONLY`, and resolve flags with `MATCH_JUBELIO`.

**The cutover switch.** Pushes are gated by the `SystemSetting` key `JUBELIO_STOCK_PUSH_ENABLED`, read only through `isJubelioStockPushEnabled` (`packages/db/src/jubelio-stock-contract.ts`). It fails closed: only the exact string `"true"` enables pushing, and an absent row (nothing seeds it) or any other value is off.

- **Backstop:** `StockPushHandler` reads the switch first and skips EVERY `stock_push` row with `stock_push_disabled` while it is off — the buttons, the post-opname push, `REASSERT_ELORAE`, rows queued before it went off, and any future automatic push.
- **First-line refusals in web**, so the operator sees why: the per-item and bulk push actions return `push_disabled`; the manual `REASSERT_ELORAE` resolve and saving `REASSERT_ELORAE` as the direction return `PUSH_DISABLED` (any other direction still saves); the reconciliation run degrades `REASSERT_ELORAE` to `FLAGGED`.
- Skipped rows are NOT replayed when the switch goes on; a `SKIPPED` row stays skipped unless an admin re-queues it.
- The webhook direction keeps applying; only the field-sales add-back depends on the switch (above).
- **Turning it on** is the last cutover step, on `/backoffice/jubelio/admin` (admin only; the flip writes an `AuditLog` row, `JUBELIO_STOCK_PUSH_TOGGLE`, in the same transaction): after the recount and a clean reconciliation, and immediately followed by "Sync all stock" on the same page, so Jubelio receives figures net of the open field-sales holds the webhook starts adding back.
- **Rule:** any new push path enqueues `stock_push`; nothing calls `PUT /inventory/items/{id}/stock` outside that handler, because the handler is where the switch is enforced.

---

## 5. What NOT to do

| Anti-pattern | What goes wrong | Right way |
|---|---|---|
| Hardcode `entityType: "stock_push"` without `satisfies` | Typo compiles, runtime skip with `unknown_entity_type:…`. Silent drop. | Use `satisfies JubelioOutboxEntityType`. |
| Call `fetch("https://api.jubelio.com/...")` from a server action | No token, no rate budget, leaks credentials, bypasses outbox retry logic. | Enqueue `JubelioOutbox` row. |
| Update `InventoryValue`, `StoreStock` or `VanStock` with bare Prisma | No `StockLedgerEntry` is appended, so the movement is invisible to the ledger — and it is the ledger, not the balance, that the read side trusts — `/backoffice/inventory/movements` and the store detail card both render straight from it, so a skipped append is a movement an operator cannot see happened. A guard test fails the suite on any direct write it can see. | Use a mover from `packages/db/src/stock-balance.ts`. |
| Update `InventoryValue` without writing `StockAdjustment` | Audit trail breaks. Reconcile can't tell what moved. | Always pair the two writes in one transaction. |
| Look an `InventoryValue` row up on the strict `itemId_variantSku` key | A variantless row keys on `null` OR `""`; the strict key misses it, and the caller then treats a real stocked item as having none. | `findExistingInventoryValueRow`, then pass the resolved `id` to the mover as `inventoryValueId`. |
| Write `StockAdjustment` with a free-form `source: "manual"` | Audit dashboard filters won't find it; reconcile will treat it as `ERP`. | Add to registry or use `ERP`. |
| Skip `idempotencyKey` | Webhook replays produce duplicate adjustments. | Always set it. Format: `<source-prefix>:<external-id>:<version>` (e.g. `jbl-stock:webhook-uuid`, `opname:session-id:line-id`). |
| Subtract `reservedQty` from the pushed qty, or push `available` | Every marketplace order comes off twice (Jubelio already nets them as `order_qty`), so every item with open orders is under-listed. | `jubelioEndQtyFor(qtyOnHand, offlineReserved)` — §4.2. |
| Read konsi or van stock into the push | Marketplace oversells stock that sits at a store or on a van. | Nothing to do: those units live in `StoreStock`/`VanStock`, which the push never reads. Keep it that way. |
| Push Elorae stock to Jubelio before cutover | Overwrites the source of truth with an untrusted mirror; a negative row lists as 0. | Keep reconciliation `FLAG_ONLY`, resolve by `MATCH_JUBELIO`, add no push trigger. The switch (§4.2) refuses the existing ones while it is off. |
| Call `PUT /inventory/items/{id}/stock` outside `StockPushHandler` | Bypasses the cutover switch, which only that handler enforces. | Enqueue a `stock_push` outbox row. |
| Reuse marketplace `SalesOrder` for offline orders | Channel conflation, dual-writer hazard. | Use a separate model or a hard channel discriminator. See [BOUNDARY.md §3.2](./BOUNDARY.md). |
| Pre-fill a field retur's warehouse received qty from salesman claim | Acceptance criteria explicitly forbid. Bypasses warehouse independence. | Warehouse counts blind. |
| Sync external HTTP call from inside a Prisma TX | TX holds DB locks while external call hangs. | Enqueue outbox / use job queue. |

---

## 6. Quick reference — where things live

| Concern | File |
|---|---|
| Outbox entityType registry | `packages/db/src/jubelio-outbox.ts` |
| Stock adjustment source registry | `packages/db/src/stock-adjustment-source.ts` |
| Stock balance movers (the ONLY way to move a balance) | `packages/db/src/stock-balance.ts` |
| Stock ledger append primitive | `packages/db/src/stock-ledger.ts` |
| Reservation writers | `packages/db/src/reservation-writer.ts` |
| Jubelio stock contract (push / webhook / reconciliation arithmetic) | `packages/db/src/jubelio-stock-contract.ts` |
| Stock reconciliation | `apps/web/lib/inventory/reconciliation-runner.ts` |
| Direct-balance-write guard test | `apps/web/lib/inventory/stock-balance-guard.test.ts` |
| OR-tolerant `InventoryValue` lookup (web) | `apps/web/lib/inventory/costing.ts` |
| Jubelio webhook stock writer | `packages/db/src/stock-writer.ts` |
| Item dual-write helper (api-side) | `packages/db/src/item-writer.ts` |
| Sales order fulfillment writer | `packages/db/src/sales-order-fulfillment-writer.ts` |
| Outbox router (api) | `apps/api/src/jubelio/outbox/outbox-router.ts` |
| Outbox handlers (api) | `apps/api/src/jubelio/outbox/handlers/` |
| Internal signed-channel client (web → api) | `apps/web/lib/internal-api.ts` |
| Architectural contract | `docs/BOUNDARY.md` |

## 7. When the guide is wrong

This file is the contract; if reality has drifted (a helper was renamed, a registry value disappeared, the recommended pattern stopped working), fix the guide in the same PR as the code change. Stale integration docs are worse than no docs — they tell readers the system works in a way it no longer does.

The maintenance rule from `docs/EPIC-STATUS.md` applies: when an EPIC ships, refresh both the BOUNDARY decomposition table AND any guide section that referenced the EPIC's work as "upcoming."
