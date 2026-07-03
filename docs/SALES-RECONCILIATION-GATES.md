# Sales Reconciliation Gates

Status: **recorded 2026-06-24** · Reconciliation path: **B-Aggregate** (default)

This document captures Gate 1 (Jubelio sales data live) and Gate 2 (marketplace order ID spike) findings before shipping reconciliation features.

---

## Gate 1 — Jubelio `SalesOrder` has post-go-live data

**Question:** Does `SalesOrder` have meaningful operational data for reconciliation?

### Checklist

| Check | How |
| ----- | --- |
| Recent order count | `SELECT COUNT(*) FROM SalesOrder WHERE transactionDate >= DATE_SUB(NOW(), INTERVAL 30 DAY);` |
| Item mapping fill rate | `SELECT COUNT(*) FROM SalesOrderItem WHERE itemId IS NOT NULL;` vs total lines |
| Webhook pipeline | `JubelioWebhookEvent` rows reaching `PROCESSED` in last 30 days |
| Infra | Webhook URL → `api.elorae.cloud`, Redis up, `JUBELIO_WEBHOOK_SECRET` valid |

### Automated script

```bash
cd apps/web
pnpm exec tsx scripts/sales-reconciliation-gate1.ts
```

Requires `apps/web/.env` with valid `DATABASE_URL`.

### Results (2026-06-24, shared TiDB)

| Metric | Value |
| ------ | ----- |
| `SalesOrder` last 30 days | **510** |
| `SalesOrder` total | **511** |
| `SalesOrderItem` total | **586** |
| `SalesOrderItem` with `itemId` | **586** (100%) |
| `JubelioWebhookEvent` PROCESSED last 30 days | **2,256** |
| `SalesHistory` completed rows | **59,000** |
| `SalesHistory` `MAPPED` rows | **0** (pre-migration imports; re-import or backfill needed for identity fields) |

### Gate 1 decision

**PASS — proceed to reconciliation.**

Pipeline is live with real post-go-live orders and full `itemId` fill on order lines. Empty `SalesHistory.resolutionStatus=MAPPED` is expected until Excel periods are re-imported with the new resolver.

---

## Gate 2 — Marketplace order ID for line-level join

**Question:** Can `SalesHistory.orderId` (Shopee/TikTok platform id) join to a Jubelio/`SalesOrder` field?

### Spike procedure

1. Pick 3–5 known Shopee + TikTok orders (note platform "No. Pesanan" from marketplace UI).
2. Compare against:
   - `SalesOrder.salesorderNo` for same approximate date/channel
   - `JubelioWebhookEvent.rawPayload` JSON (admin UI: `/backoffice/jubelio/admin`)
   - Optional: `GET /sales/orders/:id` via api client
3. Document field name if marketplace id exists separately from `salesorder_no`.

### Codebase verification (no live spike samples in repo)

| Source | Marketplace order id field |
| ------ | -------------------------- |
| `salesorder.payload.ts` typed fields | **None** — only `salesorder_no`, `salesorder_id`, `source_name` |
| `SalesOrder` schema | **No `channelOrderId` column** |
| `SalesReturn.channelOrderNo` | Stores Jubelio `salesorder_no`, not verified platform id |
| Test fixtures | Use `SO-23043`, `TT-42` style Jubelio numbers — not platform ids |

### Gate 2 decision

**B-Aggregate (default)** — reconcile per channel + period + `itemId` (or unmapped `parentSku` bucket). No line-level `SalesHistory` ↔ `SalesOrderItem` join until a dedicated marketplace order field is verified in production payloads.

**Do not implement B-Line** (`matchStatus`, `salesOrderItemId`, fuzzy order matching) without a confirmed order key.

### Follow-up spike (manual, when needed)

When investigating a specific mismatch period:

```sql
-- Sample Jubelio order numbers for a channel/month
SELECT salesorderNo, transactionDate, channel
FROM SalesOrder
WHERE channel = 'SHOPEE'
  AND transactionDate >= '2026-06-01'
LIMIT 10;
```

Compare `salesorderNo` values against Shopee seller-center order ids for the same window. Inspect `rawPayload` for `order_sn`, `ref_no`, `channel_order`, or similar keys.

---

## Reconciliation implementation summary

| Path | Status | Notes |
| ---- | ------ | ----- |
| Product identity resolver | Shipped | `apps/web/lib/sales/marketplace-sku-resolver.ts` |
| Excel import enrichment | Shipped | Identity fields on `SalesHistory` |
| Forecast item-centric grouping | Shipped | `ForecastResult.itemId`; unmapped demand retained |
| B-Aggregate reconciliation | Shipped | `apps/web/lib/sales/sales-reconciliation.ts` |
| B-Line reconciliation | **Not shipped** | Gated on Gate 2 |
| Stock impact | **None** | Excel + reconciliation are read-only vs stock |

---

## Related docs

- [BOUNDARY.md §3.7](./BOUNDARY.md) — `SalesHistory` ownership and stock non-goal
- Sales Reconciliation plan (local) — architecture slices A, D', B-Aggregate, C
