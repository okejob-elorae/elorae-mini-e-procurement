## Edge & negative case test report — Inventory Extensions

Ran locally against the MariaDB test bed (`:3308`), never prod. 60+ cases across store-to-store transfer, store stock as a virtual warehouse, the location-aware movement ledger, and canvasser van stock. They ran through an opt-in end-to-end driver over the real writers and in the browser for the access and UI checks.

### Result

| Area | Result |
|---|---|
| Store-to-store transfer: create refusals, approve at source's current cost, no floor, double approve / cancel after approve, cancel audit, `COUNTED_SINCE_MOVE`, `TRANSFER_PENDING`, KONSI → PUTUS, duplicate lines | ✅ pass, after one fix below |
| Access: SPG opening store transfers / canvassing / movements | ✅ bounced to "No access" |
| Store stock across locations: main + store + van fold, main `available` excludes store/van, stock card "other locations" | ✅ pass |
| Movement ledger: per-location sections with running balance, empty filter = nothing, WIB "today" window, section balance = balance table | ✅ pass |
| Van stock: empty load, load vs `onHand − reserved` (all-or-nothing), merged duplicates, sale over van stock / no price / underpayment, van sale priced PUTUS at a KONSI store, idempotent replay, reconcile count mismatch / missing note / shortfall / empty van | ✅ pass |
| Ledger last balance = balance table for every touched store/van key; total conserved across moves | ✅ pass |

### Bug fixed (pushed to master: 85667425)

**A store transfer line could name a variant the item does not stock.** An unknown variant, a blank key on a variant item, or a variant key on a simple item were all accepted. On approve, the transfer then created destination stock under a key no stock can exist at. The transfer now refuses these lines with `BAD_VARIANT`. A key the source store already holds stays transferable, so legacy stock is never stranded. Copy is in both languages, and regression tests were added.

### Open findings (need a decision; logged in `docs/FOLLOWUPS.md`)

1. **No Sales entry point for store transfers.** Creation is backoffice-only (`stores:manage`), but the decision on this card was that Sales initiates and Admin Sales approves.
2. **Inactive stores are accepted** as transfer source/destination, and the create form lists them.
3. **Stock at a PUTUS store is invisible.** A KONSI → PUTUS transfer creates it, but the store page shows stock for KONSI stores only. This is tied to the still-open PUTUS pricing question.
4. **Van reconcile surplus.** Counting more than the van held returns the counted figure to main, and only the required variance note guards it.
5. **Malformed date on the movement card** is silently ignored instead of refused.
