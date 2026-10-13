# Putus field-sales smoke evidence

Tested: 2026-08-14, 16:24–16:44 UTC+8  
Revision: `69e85fa85d399d67ec07f68611355ec070b9a734` on `fix/konsi-suggestions-perf-and-list-total` (uncommitted KONSI UI patches present; PUTUS core unchanged)  
Browser: Cursor IDE browser  
Runtime: local `apps/web` only on `http://localhost:3000`; `apps/api` not running  
Result: **11 passed, 3 passed with notes, 0 functional failures, 1 optional case not run**

## Results

| Case | Result | Evidence |
|---|---|---|
| P-01 PUTUS store setup | PASS WITH FIXTURE | Seeded dedicated store `SMOKE-PUTUS-20260814`; detail showed Active, Putus, 30-day tempo |
| P-02 Salesman sign-in | PASS | `salesman@elorae.com` landed on `/pwa`; existing non-system SALESMAN role had `pwa:access` |
| P-03 Before check-in | PASS | Catalog was readable and priced, but every fixture item said “Check in untuk pesan” and exposed no qty controls |
| P-04 Check-in | PASS | Checking into PUTUS auto-closed the active KONSI visit; new visit stayed open; 3,690,232 m radius warning remained warn-only |
| P-05 PUTUS catalog | PASS | `SMOKE-PUTUS-*` showed availability and prices (`Rp 50.000`, `Rp 30.000`, `Rp 75.000`) |
| P-06 Simple + variant cart | PASS | Base qty 2 + variant M qty 1; review showed 3 items, 2 SKU lines, total `Rp 175.000` |
| P-07 Submit/reserve | PASS | `PUTUS/2026/0001` created Pending Approval; `FIELD_SALES` reservations 2 + 1; on-hand 40/20 unchanged; no `SalesHistory`; outbox 1 |
| P-08 Backoffice list | PASS | Putus filter returned order, store, salesman, `Rp 175.000`, Pending Approval |
| P-09 Pending detail | PASS | Prices + stock visible; no delivery controls before approval |
| P-10 Approve paperwork-only | PASS WITH FINDING | DB verified Approved/Pending delivery, on-hand unchanged, reservations still RESERVED, no history; approval dialog copy incorrectly promised immediate consume (finding FP-01) |
| P-11 Full delivery | PASS | `DLV/2026/08/0001`; delivered qty 2 + 1; on-hand 38/19; reservation state CONSUMED; 2 OFFLINE `SalesHistory` rows under delivery doc; one PENDING `TaxInvoice` |
| P-12 Nota + tax queue | PASS WITH HARNESS LIMITATION | Both print actions invoked; dashboard audit showed Gudang + Tagihan PRINT; first invoice print stamped `notaPrintedAt`; finance queue listed `DLV/2026/08/0001` Pending. Native OS print preview itself is not exposed to Cursor IDE browser |
| P-13 Store history | PASS | Recent Orders showed approved `PUTUS/2026/0001`; Items Sent showed base 2 + variant M 1 |
| P-14 Reject path | PASS | Second order `PUTUS/2026/0002`; empty reason kept Reject disabled; supplied reason persisted; reservation moved to RELEASED; on-hand stayed 38 |
| P-15 Delivery insufficient stock | NOT RUN (OPTIONAL) | Deferred per plan after the core and reject paths passed |

## Database evidence

### Pending after P-07

```json
{
  "orderNo": "PUTUS/2026/0001",
  "status": "PENDING_APPROVAL",
  "deliveryStatus": "PENDING",
  "total": 175000,
  "lines": [
    { "sku": "SMOKE-PUTUS-BASE", "qty": 2, "qtyOnHand": 40, "reservedQty": 2 },
    { "sku": "SMOKE-PUTUS-VARIANT", "variantSku": "SMOKE-PUTUS-VARIANT-M", "qty": 1, "qtyOnHand": 20, "reservedQty": 1 }
  ],
  "reservationStates": ["RESERVED", "RESERVED"],
  "salesHistoryRows": 0,
  "jubelioOutboxCount": 1
}
```

### Approved after P-10

