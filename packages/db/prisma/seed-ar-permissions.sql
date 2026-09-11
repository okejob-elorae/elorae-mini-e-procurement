-- Post-merge surgical seed for the AR (Piutang) + payments permissions.
-- Run against prod after migrate:deploy. Idempotent.
--
-- ADMIN already satisfies both of these through the code wildcard (`isSystem` -> ['*']), so
-- nothing is blocked before this runs. What these rows buy is the ability to GRANT the
-- permissions to a non-admin role from Settings -> RBAC. Mirrors seed-finance-reports-permissions.sql
-- — not linked to any non-admin role here either.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'receivables:view', 'receivables', 'view', 'View the piutang (AR) ledger'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'receivables:view');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'payments:manage', 'payments', 'manage', 'Record and void customer payments'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'payments:manage');
