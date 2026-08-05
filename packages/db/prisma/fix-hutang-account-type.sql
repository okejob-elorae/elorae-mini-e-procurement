-- ############################################################################
-- DO NOT PASTE OR PIPE THIS WHOLE FILE AT ONCE (`mysql < file.sql`, or a GUI's
-- "run all"). This is a flat sequence of statements with no stop-gate: every
-- PRE-FLIGHT query would run, then THE UPDATE would run UNCONDITIONALLY,
-- whatever those queries showed. The UPDATE's own WHERE clause protects against
-- a wrong name, a wrong type, and a taken 2101 code (it matches 0 rows rather
-- than corrupting anything) — but it does NOT protect against pre-flight
-- queries 6 and 7. If a posting role is mapped to `21 Utang Lancar`, or journal
-- lines already post against it, a blind run still promotes `21` to a parent
-- and silently breaks every future posting for that role, because `postJournal`
-- rejects accounts that have children. Run the sections one at a time.
-- ############################################################################
--
-- Corrects the `13 Hutang` account, which was created as ASET while carrying the
-- AP posting role: every GRN credits it, so payables rendered as a negative asset
-- and the Neraca understated both sides (it still balanced, because the identity
-- holds however accounts are typed). Run by hand on dev and prod after merge —
-- the deploy pipeline does not seed.
--
-- Idempotent: the ASET guard makes a second run a no-op, and the 2101 collision
-- check prevents a unique-code failure. `depth` is read from the parent rather
-- than hardcoded. The derived-table wrappers are required — MariaDB rejects a
-- subquery selecting from the table being updated (error 1093).
--
-- HOW TO RUN: run every PRE-FLIGHT query below and read the result before
-- touching THE UPDATE. `affectedRows = 0` on the UPDATE is NOT proof the row
-- was already correct — it also fires silently if 2101 is already taken, or if
-- the account was hand-created under a name other than exactly `Hutang` (very
-- plausible: `Hutang Usaha` / `Hutang Dagang` are the conventional names). The
-- pre-flight exists so you know which of those it is instead of guessing from
-- a bare row count.

-- ============================================================================
-- PRE-FLIGHT — run ALL of these first, on the SAME environment you are about
-- to fix, and read every result before running THE UPDATE.
-- ============================================================================

-- 1. Find the target by code AND by a name that merely looks like Hutang, so a
--    rename doesn't hide the account from you. The pattern is deliberately
--    broad — it is meant to catch a payables account hand-created under a
--    different name, not to return exactly one row.
SELECT id, code, name, type, parentId, depth
FROM ChartAccount
WHERE code = '13' OR name LIKE '%utang%';
-- Expect: SEVERAL rows on any real chart, not one. `Piutang` (receivables)
-- and `Utang Lancar` (code '21', the seeded liability leaf that always
-- exists) both match the `%utang%` substring and are expected noise —
-- ignore them. Locate the row with `code = '13'` among the hits; on an
-- unfixed environment that is `name = 'Hutang', type = 'ASET'`, the exact
-- row THE UPDATE's WHERE clause targets.
-- If a row already shows code = '2101' / type = 'LIABILITAS', this script
-- already ran here — stop, nothing to do.
-- If the `code = '13'` row exists but its `name` is NOT exactly `Hutang`
-- (e.g. `Hutang Usaha`), THE UPDATE's `name = 'Hutang'` predicate will not
-- match it and will silently affect 0 rows. Do not loosen the predicate on
-- your own judgment, and do not identify the target by name alone — confirm
-- identity with query 2 (the AP mapping join) instead, then see the note at
-- the bottom of this file for how to proceed.

-- 2. Whichever account the AP posting role is actually mapped to today. This
--    is the identity that matters — it holds regardless of what the account
--    is named, so it is the tie-breaker if query 1's name filter is ambiguous
--    or empty.
SELECT m.role, a.id, a.code, a.name, a.type
FROM JournalAccountMapping m
JOIN ChartAccount a ON a.id = m.chartAccountId
WHERE m.role = 'AP';
-- Expect: one row, whose `id` matches query 1's `code = '13'` row. If it
-- points at a different account entirely, STOP — you do not have the mistyped
-- Hutang account identified yet, and running THE UPDATE would touch the wrong
-- row (or no row).

-- 3. Is the destination code free?
SELECT code FROM ChartAccount WHERE code = '2101';
-- Expect: no rows. A row here means 2101 is already taken by something else —
-- STOP and pick a different free liability code, editing THE UPDATE below
-- before running it.

-- 4. Does the parent `21` exist, and at what depth?
SELECT id, code, name, depth FROM ChartAccount WHERE code = '21';
-- Expect: exactly one row. THE UPDATE derives the corrected row's `parentId`
-- and `depth` from this row. If it is missing, STOP — the UPDATE's parent
-- subqueries will resolve to NULL instead of erroring.