```json
{
  "status": "APPROVED",
  "deliveryStatus": "PENDING",
  "qtyOnHand": [40, 20],
  "reservedQty": [2, 1],
  "reservationStates": ["RESERVED", "RESERVED"],
  "salesHistoryRows": 0,
  "jubelioOutboxCount": 1
}
```

Approval correctly did **not** consume inventory despite the stale confirmation text.

### Delivered after P-11/P-12

```json
{
  "status": "APPROVED",
  "deliveryStatus": "DELIVERED",
  "delivery": {
    "docNo": "DLV/2026/08/0001",
    "qty": [2, 1],
    "total": 175000,
    "invoiceDate": "2026-08-14",
    "dueDate": "2026-09-13"
  },
  "inventory": {
    "SMOKE-PUTUS-BASE": { "qtyOnHand": 38, "reservedQty": 0 },
    "SMOKE-PUTUS-VARIANT-M": { "qtyOnHand": 19, "reservedQty": 0 }
  },
  "reservations": [
    { "qty": 2, "consumedQty": 2, "state": "CONSUMED" },
    { "qty": 1, "consumedQty": 1, "state": "CONSUMED" }
  ],
  "salesHistory": [
    { "orderId": "DLV/2026/08/0001", "variantSku": "SMOKE-PUTUS-BASE", "quantity": 2, "channel": "OFFLINE" },
    { "orderId": "DLV/2026/08/0001", "variantSku": "SMOKE-PUTUS-VARIANT-M", "quantity": 1, "channel": "OFFLINE" }
  ],
  "taxInvoice": {
    "status": "PENDING",
    "notaPrintedAt": "2026-08-14T08:40:01.852Z"
  },
  "jubelioOutboxCount": 1
}
```

### Rejected after P-14

```json
{
  "orderNo": "PUTUS/2026/0002",
  "status": "REJECTED",
  "rejectReason": "Smoke test rejection path",
  "qtyOnHand": 38,
  "reservedQty": 0,
  "reservation": { "qty": 1, "consumedQty": 0, "state": "RELEASED" },
  "deliveries": 0,
  "jubelioOutboxCount": 1
}
```

## Safety result

- Initial `JubelioOutbox.count()`: **1**
- Final `JubelioOutbox.count()`: **1**
- Delta: **0**
- `apps/api`: not started
- Jubelio screens/actions: not used

## Screenshots

1. `screenshots/putus/01-putus-before-checkin.png`
2. `screenshots/putus/02-putus-catalog-priced.png`
3. `screenshots/putus/03-putus-review-submit.png`
4. `screenshots/putus/04-backoffice-pending-putus.png`
5. `screenshots/putus/05-putus-delivered.png`
6. `screenshots/putus/06-putus-tax-queue.png`
7. `screenshots/putus/07-store-putus-items-sent.png`
8. `screenshots/putus/08-putus-rejected.png`
9. `screenshots/putus/09-putus-approval-copy-stale.png`

## Finding FP-01 — PUTUS approval confirmation states obsolete stock behavior

Severity: **medium UX / operational correctness**

The PUTUS approval confirmation says:

> Approve this order? Stock will be consumed immediately.

That is false under the current delivery architecture. Fresh DB evidence proves approval left:

- `qtyOnHand` unchanged at 40 / 20;
- reservations in `RESERVED`;
- `SalesHistory` empty;
- `deliveryStatus=PENDING`.

Stock correctly left only when `DLV/2026/08/0001` was recorded. The copy should say that approval finalizes the order and stock remains reserved until delivery. The Indonesian translation should be checked and corrected in the same patch.

Evidence: `screenshots/putus/09-putus-approval-copy-stale.png`.

## Environment notes

- Local `Permission` rows for `field_sales_orders:deliver` and `tax_invoices:*` were absent. The system administrator wildcard still authorized both surfaces, so the end-to-end admin flow was testable. This is a local seed-state note, not a production permission finding (production seed status is documented separately).
- Firebase Admin private-key parsing logs remain broken locally; durable in-app notification rows and tax queue behavior still worked. External push delivery was outside this smoke.
- Browser GPS resolved to `24.1134, 120.6520`, producing the expected warn-only out-of-radius badge against the Jakarta fixture pin.
