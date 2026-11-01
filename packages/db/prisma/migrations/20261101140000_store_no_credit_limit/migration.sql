-- Store.noCreditLimit: the per-store "Tanpa batas kredit" switch (owner decision 2026-11-01, option C).
-- An EMPTY Store.creditLimit / maxOpenInvoices now follows the Settings -> Salesman default
-- (`salesman.kredit`) in both credit checks; a store with this flag set is exempt from the
-- nominal credit limit AND the max-open-invoices limit, while overdue/promise checks keep running.
-- The flag is resolved in one place, `batasKreditBerlaku` (apps/web/lib/salesman/kredit.ts).
--
-- Additive, default false: every existing store keeps its stored figures. A store whose limit is
-- empty starts following the default only once the Settings default is filled in; with the factory
-- default (empty) nothing changes. Re-runnable (IF NOT EXISTS), so a failed-and-resolved migration
-- can be applied again safely.

ALTER TABLE `Store` ADD COLUMN IF NOT EXISTS `noCreditLimit` BOOLEAN NOT NULL DEFAULT false;
