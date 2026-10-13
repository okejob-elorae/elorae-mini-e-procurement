# Delivery, POD & nota follow-ups — edge & negative case evidence

Card: [#351](https://github.com/okejob-elorae/elorae-mini-e-procurement/issues/351). Plan: `test-run/delivery-pod-followups-edge-plan.md`.

Environment: local MariaDB `:3308`, dev server `:3100`. Driver `apps/web/lib/delivery/pod-followups-e2e.test.ts` (opt-in, `PODF_E2E=1`) calls the real server actions and the upload route handler with a mocked session and a mocked R2. Final run `munvr2cn`: every case PASS; raw log `test-run/podf-run.log`. Browser checks as admin and as the salesman.

## Re-verification of the 13 shipped items

| Item (PR) | Cases | Result |
|---|---|---|
| POD upload authorises against the shipment; keys sanitised (#383) | A-01..A-11, B-05, B-06 | PASS — 401/403/400/404/409 as designed; the three "not yours" shapes return the identical 404 body; a same-carrier replay returns the stored key and writes nothing to R2 |
| Queue shows only the salesman's IN_TRANSIT salesman-carry shipments (#382) | D-01 | PASS |
| Completion page fails fast on a wrong-status / other-carrier shipment (#382) | D-05, D-06 (browser) | PASS — "cannot be completed here" notice; another carrier's shipment is a 404 |
| GPS denied retry (#382) | code review | The denied branch has its retry action; no hardware GPS in this session |
| Replay refuses differing values and surfaces them (#386) | C-01..C-05 | PASS — salesman-carry compares lines only (a date correction in the crash window still completes); expedition and hand-entered compare dates too; all-zero retry refused; the recorded delivery's journals post on the refusal |
| Non-stock partial-consume errors no longer collapse onto OVER_DELIVER (#386) | C-06 | PASS — `RESERVATION_MISMATCH` |
| Shipment detail page renders the proof (#385) | E-01, E-02, browser | PASS — photos derive from the stored key; a foreign key or a URL without a key shows "cannot be displayed", never the stored URL |
| Dialog loads have a failure path (#385) | code review | PASS — both dialogs `.catch` the load |
| Dashboard awaiting-delivery bucket (#384) | F-01..F-03 | PASS — total, then residual after a partial delivery, then removed after a remainder close; realised grows by the delivery |
| Logout blocked on unsynced items, offline state cleared (#391) | browser G-01, G-02 | PASS after a copy fix (below); the dev build has no service worker, so cache clearing rests on its unit tests |
| Store coordinate review filter (#392) | G-03, G-04 | PASS after a fix (below) |
| Completion writer guards (#382/#386 surroundings) | B-01..B-12 | PASS — `NOT_CARRIER`, `MISSING_GPS` for null/NaN/out-of-range, `GPS_OUT_OF_RADIUS`, `STORE_NOT_GEOCODED`, `MISSING_SIGNED_BY`, `LINE_MISMATCH`; partial completion produced one delivery, one receivable, one faktur and both journals; a 5-day-old offline timestamp was clamped |

## Bugs found and fixed

1. **Any signed-in user could raise a "delivery completion stuck" admin warning** for any shipment id, real or not, with free text copied into the admin message (a 5,000-character reason went straight in). The action is deliberately permission-free so a salesman whose POD permission was revoked can still report, so it now binds to the shipment instead: only the shipment's assigned carrier on a salesman-carry shipment can raise it, and any reason that is not an error code is recorded as `UNKNOWN`.
2. **A store with a custom radius but no coordinates appeared under both "Missing coordinates" and "Custom radius"** on the stores list. It has no radius gate at all, so "Custom radius" now requires coordinates too and the three filters partition the stores.
3. **The PWA logout said "New unsynced items appeared, so you were not logged out" on the first press** whenever anything was queued, although nothing new had appeared. The toast now shows only when the device was last seen with an empty queue; otherwise the dialog alone explains.

## Screenshots (`screenshots/pod-followups/`)

- `01-shipment-detail-pod.png` — completed salesman-carry shipment, proof panel and location
- `02-tampered-proof-not-displayed.png` — foreign key / keyless URL shown as "cannot be displayed"
- `03-store-filter-custom-radius.png` — Custom radius filter after the fix
- `04-pwa-delivered-not-completable.png` — completion page on a delivered shipment
- `05-logout-blocked-misleading-toast.png` — before the copy fix
- `06-logout-blocked-after-fix.png` — after

## Verification

`app/pwa/deliveries/actions.spec` (new, 4 tests), `lib/stores/queries.test`, `lib/pwa/offline/*` — 86 passed; driver 8/8 green.
