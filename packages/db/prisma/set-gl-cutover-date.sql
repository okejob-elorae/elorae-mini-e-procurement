-- ############################################################################
-- RUN THE SECTIONS ONE AT A TIME and read each PRE-FLIGHT result before the
-- write. This is the switch that ARMS the sales journal sweep: the moment this
-- key holds a valid date AND the posting roles are mapped, the 5-minute cron
-- begins posting journals for every eligible order on or after it, unattended.
-- ############################################################################
--
-- Sets `SystemSetting["finance.glCutoverDate"]`, the fail-closed floor read by
-- `postPendingSalesJournals` (apps/web/lib/finance/sales/sweep.ts). While the key
-- is absent, empty or not an unambiguous YYYY-MM-DD day, the sweep posts NOTHING
-- and the cron logs that it is inert.
--
-- EDIT THE DATE BELOW BEFORE RUNNING. There is no default on purpose — a wrong
-- cutover date silently changes which periods enter the general ledger, and the
-- posting it triggers cannot be undone except by deleting journals by hand.
--
-- ORDER OF OPERATIONS for the GL cutover:
--   1. sweep date floor deployed        <- must already be live
--   2. chart-of-accounts detail leaves seeded, one postable LEAF per posting role
--      (never a category node — postJournal rejects an account that has children,
--      and it is only checked at write time, so the mapping page shows a broken
--      mapping as healthy)
--   3. THIS FILE
--   4. posting roles mapped
--   5. opening-balance journal posted, dated the day BEFORE the cutover, carrying
--      the closing trial balance from whatever kept the books before this system
--   6. stale pre-cutover JOURNAL_PENDING notifications marked read
--   7. verify: Trial Balance balances, Neraca balances with no opening-balance
--      warning, and no journal predates the cutover except the opening one
-- Running this BEFORE step 2/4 is safe (nothing can post while roles are
-- unmapped) and is the recommended order: arm the floor, then map, so the first
-- tick after mapping is already bounded.
--
-- The date is interpreted in WIB (Asia/Jakarta) and the boundary is INCLUSIVE:
-- an order dated exactly on the cutover day IS journaled.

-- ============================================================================
-- PRE-FLIGHT
-- ============================================================================

-- 1. Current value, if any. Absent is the expected state before go-live.
SELECT id, `key`, value, updatedAt FROM SystemSetting WHERE `key` = 'finance.glCutoverDate';
-- Expect: no rows on a system that has never been armed. A row here means the
-- cutover is already set — changing it RE-ARMS the sweep over a different range.
-- Moving it EARLIER exposes previously-excluded orders to posting; moving it
-- LATER does not un-post anything already journaled. Understand which you are
-- doing before proceeding.

-- 2. WHAT TIME ZONE IS THIS SESSION? Run this BEFORE query 3 — it decides which
--    literal is correct there, and getting it wrong makes the whole count lie.
SELECT @@session.time_zone AS sessionTz,
       TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), NOW()) AS offsetHours;
-- Measured on this project's MariaDB: `SYSTEM` resolving to offsetHours = 0, i.e.
-- UTC. Query 3 is written for that case.
--
-- Why it matters: the app's floor is WIB midnight. `parseDateOnly('2026-09-01')`
-- yields the instant 2026-08-31T17:00:00Z, and Prisma stores DATETIME columns as
-- UTC. On a UTC session, writing the WIB wall-clock string '2026-09-01 00:00:00'
-- as the SQL literal therefore floors SEVEN HOURS LATE — it silently excludes the
-- orders shipped between 17:00 and 24:00 UTC on 31 August that the app WILL post,
-- so the count UNDERSTATES what arming does. Wrong direction for a safety check.
--
-- If offsetHours = 0  -> use the UTC literal, as query 3 does.
-- If offsetHours = 7  -> the session is WIB; use '2026-09-01 00:00:00' instead.
-- Anything else       -> stop and work out the correct instant by hand.

-- 3. How many orders the chosen date would admit, and how many it excludes.
--    Replace the instant in BOTH places. The literal below is a UTC instant and
--    equals WIB midnight on 2026-09-01 — the cutover day itself is INCLUDED,
--    matching the app.
--    NOTE: this scans SalesOrder. On prod (8,649+ eligible rows) that is slow
--    enough to have wedged an SSH tunnel once — run it off-hours, and do not
--    widen it into an open-ended aggregate.
SELECT
  SUM(CASE WHEN COALESCE(so.shippedAt, so.transactionDate) >= '2026-08-31 17:00:00' THEN 1 ELSE 0 END) AS willPost,
  SUM(CASE WHEN COALESCE(so.shippedAt, so.transactionDate) <  '2026-08-31 17:00:00' THEN 1 ELSE 0 END) AS excluded
FROM SalesOrder so
WHERE (so.status IN ('SHIPPED','COMPLETED') OR so.fulfillmentStatus = 'SHIPPED');
-- `willPost` is the number of journal PAIRS (revenue + COGS) the sweep will
-- create, at 50 orders per 5-minute tick. If that number is not what you expect,
-- STOP — work out why before adjusting the date to make the number look right.

-- 4. Are the posting roles mapped yet? Determines whether arming has any
--    immediate effect.
SELECT COUNT(*) AS mappedRoles FROM JournalAccountMapping;
-- 0 means nothing can post regardless of this key — the safe order.

-- ============================================================================
-- THE WRITE — edit the date, then run.
-- ============================================================================

-- Idempotent: re-running with the same date is a no-op beyond `updatedAt`.
-- `id` is generated here because SystemSetting.id has no DB-level default (Prisma
-- supplies cuid() at the application layer, which raw SQL bypasses).
INSERT INTO SystemSetting (id, `key`, value, updatedAt)
VALUES (CONCAT('glcut', LOWER(HEX(RANDOM_BYTES(10)))), 'finance.glCutoverDate', '2026-09-01', NOW(3))
ON DUPLICATE KEY UPDATE value = VALUES(value), updatedAt = NOW(3);

-- ============================================================================
-- POST-CHECK
-- ============================================================================

SELECT `key`, value, updatedAt FROM SystemSetting WHERE `key` = 'finance.glCutoverDate';
-- Expect exactly one row, `value` an exact YYYY-MM-DD string with no time part
-- and no surrounding whitespace. The reader rejects anything else — including a
-- rolled-over date like '2026-02-31' — and falls back to posting NOTHING, so a
-- malformed value here leaves the sweep silently inert. Confirm the string
-- character by character.

-- Then watch the web app log on the next 5-minute tick:
--   armed + roles mapped   -> `[cron] sales-journal: +N rev, +N cogs, ...`
--   armed + roles unmapped -> flags a JOURNAL_PENDING per order (expected until step 4)
--   not armed / malformed  -> `[cron] sales-journal: inert — finance.glCutoverDate is unset ...`
