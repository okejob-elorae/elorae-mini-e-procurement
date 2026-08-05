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
-- VERIFY FIRST on prod: confirm `13 Hutang` is still ASET there and that code
-- 2101 is free. This was audited on the dev DB only.

UPDATE ChartAccount
SET type = 'LIABILITAS',
    code = '2101',
    parentId = (SELECT id FROM (SELECT id FROM ChartAccount WHERE code = '21') AS p),
    depth = (SELECT d FROM (SELECT depth + 1 AS d FROM ChartAccount WHERE code = '21') AS q)
WHERE code = '13'
  AND name = 'Hutang'
  AND type = 'ASET'
  AND NOT EXISTS (SELECT 1 FROM (SELECT code FROM ChartAccount) AS c WHERE c.code = '2101');
