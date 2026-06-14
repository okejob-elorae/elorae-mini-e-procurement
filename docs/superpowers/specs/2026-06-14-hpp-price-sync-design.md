# HPP → Selling Price Sync — Design Spec

**Date:** 2026-06-14
**Scope:** Closes the HPP→selling-price half of the product-push work (deferred from the 2026-05-28 product-push spec).
**Status:** draft, awaiting approval

## 1. Goal

When HPP (per-item average cost) changes, automatically recalculate `Item.sellingPrice` from a margin formula, update the Item, audit the change, and propagate the new price to Jubelio. Resolves the gap between the original product-push spec's manual-pricing scope cut and the product-and-stock-sync requirement: *"HPP change → recalculate margin-based selling price → push to Jubelio."*

## 2. Scope

### In scope

- Hybrid margin model: per-item `Item.targetMarginPercent` overrides global `JubelioPushDefaults.defaultMarginPercent`.
- Recalc fires on **every FG receipt** that updates `InventoryValue.avgCost`.
- Recalc also fires on margin field changes (item-level OR push-defaults).
- New `ItemPriceChangeLog` table records every price change with full context.
- New helper `@elorae/db/item-price-writer.ts` exposes `recalcItemSellingPrice(tx, input)` — single entry point used by all three trigger paths.
- Web UI surface: margin fields on item edit, defaults fields on Jubelio settings, audit-log tab on item detail.
- Existing `product_push` outbox row is enqueued by the helper when item has a `JubelioProductMapping`.

### Out of scope

- Per-item `buy_price` push to Jubelio — stays on `JubelioPushDefaults.buyPrice` (global), per brainstorming decision 2026-06-14.
- Threshold-based / batched recalc — every FG receipt fires (literal requirement reading).
- Lock-manual-price opt-out — design accepts that defaults change overwrites manual prices on margin-null items. Revisit if real complaints appear.
- Category-level or marketplace-specific margins.
- Recalc cascade triggered by settlement reconcile or stock opname — those modules will call `recalcItemSellingPrice` directly when they land.
- Migration to backfill historical price changes — log starts empty.

## 3. Architecture

```
┌────────────── apps/web server actions ──────────────┐
│ receiveFG (FG receipt path)                          │
│   └─ TX: create FGReceipt + bump avgCost             │
│       └─ recalcItemSellingPrice(tx, {                │
│              trigger: "FG_RECEIPT",                  │
│              fgReceiptId, …})                        │
│                                                      │
│ updateItem (margin change path)                      │
│   └─ TX: update Item                                 │
│       └─ if margin/extras changed:                   │
│           recalcItemSellingPrice(tx, {               │
│              trigger: "MARGIN_CHANGE", …})           │
│                                                      │
│ saveJubelioPushDefaults (defaults change path)       │
│   └─ TX: update defaults                             │
│       └─ for each Item where targetMarginPercent     │
│         IS NULL (fan-out):                           │
│           recalcItemSellingPrice(tx, {               │
│              trigger: "DEFAULTS_CHANGE", …})         │
└──────────────────────────────────────────────────────┘
                       │
                       ▼ (writes JubelioOutbox row)
        ┌────────────────────────────────┐
        │  outbox poller (already built) │
        └────────────────────────────────┘
                       │
                       ▼
        ┌────────────────────────────────┐
        │  ProductPushHandler            │
        │  (already built — reads        │
        │   Item.sellingPrice as-is)     │
        └────────────────────────────────┘
```

The helper is the single point of truth for the recalc formula, audit log, and outbox enqueue. All three server-action paths route through it. ProductPushHandler is untouched — it already reads `Item.sellingPrice` and pushes it as `sell_price`.

## 4. Schema changes

