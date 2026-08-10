-- ############################################################################
-- RUN THE SECTIONS ONE AT A TIME and read each PRE-FLIGHT result. THE UPDATE
-- is fail-closed — every pre-flight stop condition is also encoded as one of
-- its predicates, so a blind full-file run (`mysql < file.sql`, or a GUI's
-- "run all") degrades to `affectedRows = 0` rather than breaking anything.
-- But a bare row count cannot tell you WHICH condition stopped it, and on 0
-- you need to know. That is what the pre-flight queries are for.
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
-- touching THE UPDATE. `affectedRows = 0` is NOT proof the row was already
-- correct — it fires for any of five stop conditions (2101 taken, parent `21`
-- missing, the row not being the AP-mapped account, a role already mapped to
-- `21`, or lines already posted against `21`). The pre-flight tells you which.
--
-- The account is identified by the AP posting role rather than by name, so a
-- chart where it was hand-created as `Hutang Usaha` / `Hutang Dagang` needs no
-- edit to this file.

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
-- unfixed environment it is `type = 'ASET'`, whatever it is named.
-- If a row already shows code = '2101' / type = 'LIABILITAS', this script
-- already ran here — stop, nothing to do.
-- The name does NOT have to be exactly `Hutang`: THE UPDATE identifies the
-- row by the AP posting role, not by name. Confirm with query 2 that the
-- AP-mapped account is this `code = '13'` row; that is the identity that
-- matters.

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

-- 4. Does the parent `21` exist, is it a LIABILITAS, and at what depth?
SELECT id, code, name, type, depth FROM ChartAccount WHERE code = '21';
-- Expect: exactly one row, with type = 'LIABILITAS'. THE UPDATE derives the
-- corrected row's `parentId` and `depth` from this row. If it is missing, the
-- parent subqueries would resolve to NULL; if it is typed anything other than
-- LIABILITAS, attaching a payables account under it would produce a parent/
-- child type mismatch that the CoA UI itself refuses to create
-- (`reparent_type_mismatch` in `finance/coa/validators.ts`). Both cases STOP
-- the UPDATE by predicate.

-- 5. Does `13` already have children? It is supposed to be a leaf today.
SELECT id, code, name
FROM ChartAccount
WHERE parentId = (SELECT id FROM ChartAccount WHERE code = '13');
-- Expect: no rows. Children would keep their old `13xx` code prefixes and
-- their depth relative to the OLD position, while the parent moves to `2101`
-- under `21` — a tree state the app's own reparent rules reject
-- (`has_children_reparent_forbidden`). This is a stop condition, enforced by
-- predicate on the UPDATE.

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
-- THE UPDATE — fail-closed. Do not loosen any predicate to force a match: each
-- one corresponds to a PRE-FLIGHT stop condition, so removing one removes the
-- protection it encodes.
-- ============================================================================

-- REQUIRED: after running this, check the client's affected-row count.
-- affectedRows MUST be 1. On 0, STOP — do NOT re-run this statement and do
-- NOT loosen the predicates to make it match. Go back to the PRE-FLIGHT
-- queries above to find out which stop condition fired, and resolve that
-- first.
--
-- Every PRE-FLIGHT stop condition is also encoded as a predicate below, so a
-- blind full-file run degrades to `affectedRows = 0` instead of silently
-- breaking something. The pre-flight queries remain the primary checklist —
-- they tell you WHICH condition failed, which a bare row count cannot.
--
-- Identity comes from the AP posting role (`chartAccountId`), not from the
-- account's name. That is strictly TIGHTER than the old `name = 'Hutang'`
-- predicate — it pins the row the ledger actually posts payables to, and it
-- makes the script work unchanged on a chart where the account was created as
-- `Hutang Usaha` or `Hutang Dagang`. If AP is unmapped, the subquery yields
-- NULL, nothing matches, and the statement no-ops.
--
-- Every subquery that reads ChartAccount is wrapped in a derived table:
-- MariaDB rejects a subquery selecting from the table being updated (1093).
UPDATE ChartAccount
SET type = 'LIABILITAS',
    code = '2101',
    parentId = (
      SELECT id FROM (SELECT id FROM ChartAccount WHERE code = '21' AND type = 'LIABILITAS') AS p
    ),
    depth = (
      SELECT d
      FROM (SELECT depth + 1 AS d FROM ChartAccount WHERE code = '21' AND type = 'LIABILITAS') AS q
    )
WHERE code = '13'
  AND type = 'ASET'
  -- Pre-flight 2: this must be the account the AP role maps to.
  AND id = (
    SELECT apAccountId
    FROM (SELECT chartAccountId AS apAccountId FROM JournalAccountMapping WHERE role = 'AP') AS ap
  )
  -- Pre-flight 3: destination code must be free.
  AND NOT EXISTS (SELECT 1 FROM (SELECT code FROM ChartAccount) AS c WHERE c.code = '2101')
  -- Pre-flight 4: parent must exist AND be a liability. Existence alone would
  -- let a hand-built chart attach payables under a non-liability `21`, which
  -- the CoA UI rejects as `reparent_type_mismatch`.
  AND EXISTS (
    SELECT 1
    FROM (SELECT code, type FROM ChartAccount) AS pe
    WHERE pe.code = '21' AND pe.type = 'LIABILITAS'
  )
  -- Pre-flight 5: `13` must still be a leaf. Children would keep their old
  -- `13xx` prefixes and stale depth while the parent moves under `21` — the
  -- state `validateReparent` refuses as `has_children_reparent_forbidden`.
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT c.id
      FROM ChartAccount c
      JOIN ChartAccount p ON p.id = c.parentId
      WHERE p.code = '13'
    ) AS kids
  )
  -- Pre-flight 6: no posting role may map to `21`, which this UPDATE turns into
  -- a non-leaf — postJournal rejects accounts that have children.
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT m.role
      FROM JournalAccountMapping m
      JOIN ChartAccount a ON a.id = m.chartAccountId
      WHERE a.code = '21'
    ) AS roleOn21
  )
  -- Pre-flight 7: nothing may already post directly against `21`.
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT jl.id
      FROM JournalLine jl
      JOIN ChartAccount a ON a.id = jl.chartAccountId
      WHERE a.code = '21'
    ) AS linesOn21
  );

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
-- NOTE — if THE UPDATE reports 0 rows, work through the seven stop conditions
-- rather than editing predicates. Every pre-flight query has a matching
-- predicate on THE UPDATE:
--   2  the `code = '13'` row is not the account the AP role maps to
--   3  destination code 2101 is already taken
--   4  parent `21` is missing, or is not typed LIABILITAS
--   5  `13` already has children (they would keep stale codes and depth)
--   6  a posting role is already mapped to `21`
--   7  journal lines already post against `21`
-- Conditions 6 and 7 are fixed by remapping that role to another liability
-- leaf first. Condition 5 needs the children dealt with deliberately. The rest
-- mean the target is not what this script assumes, which is a human decision,
-- not a looser predicate.
--
-- If you do end up changing this file for a specific environment, re-commit it
-- so the committed artifact matches what was actually run.
-- ============================================================================
