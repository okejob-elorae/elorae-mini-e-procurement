# Order Processing — edge & negative case evidence

Card: [#22 Order Processing](https://github.com/okejob-elorae/elorae-mini-e-procurement/issues/22). Plan: `test-run/order-processing-edge-plan.md`.

Environment: local MariaDB test bed `:3308`, dev server `:3100`. Driver `apps/web/lib/field-sales/order-processing-e2e.test.ts` (opt-in, `OPE_E2E=1`) calls the real server actions with a mocked session; last run `muntd1n8` — every case PASS, raw log `test-run/ope-run.log`. Browser checks as admin and as the warehouse user.

## Result summary

| Area | Cases | Result |
|---|---|---|
| Putus approve / reject (A) | A-01..A-10 | PASS after fixes (A-04, A-08 were bugs) |
| Salesman told of rejection (A-11) | — | Was missing; fixed |
| Delivery, partial, remainder, date correction (B) | B-01..B-16 | PASS after fix (B-15 was a bug) |
| Faktur notification on print (C) | C-01..C-04 | PASS — first print stamps + one notification, reprint audits only, empty id and missing permission are no-ops |
| Konsi approve (D) | D-01..D-05 | PASS — reserve only, no AR/faktur/delivery/StoreStock; every added-line refusal code; admin-added line marked |
| Access / UI (E) | E-01..E-04 | PASS; E-02 was a stale-copy bug, fixed |

## Bugs found and fixed

1. **A-04 — an order could be rejected with no reason.** The reject dialog withholds the button on a blank reason, but the server action accepted one and stored `rejectReason = null`. The action now refuses `REASON_REQUIRED` (copy in both locales).
2. **A-11 — the salesman was never told an order was rejected.** Card 18-01 requires it. `rejectFieldSalesOrder` now sends a `FIELD_SALES_ORDER_REJECTED` notice carrying the reason after the commit, best-effort (a failed push never fails the rejection), once (an idempotent re-reject does not resend). The bell link opens the store in the PWA.
3. **A-08 — a credit-override reason over 191 characters crashed the approval** with an untyped database error (`AuditLog.reason` is `VARCHAR(191)`). The order keeps the full reason (`@db.Text`); only the audit copy is capped.
4. **B-15 — a nota date-correction reason over 191 characters crashed the same way.** The audit row is that reason's only record, so the action now refuses it (`INVALID_REQUEST`) and the dialog caps input at 191.
5. **E-02 — the putus approval confirm said "Stock will be consumed immediately."** False since deliveries shipped (approval keeps stock reserved; it leaves at delivery) — first flagged on the 2026-08-14 putus smoke and still live. Corrected in both locales.

Also hardened: the close-remainder action no longer throws on a non-string reason.

## Notes (logged to `docs/FOLLOWUPS.md`)

- After a remainder close the order detail still shows the ordered total (Rp 700.000 where Rp 550.000 was delivered) and no delivered/cancelled split per line.
- The PWA shows no reject reason anywhere; the new notice is the only place the salesman reads it.
- The card's 2026-09-15 comment says konsi approval moves stock via `issueKonsiTransfer`. The code (and D-01) show approval only reserves; stock moves when a delivery shipment completes (landmine: "Working on konsi stock movement?"). The comment is stale, not the code.

## Screenshots

- `screenshots/order-processing/01-konsi-short-stock-pending.png` — suggestion panel opens itself on an unfillable line (E-03)
- `screenshots/order-processing/02-putus-partial-remainder-closed.png` — two delivery docs, corrected due date, remainder closed (E-04)
- `screenshots/order-processing/03-warehouse-no-access-order.png` — warehouse user bounced from the order (E-01)

## Verification

- `lib/field-sales/writer.test`, `app/actions/field-sales-orders.spec`, `app/actions/field-sales-deliveries.spec`, `lib/notifications/navigation`, `lib/field-sales/approve-action` — 107 passed.
