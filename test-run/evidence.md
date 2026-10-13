# Consignment sales smoke evidence

Tested: 2026-08-14, 14:37–14:56 UTC+8  
Revision: `69e85fa85d399d67ec07f68611355ec070b9a734` (`origin/master`)  
Browser: Cursor IDE browser  
Result: **12 passed, 2 passed with environment detours, 0 functional failures**

## Results

| Case | Result | Evidence |
|---|---|---|
| K-01 KONSI store setup | PASS | Store `SMOKE-KONSI-20260814` showed Active, Konsi, 30 days, 20% margin |
| K-02 Salesman sign-in | PASS WITH FIXTURE | Seeded local `SALESMAN`/`pwa:access`; login redirected to `/pwa`; wildcard admin was redirected away from PWA |
| K-03 Before check-in | PASS | Store page showed Check in and no active visit |
| K-04 Check-in | PASS | Active visit created; browser coordinates were 3,690,233 m away and correctly produced a warn-only out-of-radius badge |
| K-05 KONSI catalog | PASS | Fixture products showed stock and Baru badges; no prices or appeals were rendered |
| K-06 Simple + variant cart | PASS | Selected base qty 2 and variant M qty 1; sticky summary reported `3 item · 2 SKU` |
| K-07 Submit | PASS WITH SCHEMA DETOUR | First attempt rolled back on a missing column; after local schema recovery, `KONSI/2026/0001` was created Pending Approval with total/line prices zero and no reservation |
| K-08 Backoffice filter/list | PASS | Konsi filter returned one submitted row with store, salesman, date, and pending status |
| K-09 Pending detail | PASS | Detail showed quantity and availability only; no money columns or delivery controls |
| K-10 Never-sent suggestions | PASS | Search returned `SMOKE-KONSI-SUGGEST`, excluded items already requested, and showed available 10 (`12 on hand − 2 reserved`) |
| K-11 Approve + added line | PASS | Added suggestion qty 1; approval created three `FIELD_SALES_KONSI` reservations, left on-hand unchanged, applied 20% gross-up prices, and wrote no `SalesHistory` |
| K-12 Store history | PASS | Recent orders showed the approved transfer; Items Sent showed all three article/variant quantities |
| K-13 Insufficient stock | PASS | Qty 99 against availability 8 showed the short-line warning; approval remained pending with zero reservations |
| K-14 Reject | PASS | Empty reason kept confirmation disabled; supplied reason was persisted; order became Rejected with zero reservations |

## Database evidence

Pending order before approval:

```json
{
  "orderNo": "KONSI/2026/0001",
  "status": "PENDING_APPROVAL",
  "type": "KONSI",
  "total": 0,
  "linePrices": [0, 0],
  "reservations": 0,
  "jubelioOutboxCount": 1
}
```

Approved order:

```json
{
  "status": "APPROVED",
  "total": 237500,
  "lines": [
    { "sku": "SMOKE-KONSI-BASE", "qty": 2, "unitPrice": 50000, "reserved": 2 },
    { "sku": "SMOKE-KONSI-VARIANT-M", "qty": 1, "unitPrice": 75000, "reserved": 1 },
    { "sku": "SMOKE-KONSI-SUGGEST", "qty": 1, "unitPrice": 62500, "reserved": 1, "addedByAdmin": true }
  ],
  "qtyOnHandChanged": false,
  "salesHistoryRows": 0,
  "jubelioOutboxCount": 1
}
```

Negative cases:

```json
{
  "insufficient": {
    "orderNo": "KONSI/SMOKE/INSUFFICIENT",
    "status": "PENDING_APPROVAL",
    "reservations": 0
  },
  "rejected": {
    "orderNo": "KONSI/SMOKE/REJECT",
    "status": "REJECTED",
    "rejectReason": "Smoke test rejection — local fixture",
    "reservations": 0
  },
  "jubelioOutboxCount": 1
}
```

The `JubelioOutbox` count was 1 before fixture setup, after setup, after create, after approve, and after both negative cases. The smoke test added **zero** outbox rows.

