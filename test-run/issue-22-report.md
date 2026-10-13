## Edge & negative case test report — Order Processing

Ran against the local MariaDB test bed (`:3308`), never prod. I drove the real server actions (putus/konsi approve, reject, delivery, remainder close, date correction, nota print) through an opt-in driver with a mocked session, and checked the screens in the browser as admin and as the warehouse user.

**Result: 5 bugs found and fixed in f44b4971, pushed to master. Every other case passed.**

### Bugs fixed

1. **Orders could be rejected with no reason.** The dialog hides the button on a blank reason, but the server action accepted one and stored no reason. It now refuses with a "reason required" error (copy in both locales).
2. **The salesman was never told an order was rejected** (story 18-01). Rejecting now sends the salesman a notification with the reason. It is sent once (re-rejecting does not resend) and best-effort (a failed push never undoes the rejection). Tapping it opens the store in the PWA.
3. **A credit-override reason longer than 191 characters crashed the approval** with an unhandled database error (the audit-log column holds 191). The order still keeps the full reason; only the audit copy is shortened.
4. **A nota date-correction reason longer than 191 characters crashed the same way.** The audit row is that reason's only record, so the server now refuses it and the dialog stops input at 191 characters.
5. **The putus approval confirm said "Stock will be consumed immediately."** That has been false since deliveries shipped: approval keeps stock reserved, and it leaves the warehouse when a delivery is recorded. Copy corrected in both locales.

### Passed

- **Putus approve/reject:** reserve on approve; release on reject; state guards; double approve/reject are idempotent; missing permission refused; the credit limit blocks without an override reason and records an audit row with one.
- **Delivery:** partial deliveries; over-delivery refused; exactly one faktur and one receivable per delivery; a retry with the same key is refused with the recorded values when it differs; remainder close releases the rest and is refused while a shipment is in flight; date correction is refused once the receivable has payments.
- **Faktur hand-off on nota print:** the first print stamps the nota and raises one finance notification; a reprint is only audited; missing permission or a blank id does nothing.
- **Konsi approve:** reserves only (no receivable, faktur, delivery or store stock); every refusal for an added line (duplicate, already sent, unknown item, no inventory, not konsi); admin-added lines are marked as such.
- **Access / UI:**
  - The warehouse user is redirected away from order detail.
  - The short-stock konsi suggestion panel opens by itself.
  - A partially delivered order shows both delivery documents, the closed status, the close reason and zero remaining.

### Notes (logged in `docs/FOLLOWUPS.md`)

- After a remainder close, the order detail still shows the ordered total (e.g. Rp 700.000 where Rp 550.000 was delivered), with no delivered/cancelled split per line.
- The PWA shows the reject reason nowhere; the new notification is the only place the salesman sees it.
- The 2026-09-15 comment on this card says konsi approval moves stock via `issueKonsiTransfer`. That is out of date: approval only reserves, and stock reaches the store when a delivery shipment completes. The code is right; the comment is stale.
- 18-07 (raise a return) was out of scope here; it was covered on #26.

Scoped regression specs: 107 passed.
