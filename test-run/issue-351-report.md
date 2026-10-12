## Edge & negative case test report — Delivery, POD & nota follow-ups

Re-verified all 13 shipped items against the running code on the local MariaDB test bed (`:3308`), never prod. I drove the real server actions and the proof-upload route through an opt-in driver with a mocked session and a mocked R2, and checked the screens in the browser as admin and as the salesman.

**Result: every shipped fix holds. I found 3 further bugs around them and fixed them in 6551e224, pushed to master.**

### The 13 items, re-verified

- **Proof upload authorisation and key sanitising (#383):**
  - Refused with the right status for: no session, missing permission, unsafe ids, a bad photo kind, type or size, and a PACKED shipment.
  - A shipment that doesn't exist, isn't salesman-carry, or belongs to someone else all return the identical "not found", so they can't be told apart.
  - A same-carrier retry after completion gets the stored photo back and writes nothing.
  - The completion also refuses a photo key from another shipment's folder, a path-traversal key, and a nota photo that reuses the goods photo.
- **My Deliveries queue (#382):** shows only the salesman's own in-transit, salesman-carry shipments.
- **Completion page (#382):**
  - A delivered shipment shows "cannot be completed here" instead of the form.
  - Another carrier's shipment is a 404.
  - The GPS "denied" state has its retry button (checked in code; no GPS hardware in this session).
- **Completion guards:**
  - Wrong carrier, GPS that is null, NaN or out of range, a store outside the radius, a store with no coordinates, a blank or overlong receiver name, and a duplicated or missing line are each refused with their own code.
  - A partial completion produced exactly one delivery, one receivable, one faktur and both journals.
  - A 5-day-old offline timestamp was clamped to now.
- **Retry after a lost response (#386):**
  - Salesman-carry compares quantities only, so a retry still completes after the nota dates were corrected in between.
  - Expedition and hand-entered deliveries compare the dates too.
  - A retry with every quantity at zero is refused.
  - Every refusal carries the recorded values, and the recorded delivery's journals post even on the refusal.
- **Error mapping (#386):** a released reservation now reports "reservation mismatch", not "over-delivery".
- **Shipment detail page (#385):**
  - Photos, GPS, distance, receiver and the delivery document render correctly.
  - A tampered row (a key from another shipment's folder, or a stored URL with no key) shows "cannot be displayed" and never the stored URL.
  - Both dialogs handle a failed load.
- **Dashboard (#384):** an approved, undelivered order counts at its total, then at the remainder after a partial delivery, and leaves the bucket once the remainder is closed.
- **Logout (#391):**
  - Blocked while a delivery completion is queued, with a Review link.
  - Signs out cleanly once the queue is empty.
  - The dev build has no service worker, so cache clearing rests on its unit tests.
- **Store coordinate review (#392):** the three filters work and combine with search; see the fix below.

### Bugs found and fixed

1. **Any signed-in user could raise a "delivery completion stuck" warning to admins.** It worked for any shipment id, even one that doesn't exist, and whatever reason text was sent went into the admin message (a 5,000-character reason went straight in).
   - The report is deliberately not permission-gated, so a salesman whose POD permission was revoked can still report.
   - It is now tied to the shipment instead: only the shipment's assigned carrier on a salesman-carry shipment can raise it.
   - Any reason that isn't an error code is recorded as "UNKNOWN".
2. **A store with a custom radius but no coordinates appeared under both "Missing coordinates" and "Custom radius."** Such a store has no radius check at all, so "Custom radius" now requires coordinates too, and the three filters no longer overlap.
3. **The first PWA logout press showed "New unsynced items appeared, so you were not logged out"** whenever anything was queued, although nothing new had appeared. That message now shows only when the device had just synced everything; otherwise the dialog explains on its own.

### Note

- The coordinate review itself is still the go-live check in `docs/FOLLOWUPS.md` (moved to #362). The review screen is ready for it.

Scoped regression specs: 86 passed (including 4 new ones for the stuck report); driver 8/8 green.
