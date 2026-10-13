# Order Processing — edge & negative case plan

Card: [#22 Order Processing](https://github.com/okejob-elorae/elorae-mini-e-procurement/issues/22) (board status "In review").
Scope per the card and its locked client decisions: putus review/approve/reject (18-01) incl. credit limit gate, konsi review/approve with the admin suggest panel (18-02), per-delivery Nota Gudang + Nota Tagihan with a receivable and manual dates (18-03), konsi approve = reserve only (18-04), faktur notification on first nota print (18-05), partial delivery + remainder close (18-06). 18-07 (raise retur) was verified on #26 and is out of scope here.

Happy path already covered by `test-run/putus-evidence.md` (2026-08-14); this plan targets edges and refusals.

Environment: local only — MariaDB test bed `:3308`, dev server `:3100`. Driver `apps/web/lib/field-sales/order-processing-e2e.test.ts` (opt-in, `OPE_E2E=1`) calls the real `"use server"` actions with a mocked session, so action-boundary validation is exercised too.

## A — Putus approve / reject (18-01)
| ID | Case | Expected |
|---|---|---|
| A-01 | Approve with a final price for an appealed line + a stray price for a non-appealed line | Appealed line repriced, stray ignored, total recomputed |
| A-02 | Approve twice / approve after reject | Second approve `ok` (idempotent) / `INVALID_TRANSITION` |
| A-03 | Reject twice / reject an approved order | `ok` / `INVALID_TRANSITION`; reject releases every reservation, on-hand untouched |
| A-04 | Reject with a blank reason through the action | Refused (card: "reject → salesman receives notification with reason") |
| A-05 | Over credit limit without override | `CREDIT_LIMIT_EXCEEDED` with exposure; nothing written (status, line prices) |
| A-06 | Override without `credit_override` permission | `FORBIDDEN` |
| A-07 | Override with reason | Approved, snapshot columns set, one `CREDIT_LIMIT_OVERRIDE` audit row |
| A-08 | Override reason longer than 191 chars (the `AuditLog.reason` column) | Typed refusal or a stored (truncated) audit reason — never an untyped DB error |
| A-09 | `addedLines` on a putus order | `INVALID_ADDED_LINE` / `NOT_KONSI` |
| A-10 | Malformed final prices (negative, NaN) | `INVALID_FINAL_PRICE` |
| A-11 | Salesman is told about the rejection and its reason | Notification to the salesman / reason visible in the PWA |

## B — Delivery, partial delivery, remainder (18-03, 18-06)
| ID | Case | Expected |
|---|---|---|
| B-01 | Partial delivery | `PARTIAL`; one delivery doc with entered invoice/due dates; exactly one `TaxInvoice` + one `Receivable` for it |
| B-02 | Second delivery finishing the order | `DELIVERED`; distinct doc no; delivery totals sum to the order total |
| B-03 | Qty above outstanding, incl. two lines on one order line summing over | `OVER_DELIVER`, nothing moved |
| B-04 | Qty 0 / negative / fractional | `OVER_DELIVER` |
| B-05 | Due before invoice / `2026-02-30` / non-string date | `INVALID_DATES` / `INVALID_REQUEST` / `INVALID_REQUEST` |
| B-06 | Missing or over-long idempotency key | `INVALID_REQUEST` |
| B-07 | Replay same key same payload / changed qty | Same doc, nothing twice / `REPLAY_MISMATCH` carrying the recorded values |
| B-08 | Deliver a pending / rejected / konsi order | `INVALID_STATE` |
| B-09 | On-hand short at delivery | `INSUFFICIENT_STOCK` naming the line, nothing written |
| B-10 | Close remainder after partial | Remainder cancelled, its reservation released, `closeReason` stored, status settles |
| B-11 | Close remainder: blank reason / nothing outstanding / not approved | Refused |
| B-12 | Close remainder while a shipment is PACKED | `SHIPMENT_IN_FLIGHT`, nothing cancelled |
| B-13 | Deliver after the remainder is closed | `OVER_DELIVER` |
| B-14 | Correct nota dates with blank reason / inverted dates / on a paid receivable | `INVALID_REQUEST` / `INVALID_DATES` / `RECEIVABLE_HAS_PAYMENTS` |
| B-15 | Correct nota dates with a reason longer than 191 chars | Typed refusal or stored audit — never an untyped DB error |
| B-16 | Correct nota dates happy path | Delivery + receivable move together, docNo unchanged, one audit row |

## C — Faktur notification on print (18-05)
| ID | Case | Expected |
|---|---|---|
| C-01 | First print of a nota tagihan | `notaPrintedAt` stamped, exactly one `TAX_INVOICE_PENDING` notification, print audit row |
| C-02 | Reprint | Audit row, no second notification, stamp unchanged |
| C-03 | Print with empty id | No-op — no mass stamp of unprinted fakturs |
| C-04 | Print without `field_sales_orders:view` | Nothing stamped |

## D — Konsi approve (18-02, 18-04)
| ID | Case | Expected |
|---|---|---|
| D-01 | Approve | Reserves only: on-hand unchanged, no `Receivable`, `TaxInvoice`, delivery, `SalesHistory` or `StoreStock` |
| D-02 | Added lines: duplicate / qty 0 / unknown item / no inventory row / already-sent item | Refused with the matching code, order still pending, nothing added |
| D-03 | Valid added line | Line created with `addedById`, reserved with the rest |
| D-04 | Short stock | `INSUFFICIENT_STOCK` naming lines, nothing reserved, still pending |
| D-05 | Re-approve an approved konsi order with added lines | `INVALID_TRANSITION` |

## E — Access and UI (browser)
| ID | Case | Expected |
|---|---|---|
| E-01 | Non-approver opens the order list / detail | No access |
| E-02 | Putus approval confirm copy | Says stock stays reserved until delivery (re-check of earlier finding FP-01) |
| E-03 | Short-stock order detail | Insufficient-stock alert shown before approval |
| E-04 | Partially delivered order detail | Remaining qty per line, close-remainder control needs a reason |
