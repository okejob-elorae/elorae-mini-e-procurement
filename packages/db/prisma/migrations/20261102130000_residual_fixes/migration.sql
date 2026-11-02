-- Two data-only heals left over from the owner's 2026-11-01 decisions. No schema change.
-- Both statements are idempotent and re-runnable: the deploy pipes this file into the `mariadb`
-- CLI, which stops at the first error with the statements above it already applied and the file
-- not recorded, so running it again must be harmless.

-- 1. Sync the legacy `User.role` column with the user's RoleDefinition (owner decision 7a).
-- The column is a mirror, derived by `peranLamaDari` (apps/web/lib/users/peran-lama.ts): a system
-- role is ADMIN; a role named exactly PURCHASER / WAREHOUSE / PRODUCTION is that name; anything
-- else, no role, or a dangling roleId is USER. Settings -> Pengguna wrote `roleId` without it
-- before 2026-11-01, so accounts promoted or demoted there kept a stale value, and the unattended
-- jobs that used to read the column posted under a demoted ex-admin or not at all. BINARY keeps
-- the name match case-sensitive, as `peranLamaDari` is (peran-lama.test pins 'purchaser' -> USER),
-- and is immune to the CLI's utf8mb3 connection collation. Expected side effect: the jwt probe in
-- apps/web/lib/auth.ts (`token.role !== probe.role`) forces one harmless session re-read for each
-- healed account.

UPDATE `User` u
LEFT JOIN `RoleDefinition` r ON r.`id` = u.`roleId`
SET u.`role` = CASE
  WHEN r.`isSystem` = 1 THEN 'ADMIN'
  WHEN BINARY r.`name` = 'PURCHASER' THEN 'PURCHASER'
  WHEN BINARY r.`name` = 'WAREHOUSE' THEN 'WAREHOUSE'
  WHEN BINARY r.`name` = 'PRODUCTION' THEN 'PRODUCTION'
  ELSE 'USER'
END;

-- 2. Backfill the seller (`Receivable.salesmanId`) on receivables created before the merge
-- (owner decision 7d). `20261031100000_merge_max_features` added the column but backfilled only
-- invoiceNo / amount / outstanding, so every pre-merge delivery or konsi sell-through receivable
-- reads NULL. The collector is the store's holder, else the seller (`penagihPiutang`), so while a
-- store has no holder the overdue reminder (`overdueRecipient`) and the salesman's Tagihan screen
-- (`daftarPiutang({ penagihId })`) found nobody for those invoices and only the office heard of
-- them. The seller is the ORDER's salesman for a delivery (never `deliveredById`) and the report's
-- salesman for a sell-through report, exactly as the current writers (`buatPiutangNota`, the
-- sell-through approve) set it. Only NULLs are filled, so a seller set since is never overwritten.
-- MANUAL and IMPORT receivables carry neither source column and are left alone.

UPDATE `Receivable` r
JOIN `FieldSalesDelivery` d ON d.`id` = r.`deliveryId`
JOIN `FieldSalesOrder` o ON o.`id` = d.`orderId`
SET r.`salesmanId` = o.`salesmanId`
WHERE r.`salesmanId` IS NULL;

UPDATE `Receivable` r
JOIN `KonsiSellThrough` k ON k.`id` = r.`sellThroughId`
SET r.`salesmanId` = k.`salesmanId`
WHERE r.`salesmanId` IS NULL
  AND k.`salesmanId` IS NOT NULL;