## Screenshots

Copies live in `test-run/screenshots/`:

1. `01-store-before-checkin.png`
2. `02-konsi-catalog-price-hidden.png`
3. `03-konsi-review-no-prices.png`
4. `04-backoffice-pending-konsi-list.png`
5. `05-konsi-never-sent-suggestion-staged.png`
6. `06-konsi-approved-reserved.png`
7. `07-store-konsi-history-items-sent.png`
8. `08-store-konsi-history-items-sent.png`
9. `09-konsi-insufficient-stock-refused.png`
10. `10-konsi-rejected-with-reason.png`

## Related KONSI surfaces not executed

Code mapping confirmed these as in-module but they were left out of this run:

- Smart-request (`/pwa/stores/[id]/smart-request`) is PUTUS-only and should redirect for KONSI.
- Approved-order “Print Goods Issue Note” / Surat Keluar was visible after K-11 but not printed.
- Offline Dexie queue / `/pwa/orders/pending` replay was not exercised.
- Changing a store’s terms after a queued offline submit can change the resulting order type; that race was not reproduced.

## Findings and notes

### F-01 — Local MySQL cannot apply a latest-master migration

Severity: environment compatibility / blocks local testing

The verified local database is MySQL 8.0.41. Migration `20260813140000_add_field_sales_line_added_by` uses:

```sql
ALTER TABLE `FieldSalesOrderLine` ADD COLUMN IF NOT EXISTS `addedById` VARCHAR(191) NULL;
```

`prisma migrate deploy` failed with P3018 / MySQL error 1064 because this `IF NOT EXISTS` form is MariaDB-specific. The smoke test used a local-only detour:

1. Added `addedById` with MySQL-compatible SQL.
2. Marked the migration applied with `prisma migrate resolve --applied`.
3. Re-ran `migrate:deploy`; no migrations remained.

The failed order submit fully rolled back: zero orders, zero reservations, and no outbox delta. Production runs MariaDB, so this is specifically a documented local-MySQL compatibility gap.

### F-02 — Suggestions render the entire eligible catalog — PATCHED on `fix/konsi-suggestions-perf-and-list-total`

Severity: performance/usability

**Not** the PWA catalog screenshot (`02-konsi-catalog-price-hidden.png`). That file is K-05 evidence that KONSI hides prices correctly.

F-02 is the backoffice **New Product Suggestions** panel (see `05-konsi-never-sent-suggestion-staged.png`): expanding it mounted ~900 Habis rows and thousands of qty steppers.

Fix: `listKonsiSuggestions` now omits `available <= 0`, and the card paginates at 50 rows.

### F-03 — Pending KONSI list shows `Rp 0` — PATCHED on `fix/konsi-suggestions-perf-and-list-total`

Severity: cosmetic

The Field Orders list now shows `—` for non-approved KONSI totals (pending/rejected), matching the detail page’s “no money until approve” rule.

### Environment warnings

- Firebase Admin initialization failed because the local private key was invalid. Field-order writes continued and the local `AdminNotification` row was created; push fanout was not part of this smoke scope.
- `firebase-messaging-sw.js` returned 404 in development.
- `finance.glCutoverDate` is unset, so the sales-journal cron remained inert as expected.
- Only `apps/web` ran. `apps/api`, Redis workers, and Jubelio outbox processing were not started.
- Field-sales create/approve/reject/reserve does not enqueue `JubelioOutbox`. Adjacent Jubelio UI (item Push stock, catalog sync, opname approve, marketplace pick/pack/ship) was not opened.
- `DATABASE_URL` was verified as `localhost:3306/elorae` before any mutation.

## Artifacts

- `test-run/README.md` — plan, story, safety boundary, and cases
- `test-run/setup-consignment-smoke.cjs` — idempotent local fixture setup
- `test-run/setup-consignment-negative-cases.cjs` — scoped negative fixtures
- `test-run/evidence.md` — this report