```prisma
model Item {
  // ... existing fields, including:
  sellingPrice         Decimal? @db.Decimal(14,2)         // existing
  // NEW:
  targetMarginPercent  Decimal? @db.Decimal(5,2)          // e.g. 25.5 = 25.5%
  additionalCost       Decimal? @db.Decimal(15,2)         // flat add-on per pcs
  priceChangeLogs      ItemPriceChangeLog[]               // back-relation
}

model JubelioPushDefaults {
  // ... existing fields, including:
  buyPrice                 Decimal @default(0) @db.Decimal(15,2)  // existing; kept global
  // NEW:
  defaultMarginPercent     Decimal? @db.Decimal(5,2)
  defaultAdditionalCost    Decimal? @db.Decimal(15,2)
}

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

Migration name: `add_item_target_margin_and_price_log` (single migration, additive only).

## 5. Resolution formula

```ts
effectiveMargin = item.targetMarginPercent ?? defaults.defaultMarginPercent
effectiveExtras = item.additionalCost ?? defaults.defaultAdditionalCost ?? 0

if (effectiveMargin === null) {
  return { skipped: "no_margin_configured" }
}

newSellingPrice = avgCost * (1 + effectiveMargin / 100) + effectiveExtras
// Rounded to 2 decimal places per Decimal(14,2) column.
```

**Safety:** when no margin is set anywhere, helper SKIPS the recalc. Manual `sellingPrice` stands. Protects shipped items with hand-set prices from sudden formula-driven overwrites during rollout.

## 6. Helper contract — `recalcItemSellingPrice`

File: `packages/db/src/item-price-writer.ts`

```ts
export type RecalcItemSellingPriceInput = {
  itemId: string;
  trigger: PriceChangeTrigger;
  newAvgCost?: number;        // null/undefined → reads from InventoryValue
  fgReceiptId?: string;       // required when trigger=FG_RECEIPT
  changedById: string | null;
};

export type RecalcItemSellingPriceResult =
  | { applied: true; oldSellingPrice: number | null; newSellingPrice: number; outboxRowId: string | null }
  | { applied: false; skipped: "no_change" | "no_margin_configured" | "ingested_item" | "non_finished_good" };

export async function recalcItemSellingPrice(
  tx: Prisma.TransactionClient,
  input: RecalcItemSellingPriceInput,
): Promise<RecalcItemSellingPriceResult>;
```

Helper steps (atomic within caller's transaction):

1. Load `Item` (with `source`, `type`, `targetMarginPercent`, `additionalCost`, `sellingPrice`).
2. Load `JubelioPushDefaults` singleton.
3. Load current `InventoryValue.avgCost` if not supplied.
4. Apply skip rules:
   - `item.type !== "FINISHED_GOOD"` → `skipped: "non_finished_good"`.
   - `item.source === "JUBELIO_INGEST"` → `skipped: "ingested_item"` (prevents Jubelio→ingest→push feedback loop).
   - `effectiveMargin === null` → `skipped: "no_margin_configured"`.
5. Compute `newSellingPrice`. If equals old → `skipped: "no_change"`.
6. `tx.item.update({ sellingPrice: newSellingPrice })`.
7. `tx.itemPriceChangeLog.create({ ... })` with full context.
8. If `JubelioProductMapping` exists for this item: `tx.jubelioOutbox.create({ entityType: "product_push" satisfies JubelioOutboxEntityType, ... })`. Capture row id for return.
9. Return `applied: true` with details.

Helper does NOT fire `apiFetch(POST /jubelio/outbox/enqueue/...)` directly — that's the caller's responsibility (after TX commits). Web actions chain it post-commit, same as existing `enqueueProductPushOnCreate`.

Helper does NOT produce `triggerReason = "MANUAL_EDIT"` rows. Manual sellingPrice edits bypass the recalc formula and the `updateItem` server action writes that audit row directly (see §7.4). The helper covers `FG_RECEIPT`, `MARGIN_CHANGE`, and `DEFAULTS_CHANGE` only.

## 7. Trigger flows

### 7.1 FG receipt

Extend the existing FG receipt server action (`apps/web/app/actions/production.ts` or wherever `receiveFG` lives — implementation reads to confirm):

```ts
const result = await prisma.$transaction(async (tx) => {
  // existing: create FGReceipt, bump qtyOnHand + avgCost
  const receipt = await tx.fGReceipt.create({...});
  const updatedInv = await tx.inventoryValue.update({...});

  // NEW:
  return recalcItemSellingPrice(tx, {
    itemId: wo.finishedGoodId,
    trigger: "FG_RECEIPT",
    fgReceiptId: receipt.id,
    newAvgCost: Number(updatedInv.avgCost),
    changedById: session.user.id,
  });
});

