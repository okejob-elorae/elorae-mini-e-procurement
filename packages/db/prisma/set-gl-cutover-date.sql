-- ############################################################################
-- RUN THE SECTIONS ONE AT A TIME and read each PRE-FLIGHT result before the
-- write. This is the switch that ARMS the sales journal sweep: once this key
-- holds a valid date AND the four sales posting roles are mapped, the 5-minute
-- cron begins posting journals for every eligible order on or after it,
-- unattended.
--
-- !! DO NOT RUN THIS YET ON A LEDGER THAT MATTERS !!
-- A known defect makes the sweep stall silently after its first batch wherever
-- orders carry no COGS. See "BLOCKER" below and confirm it is resolved first.
-- ############################################################################
--
-- Sets `SystemSetting["finance.glCutoverDate"]`, the fail-closed floor read by
-- `postPendingSalesJournals` (apps/web/lib/finance/sales/sweep.ts). While the key
-- is absent, empty or not an unambiguous YYYY-MM-DD day, the sweep posts NOTHING
-- and the cron logs that it is inert.
--
-- Edit the date in exactly ONE place: the `@cutover_day` assignment below. Every
-- query derives its own bounds from it, so no two can disagree.
--
-- ============================================================================
-- BLOCKER — read before arming
-- ============================================================================
-- `postPendingSalesJournals` selects orders with
-- `NOT (EXISTS revenue_journal AND EXISTS cogs_journal)` and takes the oldest 50.
-- An order whose COGS total is zero can never satisfy the COGS half: the writer
-- returns NOTHING_TO_POST, no journal row is ever created, and the order keeps
-- its slot in that 50-row window permanently. So after the first tick posts
-- revenue for the oldest 50 such orders, every later tick re-selects the SAME 50,
-- gets NOTHING_TO_POST, increments nothing, and logs nothing — order 51 onward is
-- never journaled, with no error and no notification.
--
-- Measured 2026-08-06 on dev: 204 of 205 eligible orders have zero total COGS.
-- Run query 5 below against the target environment before deciding to arm.
--
-- Revenue posted without COGS also reports a 100% gross margin in Laba Rugi for
-- those periods, which is wrong independently of the stall.
--
-- ============================================================================
-- ORDER OF OPERATIONS for the GL cutover
-- ============================================================================
--   1. sweep date floor deployed        <- must already be live
--   2. chart-of-accounts detail leaves seeded, one postable LEAF per posting role
--      (never a category node — postJournal rejects an account that has children,
--      and only at write time, so the mapping page shows a broken mapping as
--      healthy)
--   3. the BLOCKER above resolved
--   4. THIS FILE
--   5. posting roles mapped
--   6. opening-balance journal posted, dated the day BEFORE the cutover, carrying
--      the closing trial balance from whatever kept the books before this system
--   7. stale pre-cutover JOURNAL_PENDING notifications marked read
--   8. verify (see the POST-CHECK section)
-- Running step 4 before step 5 is safe — nothing can post while the roles are
-- unmapped — and is the recommended order: arm the floor first, so the first tick
-- after mapping is already bounded.
--
-- The date is interpreted in WIB (Asia/Jakarta) and the boundary is INCLUSIVE: an
-- order dated exactly on the cutover day IS journaled.

-- ============================================================================
-- PRE-FLIGHT
-- ============================================================================

-- 0. EDIT THIS, and only this. Everything below derives from it.
--    `@cutover_utc` is the same instant the app computes: `parseDateOnly` builds
--    WIB midnight, which is 17:00 UTC on the previous day. Prisma stores DATETIME
--    as UTC and a `datetime(3) >= 'literal'` comparison is not affected by the
--    session time zone, so this literal is correct regardless of how the session
--    is configured — do NOT "adjust" it to local time.
SET @cutover_day = '2026-09-01';
SET @cutover_utc = DATE_SUB(CONCAT(@cutover_day, ' 00:00:00'), INTERVAL 7 HOUR);
SELECT @cutover_day AS cutoverDay, @cutover_utc AS cutoverInstantUtc;
-- Expect cutoverInstantUtc = the day before at 17:00:00.

-- 1. Current value, if any. Absent is the expected state before go-live.
SELECT id, `key`, value, updatedAt FROM SystemSetting WHERE `key` = 'finance.glCutoverDate';
-- Expect: no rows on a system never armed. A row here means the cutover is
-- already set, and changing it RE-ARMS the sweep over a different range. Moving it
-- EARLIER exposes previously-excluded orders to posting; moving it LATER does not
-- un-post anything already journaled. Know which you are doing.

-- 2. How many orders the chosen day admits versus excludes.
--    NOTE: this scans SalesOrder. On prod (8,649+ eligible rows) that is slow
--    enough to have wedged an SSH tunnel once — run it off-hours, and do not widen
--    it into an open-ended aggregate.
SELECT
  SUM(CASE WHEN COALESCE(so.shippedAt, so.transactionDate) >= @cutover_utc THEN 1 ELSE 0 END) AS willPost,
  SUM(CASE WHEN COALESCE(so.shippedAt, so.transactionDate) <  @cutover_utc THEN 1 ELSE 0 END) AS excluded
