# Integration Guide — Jubelio-touching Surface

> Read this BEFORE writing any code that touches Jubelio data, the outbox, or stock adjustments. It tells you which helpers to call, which strings are allowed, and what the boundary owners enforce.

Audience: ERP module developers building EPIC-05 (returns), EPIC-07 (opname + reconcile), EPIC-08 (reservations), EPIC-19 (warehouses), and anything else that crosses into Jubelio territory.

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
| `ERP_OPNAME` | Stock opname session approval (EPIC-07-03). | web |
| `JUBELIO_WEBHOOK` | Inbound Jubelio stock-changed webhook. **Do not call from web — only `apps/api`.** | api |
| `JUBELIO_RECONCILE` | Auto-correction from the 6h reconcile cron (EPIC-07-04). | api (cron) |

If your use case doesn't fit any of these, add to the registry first (see "Adding a new source" below). Do not pick the closest match and hope for the best — the reconcile logic and audit dashboards key off the exact string.

### Code (ERP-side, e.g. opname)

```ts
import { prisma } from "@elorae/db";
import type { StockAdjustmentSource } from "@elorae/db";
import type { AdjustmentType } from "@elorae/db";

const opnameSource = "ERP_OPNAME" satisfies StockAdjustmentSource;

await prisma.$transaction(async (tx) => {
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

  await tx.inventoryValue.update({
    where: { itemId_variantSku: { itemId, variantSku } },
    data: {
      qtyOnHand: newQty,
      totalValue: newQty * avgCost,
      lastUpdated: new Date(),
    },
  });

  // Optional: enqueue a JubelioOutbox row to push the adjustment outbound
  // await tx.jubelioOutbox.create({ data: { entityType: "stock_push" satisfies …, … } });
});
```

**Why a transaction.** `StockAdjustment` and `InventoryValue` must move together. If one succeeds and the other doesn't, the audit trail diverges from the actual on-hand and you'll see "Jubelio shows 100, ERP shows 98 but the audit log says we adjusted to 100" — exactly the kind of mismatch reconcile is supposed to catch, except now reconcile thinks they're aligned because the wrong row wrote.

### Code (Jubelio webhook ingest, api-side)

Use the existing helper. Do not duplicate the logic.

```ts
// apps/api/...
import { applyJubelioStockAdjustment, prisma } from "@elorae/db";

const result = await applyJubelioStockAdjustment(prisma, {
  itemId,
  variantSku,
  newQty,
  idempotencyKey,
  externalRef,
  reason,
});
if (result.skipped) {
  // idempotency collision — webhook replay; safe to ignore
}
```

### Adding a new `source`

1. Append to `STOCK_ADJUSTMENT_SOURCES` in `packages/db/src/stock-adjustment-source.ts`.
2. Run `pnpm -F @elorae/db build`.
3. Update audit dashboard filters if the source should appear in UI.
4. Update reconcile-cron logic if the source should be treated as authoritative or skippable (depends on whether your source represents a known divergence or an unrelated change).

---

## 3. Reading from Jubelio (cron, dashboard, ad-hoc)

**Web cannot call Jubelio directly.** No `JUBELIO_TOKEN` is provided to apps/web. The only path is via apps/api.

For now, no general-purpose read endpoint exists. The reconcile cron (EPIC-07-04) is the first concrete consumer. When you build it, surface a signed-channel endpoint on apps/api (`GET /jubelio/inventory/snapshot?…`) and have web cron call it. Don't reach into Jubelio from web; the secret won't be there and even if you cascade it, you've now leaked a back-office credential to the public-facing surface.

The endpoint contract:
- Authentication: `apiFetch` from web with NextAuth JWT (the existing internal-api signed channel). See `apps/web/lib/internal-api.ts`.
- Response: normalized JSON. Never raw Jubelio response — adapt at the api layer so web doesn't depend on Jubelio's shape.
- Rate limiting: api owns the Jubelio rate budget (600 rpm). Web callers must accept 429 and back off.

---

## 4. Modifying `InventoryValue.reservedQty` (when EPIC-08 lands)

> Status: schema not yet shipped. This section is the contract EPIC-08 must honor; revise after schema lands.