-- 5. Does `13` already have children? (sanity check — it is supposed to be a
--    leaf account today; if it already has children, something else is wrong.)
SELECT id, code, name
FROM ChartAccount
WHERE parentId = (SELECT id FROM ChartAccount WHERE code = '13');
-- Expect: no rows.

-- 6. FIX-2 guard — does ANY posting role currently map to `21` itself?
--    Promoting `13` from a leaf into a child of `21` turns `21` into a
--    non-leaf, and `postJournal` (packages/db/src/journal-writer.ts) rejects
--    any line whose account has children with NON_POSTABLE_ACCOUNT. If a role
--    is mapped to `21` (plausible — it is the only seeded liability leaf, so
--    e.g. TAX could point at it), every future post through that role starts
--    throwing the instant this UPDATE commits, and the mapping page will
--    still show it as a healthy mapping (postability is only checked at
--    write time, not on the mapping page).
SELECT m.role
FROM JournalAccountMapping m
JOIN ChartAccount a ON a.id = m.chartAccountId
WHERE a.code = '21';
-- MUST return zero rows. If it returns any role, STOP: remap that role to a
-- different liability leaf account first (Finance -> Pemetaan Akun), re-run
-- this query until it is empty, and only then run THE UPDATE.

-- 7. FIX-2 guard — has anything already posted directly against `21`? Existing
--    lines against an account that is about to gain children are a sign
--    something already depends on `21` staying a leaf, independent of query 6.
SELECT COUNT(*) AS lineCount
FROM JournalLine jl
JOIN ChartAccount a ON a.id = jl.chartAccountId
WHERE a.code = '21';
-- MUST be zero. Treat a nonzero count as the same stop condition as query 6.

-- 8. Confirm strict SQL mode, since an unexpected mode can change how a
--    zero-affected UPDATE or a bad subquery is reported.
SELECT @@sql_mode;

-- ============================================================================
-- THE UPDATE — predicates and derived `depth` are unchanged from the original
-- version of this script. Do not loosen `name = 'Hutang'` here; see the note
-- at the bottom of this file if it turns out to be wrong on this environment.
-- ============================================================================

-- REQUIRED: after running this, check the client's affected-row count.
-- affectedRows MUST be 1. On 0, STOP — do NOT re-run this statement and do
-- NOT loosen the predicate to make it match. Go back to the PRE-FLIGHT
-- queries above (especially 1, 2, and 3) to find out which of the known
-- no-op causes fired, and resolve that first.
UPDATE ChartAccount
SET type = 'LIABILITAS',
    code = '2101',
    parentId = (SELECT id FROM (SELECT id FROM ChartAccount WHERE code = '21') AS p),
    depth = (SELECT d FROM (SELECT depth + 1 AS d FROM ChartAccount WHERE code = '21') AS q)
WHERE code = '13'
  AND name = 'Hutang'
  AND type = 'ASET'
  AND NOT EXISTS (SELECT 1 FROM (SELECT code FROM ChartAccount) AS c WHERE c.code = '2101');

-- ============================================================================
-- POST-CHECK — run immediately after THE UPDATE, whatever the affected-row
-- count said, and confirm every expectation below before considering the fix
-- done.
-- ============================================================================

-- The row now has the corrected code/type and sits under `21` at the right depth.
SELECT a.id, a.code, a.name, a.type, a.parentId, a.depth,
       p.id AS parentAccountId, p.code AS parentCode, p.depth AS parentDepth
FROM ChartAccount a
LEFT JOIN ChartAccount p ON p.id = a.parentId
WHERE a.code = '2101';
-- Expect exactly one row: type = 'LIABILITAS', parentId = parentAccountId,
-- depth = parentDepth + 1, parentCode = '21'.

-- Posted journal lines against the account were untouched by this UPDATE
-- (it only ever touches ChartAccount) — this is a sanity check that you fixed
-- the account you meant to, not a decoy row that already had postings.
SELECT COALESCE(SUM(jl.debit), 0) AS totalDebit,
       COALESCE(SUM(jl.credit), 0) AS totalCredit,
       COUNT(*) AS lineCount
FROM JournalLine jl
JOIN ChartAccount a ON a.id = jl.chartAccountId
WHERE a.code = '2101';

-- ============================================================================
-- NOTE — if the account's name genuinely differs on this environment (e.g. it
-- is `Hutang Usaha`, not `Hutang`), do NOT loosen the predicate blindly.
-- First confirm identity beyond doubt via query 2 above (the AP mapping join)
-- so you are certain which row is the one every GRN has been crediting. Only
-- then edit or drop the `name = 'Hutang'` predicate in THE UPDATE above, and
-- re-commit this file so the committed artifact matches what was actually run
-- against that environment.
-- ============================================================================