// After commit: low-latency dispatch hint to api (best-effort)
if (result.applied && result.outboxRowId) {
  void apiFetch("POST", `/jubelio/outbox/enqueue/${result.outboxRowId}`, {
    userId: session.user.id,
  }).catch(() => {
    // poller picks it up within ~5s if this fails
  });
}
```

Same post-commit `apiFetch` chain applies to §7.2 and §7.3 — for §7.3, fire one `apiFetch` per outbox row from the result list (or skip entirely and let the poller drain).

### 7.2 Margin change (item-level)

Extend `updateItem` server action. When request payload contains a different `targetMarginPercent` or `additionalCost` than the stored value:

```ts
await prisma.$transaction(async (tx) => {
  await tx.item.update({ data: { ...newFields } });

  if (marginOrExtrasChanged) {
    await recalcItemSellingPrice(tx, {
      itemId,
      trigger: "MARGIN_CHANGE",
      changedById: session.user.id,
    });
  }
});
```

Also extend `apps/web/lib/items/jubelio-push-diff.ts` `PushableSnapshot` to include `targetMarginPercent` and `additionalCost` so manual margin edits also trigger `product_push` even when recalc results in `no_change` (defensive: keep Jubelio in sync if downstream behavior diverges).

### 7.3 Defaults change (fan-out)

Extend `saveJubelioPushDefaults` server action. When `defaultMarginPercent` or `defaultAdditionalCost` changes:

```ts
const affectedItemIds = await prisma.item.findMany({
  where: {
    type: "FINISHED_GOOD",
    targetMarginPercent: null,
    source: { not: "JUBELIO_INGEST" },
  },
  select: { id: true },
});

// Commit the defaults change first (small TX, completes fast).
await prisma.$transaction(async (tx) => {
  await tx.jubelioPushDefaults.update({ ... });
});

