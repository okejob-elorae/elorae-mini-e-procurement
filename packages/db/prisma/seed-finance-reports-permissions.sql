-- Post-merge surgical seed for financial-report permissions (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.
-- Mirrors seed-pack-ratio-permissions.sql. Admin wildcard covers the grant;
-- this is NOT linked to any non-admin role.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'finance_reports:view', 'finance_reports', 'view', 'View financial reports (trial balance, income statement, balance sheet)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'finance_reports:view');
