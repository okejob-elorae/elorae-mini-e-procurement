-- Permission rows for the features that came in with Max's branch (receivables, consignment,
-- creative/KOL, production palette). The deploy workflow migrates but never seeds, so run this
-- by hand on prod ONCE, after the 20261031100000_merge_max_features migration has deployed.
-- Every statement is NOT EXISTS-guarded: re-running it is a no-op.
--
--   mariadb --skip-ssl -u<user> -p <db> < seed-max-features-permissions.sql
--
-- ADMIN already passes every check through the '*' wildcard granted in code (apps/web/lib/auth.ts);
-- these rows exist so the permissions can be granted to NON-admin roles in role management.
-- The office roles (KEUANGAN, ADMIN_PENJUALAN, ADMIN_PAJAK) are NOT created here — that is
-- seed-office-roles-permissions.sql, run AFTER this file (the owner decided the roles on 2026-11-01).
-- Concatenated from seed-receivables-permissions.sql, seed-consignment-permissions.sql,
-- seed-creative-permissions.sql and seed-production-palette-permissions.sql, in that order
-- (consignment grants itself to every role that already holds a receivables permission),
-- followed by the office-work and approval codes split out of broad codes on 2026-11-01.
--
-- RUN THIS BEFORE (or together with) the deploy that ships the 2026-11-01 split. From that deploy on,
-- verifying a BKM checks payments:verify instead of journals:manage; until this file has run, a
-- NON-admin role that verified BKM through journals:manage cannot (ADMIN is unaffected).

START TRANSACTION;

-- ===== from seed-receivables-permissions.sql =====

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'receivables:view', 'receivables', 'view',
       'View receivables, collection notes and payment claims'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'receivables:view');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'receivables:manage', 'receivables', 'manage',
       'Hand invoices over to a shop on a collection note, and close or cancel one'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'receivables:manage');

INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN'
  AND p.`code` IN ('receivables:view', 'receivables:manage')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- ===== from seed-consignment-permissions.sql =====

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'consignment:view', 'consignment', 'view',
       'Open consignment cycles, their reports and their commissions'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'consignment:view');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'consignment:manage', 'consignment', 'manage',
       'Run a consignment cycle: open it, record consigned shipments and the SPG and store reports'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'consignment:manage');

-- Locking, the two document numbers and paying commission moved to their own codes (below); a row
-- inserted by an earlier run of this file still carries the old wording.
UPDATE `Permission`
SET `description` = 'Run a consignment cycle: open it, record consigned shipments and the SPG and store reports'
WHERE `code` = 'consignment:manage'
  AND `description` = 'Run a consignment cycle: lock the figures, pay commission, record the tax invoice number';

INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN'
  AND p.`code` IN ('consignment:view', 'consignment:manage')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), rp_ada.`roleId`, p.`id`
FROM `RolePermission` rp_ada
JOIN `Permission` p_ada ON p_ada.`id` = rp_ada.`permissionId` AND p_ada.`code` = 'receivables:manage'
CROSS JOIN `Permission` p
WHERE p.`code` IN ('consignment:view', 'consignment:manage')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = rp_ada.`roleId` AND rp.`permissionId` = p.`id`
  );

INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), rp_ada.`roleId`, p.`id`
FROM `RolePermission` rp_ada
JOIN `Permission` p_ada ON p_ada.`id` = rp_ada.`permissionId` AND p_ada.`code` = 'receivables:view'
CROSS JOIN `Permission` p
WHERE p.`code` = 'consignment:view'
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = rp_ada.`roleId` AND rp.`permissionId` = p.`id`
  );

-- ===== from seed-creative-permissions.sql =====

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'creative:view', 'creative', 'view',
       'Open the content calendar, KOL briefs and the KOL directory'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'creative:view');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'creative:manage', 'creative', 'manage',
       'Create and move KOL briefs, which issues product stock, and edit content plans'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'creative:manage');

INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN'
  AND p.`code` IN ('creative:view', 'creative:manage')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- ===== from seed-production-palette-permissions.sql =====

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'production_colors:manage', 'production_colors', 'manage',
       'Save colour palettes and the team base inks used for print mix recipes'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'production_colors:manage');

INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` IN ('ADMIN', 'PRODUCTION')
  AND p.`code` = 'production_colors:manage'
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- ===== office work and approvals split out of broad codes (owner decision 2026-11-01) =====
--
-- Each check below used to ride on a broader code:
--   payments:verify                  <- journals:manage      (verify a BKM, giro clearing, cancel or
--                                                              re-link a BKM, record a konsi store payment)
--                                    <- payments:manage      (verify / reject a collector submission)
--                                    <- collections:manage   (approve / reject a store settlement)
--   receivables:decide_bearer        <- receivables:manage   (who bears a return shortfall / lost SPG goods,
--                                                              and cancelling a lost-goods record already decided)
--   consignment:note_number          <- consignment:manage   (sales-note number on a locked cycle)
--   consignment:tax_number           <- consignment:manage   (tax-invoice number on a locked cycle)
--   consignment:lock                 <- consignment:manage   (lock / unlock the official sold figures)
--   store_stocktakes:approve         <- stores:manage        (approve a store stock count, or cancel one
--                                                              awaiting approval)
--   store_transfers:approve          <- field_sales_orders:approve (SPG transfers: approve, reject, redirect,
--                                                             cancel, and the transfer rules in Settings -> SPG)
--                                    <- stores:manage        (team store transfers: approve, and cancel one
--                                                             someone else created)
--   store_transfers:decide_shortfall <- field_sales_orders:approve (lost or returned)
--   spg_commission:pay               <- consignment:manage (konsi cycle) and receivables:manage (putus)
--
-- "Manager" approvals are admin-only by default (owner, 2026-10-29), so NONE of these is carried over
-- to the roles that held the old broad code: those roles LOSE the approval, by design, and the owner
-- grants it back in Peran & izin where wanted. The single exception is payments:verify — payment
-- verification is the one check finance may also do — which is granted to every role that holds
-- journals:manage today, so no finance role loses BKM verification the day this deploys. It is NOT
-- carried over to payments:manage or collections:manage holders: that would hand BKM verification to
-- people who record payments or assign collectors. The check at the end lists them.

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'payments:verify', 'payments', 'verify',
       'Verify store payment reports (BKM), giro clearing, collector submissions and store settlements against the bank statement (never a payment you reported, recorded or handed in)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'payments:verify');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'receivables:decide_bearer', 'receivables', 'decide_bearer',
       'Decide, reassign or cancel who bears a store-return shortfall or lost SPG goods (manager decision)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'receivables:decide_bearer');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'consignment:note_number', 'consignment', 'note_number',
       'Record the sales-note number on a locked consignment cycle'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'consignment:note_number');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'consignment:tax_number', 'consignment', 'tax_number',
       'Record the tax-invoice (faktur pajak) number on a locked consignment cycle'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'consignment:tax_number');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'consignment:lock', 'consignment', 'lock',
       'Lock and unlock the official sold figures of a consignment cycle (manager decision)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'consignment:lock');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'store_stocktakes:approve', 'store_stocktakes', 'approve',
       'Approve a store stock count so its result takes effect, or cancel one awaiting approval (manager decision)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'store_stocktakes:approve');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'store_transfers:approve', 'store_transfers', 'approve',
       'Approve, reject, redirect or cancel an inter-store transfer, and set the transfer rules (manager decision)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'store_transfers:approve');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'store_transfers:decide_shortfall', 'store_transfers', 'decide_shortfall',
       'Decide an inter-store transfer shortfall: lost or returned (manager decision)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'store_transfers:decide_shortfall');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'spg_commission:pay', 'spg_commission', 'pay',
       'Mark SPG base pay and commission as paid'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'spg_commission:pay');

-- ADMIN gets every row explicitly, mirroring seed.ts (functionally inert: ADMIN passes through '*').
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN'
  AND p.`code` IN ('payments:verify', 'receivables:decide_bearer', 'consignment:note_number',
                   'consignment:tax_number', 'consignment:lock', 'store_stocktakes:approve',
                   'store_transfers:approve', 'store_transfers:decide_shortfall', 'spg_commission:pay')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- The one carry-over: whoever verifies BKM today (through journals:manage) keeps verifying.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), rp_ada.`roleId`, p.`id`
FROM `RolePermission` rp_ada
JOIN `Permission` p_ada ON p_ada.`id` = rp_ada.`permissionId` AND p_ada.`code` = 'journals:manage'
CROSS JOIN `Permission` p
WHERE p.`code` = 'payments:verify'
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = rp_ada.`roleId` AND rp.`permissionId` = p.`id`
  );

-- Users already signed in pick the new code up without logging out (lib/auth.ts compares the version).
UPDATE `RoleDefinition`
SET `permissionsVersion` = `permissionsVersion` + 1
WHERE `name` = 'ADMIN'
   OR `id` IN (
     SELECT rp.`roleId` FROM `RolePermission` rp
     JOIN `Permission` p ON p.`id` = rp.`permissionId`
     WHERE p.`code` = 'payments:verify'
   );

COMMIT;

-- Check: expect 16 rows (receivables:view may already have existed before this file ran).
SELECT `code` FROM `Permission`
WHERE `code` IN ('receivables:view', 'receivables:manage', 'consignment:view', 'consignment:manage',
                 'creative:view', 'creative:manage', 'production_colors:manage',
                 'payments:verify', 'receivables:decide_bearer', 'consignment:note_number',
                 'consignment:tax_number', 'consignment:lock', 'store_stocktakes:approve',
                 'store_transfers:approve', 'store_transfers:decide_shortfall', 'spg_commission:pay')
ORDER BY `code`;

-- Check: the non-admin roles that LOST an approval with this split (the owner grants back what he
-- wants in Peran & izin). Every role listed still holds the broad code; only the approval moved. A
-- payments:manage / collections:manage holder that already got payments:verify above lost nothing.
SELECT r.`name` AS `role`, p.`code` AS `held_code`,
       CASE p.`code`
         WHEN 'receivables:manage' THEN 'receivables:decide_bearer (incl. cancelling a decided lost-goods record), spg_commission:pay (putus)'
         WHEN 'consignment:manage' THEN 'consignment:lock, consignment:note_number, consignment:tax_number, spg_commission:pay (konsi)'
         WHEN 'stores:manage' THEN 'store_stocktakes:approve (incl. cancelling a count awaiting approval), store_transfers:approve (team store transfers, incl. cancelling one someone else created)'
         WHEN 'field_sales_orders:approve' THEN 'store_transfers:approve (SPG transfers and the transfer rules), store_transfers:decide_shortfall'
         WHEN 'payments:manage' THEN 'payments:verify (verify / reject collector submissions)'
         WHEN 'collections:manage' THEN 'payments:verify (approve / reject store settlements)'
       END AS `lost_until_granted`
FROM `RoleDefinition` r
JOIN `RolePermission` rp ON rp.`roleId` = r.`id`
JOIN `Permission` p ON p.`id` = rp.`permissionId`
WHERE r.`isSystem` = 0
  AND p.`code` IN ('receivables:manage', 'consignment:manage', 'stores:manage', 'field_sales_orders:approve',
                   'payments:manage', 'collections:manage')
  AND NOT (
    p.`code` IN ('payments:manage', 'collections:manage')
    AND EXISTS (
      SELECT 1 FROM `RolePermission` rp_v
      JOIN `Permission` p_v ON p_v.`id` = rp_v.`permissionId`
      WHERE rp_v.`roleId` = r.`id` AND p_v.`code` = 'payments:verify'
    )
  )
ORDER BY r.`name`, p.`code`;