// Fan-out recalcs: batch above threshold to avoid one giant locking TX.
const BATCH_SIZE = 100;
const SMALL_FANOUT_THRESHOLD = 500;
if (affectedItemIds.length <= SMALL_FANOUT_THRESHOLD) {
  // Small case: single TX is fine.
  await prisma.$transaction(async (tx) => {
    for (const { id: itemId } of affectedItemIds) {
      await recalcItemSellingPrice(tx, { itemId, trigger: "DEFAULTS_CHANGE", changedById: session.user.id });
    }
  });
} else {
  // Large case: batch outside a single TX. Brief eventual-consistency window.
  for (let i = 0; i < affectedItemIds.length; i += BATCH_SIZE) {
    const batch = affectedItemIds.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(async (tx) => {
      for (const { id: itemId } of batch) {
        await recalcItemSellingPrice(tx, { itemId, trigger: "DEFAULTS_CHANGE", changedById: session.user.id });
      }
    });
  }
}
```

**UI confirmation dialog** before the save action fires: count fallback items, render `"X items will be recalculated and pushed to Jubelio. Continue?"`. If count > 100, render a stronger warning. If count > `SMALL_FANOUT_THRESHOLD`, also warn about the eventual-consistency window during batched processing.

### 7.4 Manual sellingPrice edit (existing flow extended)

`updateItem` action — when `sellingPrice` field in payload differs from stored value but no margin field changed:
- Write Item as today.
- NEW: write `ItemPriceChangeLog` row with `triggerReason: "MANUAL_EDIT"`, `marginPercentUsed: null`, `additionalCostUsed: null`.
- Existing pushable-diff catches it, enqueues `product_push` as today.

Manual price stands until the next FG receipt (or margin/defaults change) recomputes from formula. **By design.**

## 8. UI surfaces

### 8.1 Item form

`apps/web/components/forms/ItemForm.tsx`. Add a "Pricing" section between existing "Harga Jual" input and the bottom:

- `Target margin (%)` — number input, nullable. Helper text: *"Leave blank to use the default from Jubelio push settings."*
- `Additional cost per pcs (Rp)` — number input, nullable. Helper text: *"Flat add-on per unit (packaging, etc). Optional."*
- Read-only computed preview line: *"Computed selling price = avgCost × (1 + margin/100) + additionalCost"* — render the formula result given current avgCost. Greyed out if no margin resolves.

### 8.2 Jubelio push defaults form

`apps/web/app/backoffice/jubelio/settings/...`. Add to the existing "Push defaults" card:

- `Default margin (%)` — nullable.
- `Default additional cost (Rp)` — nullable.

Saving these triggers the fan-out (§7.3). Confirmation dialog before save when fan-out > 0 items.

### 8.3 Item detail — price history tab

`apps/web/app/backoffice/items/[id]/page.tsx`. Add a new tab next to existing content: `Price History`.

Table columns: `Changed at`, `Trigger`, `Old → New`, `avgCost basis`, `Margin used`, `Extras`, `Actor`, `FG Receipt` (link if applicable).

Sort: `changedAt DESC`. Paginate: 50/page.

Empty state: *"No price changes recorded yet."*

### 8.4 i18n

Add keys under `items.pricing.*` (en + id) and `items.priceHistory.*`. Indonesian: "Margin target", "Biaya tambahan", "Riwayat harga", etc.

## 9. RBAC

No new permissions. Reuses:
- `items:edit` — gates margin field edits on item form.
- `items:view` — gates price history tab.
- `settings_security:manage` — gates push defaults edit (existing).

## 10. Edge cases

1. **Race condition: concurrent FG receipts for same item.** Both TXs read same `oldSellingPrice`. Last commit wins on `Item.sellingPrice`. Audit log records both rows in commit order. Acceptable — no pessimistic lock needed; MariaDB row lock on Item update suffices.

2. **avgCost moved but newSellingPrice unchanged after Decimal(14,2) rounding.** Helper returns `skipped: "no_change"`. No audit row, no outbox row.

3. **Item has margin but no Jubelio mapping yet.** Helper updates `Item.sellingPrice` + writes audit row. Skips outbox enqueue. Next push (`enqueueProductPushOnCreate` or bulk migration) sends formula-derived price.

4. **Ingested item (`source = JUBELIO_INGEST`).** Helper skips entirely. Ingested items keep their Jubelio-origin pricing.

5. **`additionalCost` set without margin.** Formula needs margin to compute. Helper returns `skipped: "no_margin_configured"`. Document in INTEGRATION-GUIDE.

6. **Defaults change wipes manual prices on margin-null items.** Acknowledged design behavior. UI confirmation dialog warns. No opt-out lock — revisit if business complains.

7. **`product_push` outbox row enqueued but admin manually edits sellingPrice before push fires.** Race: outbox row carries `entityId` only; handler reads current Item at process time. Latest price wins. Pushable-diff prevents duplicate enqueue from the manual edit.

8. **Helper called outside a transaction.** Type signature requires `Prisma.TransactionClient`. Type-system blocks misuse. Runtime check via `tx.$transaction` would over-engineer for this audience.

## 11. Failure modes

| Failure | Behaviour |
|---|---|
| Helper throws mid-recalc | Outer transaction rolls back; FG receipt write rolls back too. User sees error. Re-try is safe. |
| Outbox row inserted, poller dies before pickup | Standard outbox recovery — sweeper rescues within 10 min. |
| Item has margin but no avgCost in InventoryValue | Treat as `oldAvgCost = 0`. Resulting price may be 0 or extras-only. Audit log captures `oldAvgCost: 0` → `newAvgCost: …`. Defensible. |
| Concurrent defaults change + FG receipt | First commits at T1, second at T2. T2 reads T1's state. Correct serializability. |
| Defaults fan-out item count is huge (e.g. 5k) | Single TX with 5k recalcs becomes slow + holds row locks. **Mitigation:** if `affectedItemIds.length > 500`, run fan-out in batches of 100 outside the defaults-update TX (defaults change commits first; recalcs follow). Trade-off: brief window where defaults are updated but items haven't been recalculated. Acceptable per the design tolerance for "eventually consistent within seconds." |

## 12. Test plan

TDD order (failing test first per step):

1. **`recalcItemSellingPrice` unit tests** (`packages/db/src/item-price-writer.spec.ts` or via api jest suite):
   - Resolves item margin over defaults.
   - Resolves defaults when item margin is null.
   - Returns `skipped: "no_margin_configured"` when both null.
   - Returns `skipped: "non_finished_good"` for raw material.
   - Returns `skipped: "ingested_item"` for JUBELIO_INGEST source.
   - Returns `skipped: "no_change"` when computed price equals current.
   - Writes Item, ItemPriceChangeLog, JubelioOutbox row when mapping exists.
   - Skips outbox row when no mapping; still writes Item + log.
   - Includes correct `fgReceiptId` in log when supplied.

2. **FG receipt integration test** (`apps/web/app/actions/production.spec.ts` or extension): `receiveFG` causes recalc, audit log row appears, outbox row enqueued.

3. **Margin change integration test:** `updateItem` with new `targetMarginPercent` triggers recalc; audit row trigger=`MARGIN_CHANGE`; outbox enqueued.

4. **Defaults change integration test:** `saveJubelioPushDefaults` with new `defaultMarginPercent` triggers fan-out across margin-null items; items with their own margin unchanged; batching kicks in above threshold.

5. **Pushable-diff extension test:** verifies `targetMarginPercent` and `additionalCost` are watched.

6. **UI render test:** item detail price history tab renders correctly given mock log data.

Coverage target: helper at 100% branch coverage; integration tests cover one happy path per trigger.

## 13. Open questions

None blocking. Documented assumptions:

- Helper batching threshold (500 items, 100 per batch) is a starting heuristic. Tune after first production run.
- Fan-out audit log entries: every item gets its own row. No "bulk fan-out" event row. Reasoning: per-item rows are queryable; a single bulk row would require joining + parsing.
- HPP report module: out of scope here. It already computes per-WO selling price as informational; that flow is untouched.

## 14. Rollback path

If a recalc cascade misbehaves in production:

1. Set `JubelioPushDefaults.defaultMarginPercent = NULL` via admin UI or direct SQL → helper short-circuits to `skipped: "no_margin_configured"` for all margin-null items. Manual prices stop being touched.
2. To freeze individual items: set `Item.targetMarginPercent = NULL` (helper skips when no margin resolves) AND clear `defaultMarginPercent`.
3. Bad price changes already pushed to Jubelio: replay manual product_push with a corrected sellingPrice.

`ItemPriceChangeLog` is append-only. Audit history is preserved across rollbacks.

## 15. Decisions log (this brainstorm, 2026-06-14)

| # | Topic | Decision |
|---|---|---|
| H1 | Margin home | Hybrid: per-item `Item.targetMarginPercent` overrides global `JubelioPushDefaults.defaultMarginPercent`. |
| H2 | Recalc trigger cadence | Every FG receipt (literal requirement reading). |
| H3 | `buy_price` per-item push | No. `buy_price` stays on global `JubelioPushDefaults.buyPrice`. |
| H4 | Audit log shape | Dedicated `ItemPriceChangeLog` table with structured columns. |
| H5 | Architectural location | Helper `@elorae/db/item-price-writer.ts` callable from all three trigger paths. Matches existing dual-writer patterns. |
| H6 | Ingested-item recalc | Skip — prevents Jubelio→ingest→push feedback loop. |
| H7 | Manual price lock | None. Manual price treated as one-shot override; next HPP movement undoes it. |
| H8 | Defaults fan-out limit | Batch above 500 items, 100/batch outside the defaults TX. Eventually consistent within seconds. |