FROM SalesOrder so
WHERE (so.status IN ('SHIPPED','COMPLETED') OR so.fulfillmentStatus = 'SHIPPED');
-- `willPost` is the number of journal PAIRS the sweep will create, at 50 orders
-- per 5-minute tick. If it is not what you expect, STOP and find out why rather
-- than moving the date until the number looks right.

-- 3. STRADDLERS — transacted before the cutover, shipped on or after it.
--    These are the orders most likely to ALSO be represented in the opening
--    balance carried over from the previous books, because the sale was made in a
--    period those books already closed. Arming journals them here as fresh
--    revenue and AR; if the opening journal also carries them, both are counted.
SELECT COUNT(*) AS straddlers
FROM SalesOrder so
WHERE (so.status IN ('SHIPPED','COMPLETED') OR so.fulfillmentStatus = 'SHIPPED')
  AND so.shippedAt >= @cutover_utc
  AND so.transactionDate < @cutover_utc;
-- Nonzero is normal (most orders ship a day or more after they transact) and is
-- NOT itself a problem — it is a reconciliation item. Decide explicitly whether
-- the opening balance includes these, and if it does, exclude them from it or
-- adjust for them. Do not skip this because the count looks small.

-- 4. Are the FOUR roles the sales sweep resolves mapped yet? A count of all
--    mappings is not the question — the sweep needs exactly these.
SELECT r.role, CASE WHEN m.id IS NULL THEN 'UNMAPPED' ELSE 'mapped' END AS state
FROM (
  SELECT 'AR' AS role UNION ALL SELECT 'SALES_REVENUE'
  UNION ALL SELECT 'COGS' UNION ALL SELECT 'INVENTORY'
) r
LEFT JOIN JournalAccountMapping m ON m.role = r.role;
-- All four UNMAPPED means arming has no immediate effect — the safe order.
-- Anything mapped means the sweep starts posting within 5 minutes of the write.

-- 5. BLOCKER CHECK — how many admitted orders would stall the sweep?
SELECT COUNT(*) AS admittedOrders,
       SUM(CASE WHEN c.totalCogs IS NULL OR c.totalCogs = 0 THEN 1 ELSE 0 END) AS zeroCogsWillStall,
       SUM(CASE WHEN c.totalCogs > 0 THEN 1 ELSE 0 END) AS hasCogs
FROM SalesOrder so
LEFT JOIN (
  SELECT salesorderId AS soid, SUM(COALESCE(cogs, 0)) AS totalCogs
  FROM SalesOrderItem GROUP BY salesorderId
) c ON c.soid = so.id
WHERE (so.status IN ('SHIPPED','COMPLETED') OR so.fulfillmentStatus = 'SHIPPED')
  AND COALESCE(so.shippedAt, so.transactionDate) >= @cutover_utc;
-- `zeroCogsWillStall` MUST be 0 before arming. Any nonzero value means the sweep
-- posts revenue for the oldest 50 of them and then silently stops making progress
-- forever. Resolve the BLOCKER first.

-- ============================================================================
-- THE WRITE — only after every pre-flight above reads as expected.
-- ============================================================================

-- Idempotent: re-running with the same day is a no-op beyond `updatedAt`.
-- `id` is generated here because SystemSetting.id has no DB-level default (Prisma
-- supplies cuid() at the application layer, which raw SQL bypasses).
INSERT INTO SystemSetting (id, `key`, value, updatedAt)
VALUES (CONCAT('glcut', LOWER(HEX(RANDOM_BYTES(10)))), 'finance.glCutoverDate', @cutover_day, NOW(3))
ON DUPLICATE KEY UPDATE value = VALUES(value), updatedAt = NOW(3);

-- ============================================================================
-- POST-CHECK
-- ============================================================================

-- The stored value must be the day you intended, as an exact YYYY-MM-DD string.
SELECT s.value AS stored, @cutover_day AS intended,
       CASE WHEN s.value = @cutover_day THEN 'OK' ELSE 'MISMATCH — FIX THIS' END AS verdict
FROM SystemSetting s WHERE s.`key` = 'finance.glCutoverDate';
-- The reader rejects anything that is not an unambiguous calendar day — including
-- a rolled-over date like '2026-02-31' — and falls back to posting NOTHING, so a
-- malformed value leaves the sweep silently inert.

-- Nothing should predate the cutover except the opening-balance journal, ONCE it
-- has been posted. Run this AFTER step 6.
SELECT j.sourceType, COUNT(*) AS journals, MIN(j.date) AS earliest
FROM Journal j WHERE j.date < @cutover_utc GROUP BY j.sourceType;
-- Expect at most the manual opening-balance journal (no `sourceType`, or the
-- manual one). Any `SALESORDER_*` row here was posted by the floorless sweep that
-- ran before this feature existed — those are pre-cutover entries in a ledger that
-- is supposed to start at the cutover, and they must be reconciled against the
-- opening balance rather than left to double-count. This query is diagnostic, not
-- a gate: on an environment where the old sweep ever ran, "zero rows" is not an
-- achievable outcome without deleting them deliberately.

-- Then watch the web app log on the next 5-minute tick:
--   armed + roles mapped   -> `[cron] sales-journal: +N rev, +N cogs, ...`
--   armed + roles unmapped -> a JOURNAL_PENDING per order (expected until step 5)
--   not armed / malformed  -> `[cron] sales-journal: inert — finance.glCutoverDate is unset ...`