When EPIC-08 introduces `InventoryValue.reservedQty`:

- All reservation writes (reserve, release) go through a new helper `packages/db/src/inventory-reservation.ts`. Do not modify `reservedQty` directly via `prisma.inventoryValue.update`.
- The reserve operation must be atomic and conditional:
  ```sql
  UPDATE InventoryValue
  SET reservedQty = reservedQty + ?
  WHERE itemId = ? AND variantSku = ?
    AND (qtyOnHand - reservedQty) >= ?
  ```
  i.e. the helper uses `prisma.inventoryValue.updateMany` with a `WHERE` clause that includes the availability check. If the update affects 0 rows → reservation failed (insufficient stock).
- The Jubelio stock push helper must subtract `reservedQty` from the pushed qty:
  `pushable = qtyOnHand - reservedQty - virtualWarehouseQty` (see [BOUNDARY.md §7 anti-pattern: virtual stock leak](./BOUNDARY.md)).
- Reservation release is symmetric. Done by the fulfillment writer on SHIPPED transition (extend `@elorae/db/sales-order-fulfillment-writer.ts`, do not add a parallel write path).

---

## 5. What NOT to do

| Anti-pattern | What goes wrong | Right way |
|---|---|---|
| Hardcode `entityType: "stock_push"` without `satisfies` | Typo compiles, runtime skip with `unknown_entity_type:…`. Silent drop. | Use `satisfies JubelioOutboxEntityType`. |
| Call `fetch("https://api.jubelio.com/...")` from a server action | No token, no rate budget, leaks credentials, bypasses outbox retry logic. | Enqueue `JubelioOutbox` row. |
| Update `InventoryValue` without writing `StockAdjustment` | Audit trail breaks. Reconcile can't tell what moved. | Always pair the two writes in one transaction. |
| Write `StockAdjustment` with a free-form `source: "manual"` | Audit dashboard filters won't find it; reconcile will treat it as `ERP`. | Add to registry or use `ERP`. |
| Skip `idempotencyKey` | Webhook replays produce duplicate adjustments. | Always set it. Format: `<source-prefix>:<external-id>:<version>` (e.g. `jbl-stock:webhook-uuid`, `opname:session-id:line-id`). |
| Push konsi (virtual warehouse) stock to Jubelio | Marketplace oversells real stock. | Subtract virtual qty in the push formula. EPIC-19 will provide the warehouse helper. |
| Reuse marketplace `SalesOrder` for offline orders | Channel conflation, dual-writer hazard. | Use a separate model or a hard channel discriminator. See [BOUNDARY.md §3.2](./BOUNDARY.md). |
| Pre-fill EPIC-24 received qty from salesman claim | Acceptance criteria explicitly forbid. Bypasses warehouse independence. | Warehouse counts blind. |
| Sync external HTTP call from inside a Prisma TX | TX holds DB locks while external call hangs. | Enqueue outbox / use job queue. |

---

## 6. Quick reference — where things live

| Concern | File |
|---|---|
| Outbox entityType registry | `packages/db/src/jubelio-outbox.ts` |
| Stock adjustment source registry | `packages/db/src/stock-adjustment-source.ts` |
| Jubelio webhook stock writer | `packages/db/src/stock-writer.ts` |
| Item dual-write helper (api-side) | `packages/db/src/item-writer.ts` |
| Sales order fulfillment writer | `packages/db/src/sales-order-fulfillment-writer.ts` |
| Outbox router (api) | `apps/api/src/jubelio/outbox/outbox-router.ts` |
| Outbox handlers (api) | `apps/api/src/jubelio/outbox/handlers/` |
| Internal signed-channel client (web → api) | `apps/web/lib/internal-api.ts` |
| Architectural contract | `docs/BOUNDARY.md` |

## 7. When the guide is wrong

This file is the contract; if reality has drifted (a helper was renamed, a registry value disappeared, the recommended pattern stopped working), fix the guide in the same PR as the code change. Stale integration docs are worse than no docs — they tell readers the system works in a way it no longer does.

The maintenance rule from `CLAUDE.md` applies: when an EPIC ships, refresh both the BOUNDARY decomposition table AND any guide section that referenced the EPIC's work as "upcoming."
