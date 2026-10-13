# Delivery, POD & nota follow-ups — edge & negative case plan

Card: [#351 Follow-ups: Field sales — Delivery, POD & nota](https://github.com/okejob-elorae/elorae-mini-e-procurement/issues/351). All 13 items are ticked as shipped (PRs #382, #383, #384, #385, #386, #391, #392). This plan re-verifies each shipped fix against the running code on the local `:3308` bed and probes the paths around it.

Driver: `apps/web/lib/delivery/pod-followups-e2e.test.ts` (opt-in, `PODF_E2E=1`, `:3308` only). It calls the real server actions and route handlers with a mocked session; R2 is mocked (not configured locally). Browser checks cover the screens.

Fixtures per run: items A and B (on-hand 100), a geocoded PUTUS store (radius 100 m), an ungeocoded PUTUS store, a KONSI store; putus orders approved through the action; shipments packed, tracked and shipped through the backoffice actions. Actors: admin, `salesman@elorae.com` (carrier), `spg@elorae.com` (a second actor).

## A — POD proof upload route (#383: authorisation + key sanitising)

| ID | Case | Expected |
|---|---|---|
| A-01 | No session | 401 |
| A-02 | Session without `deliveries:pod` | 403 |
| A-03 | `shipmentId` = `../x`, `a/b`, 65 chars, `a.b` | 400 `invalid shipmentId`, nothing uploaded |
| A-04 | `clientId` = `signature` / `../goods` | 400 `invalid clientId` |
| A-05 | `text/plain` file; 10 MB + 1 byte | 400 |
| A-06 | Unknown shipment id | 404 `NOT_FOUND` |
| A-07 | EXPEDITION shipment, even one naming this salesman as carrier | 404 (same body) |
| A-08 | SALESMAN_CARRY shipment carried by someone else | 404 (same body) |
| A-09 | Own shipment still PACKED | 409 |
| A-10 | Own IN_TRANSIT shipment | 200; key `delivery-pod-proofs/<id>/goods.jpg` (deterministic) |
| A-11 | Same carrier re-uploads after completing (lost-response replay) | 200 with the STORED key; R2 not written |

## B — Salesman-carry completion (#382, #386)

| ID | Case | Expected |
|---|---|---|
| B-01 | Another POD holder completes the salesman's shipment | `NOT_CARRIER` |
| B-02 | GPS `null` / `NaN` / lat 91 | `MISSING_GPS` (never a fabricated 0 m) |
| B-03 | GPS 1 km away | `GPS_OUT_OF_RADIUS` |
| B-04 | Store has no coordinates | `STORE_NOT_GEOCODED` |
| B-05 | Goods key from another shipment's folder / traversal key | `MISSING_PROOF` |
| B-06 | Nota key equal to goods key / outside the shipment folder | `MISSING_NOTA_PHOTO` |
| B-07 | Receiver name blank / 121 chars | `MISSING_SIGNED_BY` |
| B-08 | Duplicate line id / a line omitted | `LINE_MISMATCH`; shipment still IN_TRANSIT |
| B-09 | Valid partial completion | `PARTIALLY_DELIVERED`; one delivery, one receivable, one faktur; both journals posted |
| B-10 | Same carrier replays with an empty payload | ok; nothing duplicated |
| B-11 | Different actor hits the delivered shipment | refused (`INVALID_STATE`) |
| B-12 | Offline `deliveredAt` 5 days old | clamped to now |

## C — Replay after a lost response (#386 decisions)

Simulated crash window: the delivery is recorded under `shipment-<id>` while the shipment stays IN_TRANSIT.

| ID | Case | Expected |
|---|---|---|
| C-01 | SALESMAN_CARRY retry with different quantities | `REPLAY_MISMATCH` carrying recorded values; shipment untouched; journals of the recorded delivery posted |
| C-02 | SALESMAN_CARRY retry, same quantities, delivery dates corrected in between | ok (lines-only compare); shipment stamped with the recorded delivery id |
| C-03 | Retry with every quantity 0 | `REPLAY_MISMATCH`, shipment untouched |
| C-04 | EXPEDITION retry with re-typed dates | `REPLAY_MISMATCH` with the recorded dates |
| C-05 | Hand-entered delivery retry with changed dates | `REPLAY_MISMATCH` |
| C-06 | Delivery whose reservation was released underneath (over-consume) | `RESERVATION_MISMATCH`, not `OVER_DELIVER` |

## D — Queue, completion page, stuck report (#382, offline path)

| ID | Case | Expected |
|---|---|---|
| D-01 | `listMyDeliveries` with an EXPEDITION shipment that names the salesman, a PACKED one, and another carrier's | only the salesman's IN_TRANSIT SALESMAN_CARRY shipment |
| D-02 | Offline classifier vs the full error union | every code classified; permanent codes terminal |
| D-03 | Stuck-delivery report from a user who does not carry the shipment, or for an id that does not exist | refused; no admin notification |
| D-04 | Stuck report with an oversized / free-text reason | refused or bounded |
| D-05 | Browser: salesman opens a delivered shipment's completion page | "cannot be completed here" notice, no form |
| D-06 | Browser: salesman opens another carrier's shipment | 404 |

## E — Shipment detail page (#385)

| ID | Case | Expected |
|---|---|---|
| E-01 | Completed SALESMAN_CARRY shipment | both photos derived from keys; GPS, distance, receiver name, delivery doc shown |
| E-02 | Row whose stored key is outside its folder / URL with no key | "cannot display", never the stored URL |
| E-03 | Browser: detail page as admin, and the dialogs' failed-load state | renders; a failed load shows an error, not an empty dialog |

## F — Dashboard awaiting-delivery bucket (#384)

| ID | Case | Expected |
|---|---|---|
| F-01 | Approved, undelivered putus order | counts in awaiting delivery at its total |
| F-02 | After a partial delivery | residual = total − delivered; realised grows by the delivery |
| F-03 | After closing the remainder | leaves the bucket |

## G — Logout with unsynced items (#391) and store coordinate review (#392)

| ID | Case | Expected |
|---|---|---|
| G-01 | Browser: logout with a queued completion in IndexedDB | blocked; dialog lists it with a review link |
| G-02 | Browser: logout with an empty queue | signs out; page cache emptied except the offline page |
| G-03 | Store filter `missing` / `defaultRadius` / `customRadius`, combined with search, bad value | correct sets; search still applies; bad value = no filter |
| G-04 | Store with a custom radius but no coordinates | which bucket and badge it lands in |
